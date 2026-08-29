import { defineStore } from 'pinia'
import { pickAndImport } from '@/core/workspace/import-picker'
import type { ImportResult } from '@/core/workspace/import-service'
import { computed, ref, shallowRef } from 'vue'
import { createEmptyBoard } from '@/core/board/types'
import { createEmptyCanvas } from '@/core/canvas/types'
import { LinkRewriter } from '@/core/links/link-rewriter'
import { HistoryService } from '@/core/history/history-service'
import { NoteRepository } from '@/core/workspace/note-repository'
import { dailyNoteContent, dailyNotePath } from '@/core/workspace/daily-note'
import { TrashService } from '@/core/workspace/trash-service'
import { SidebarOrderService } from '@/core/workspace/sidebar-order'
import { flattenTree, scanTree, type FileKind } from '@/core/workspace/tree'
import {
  DEFAULT_WORKSPACE_CONFIG,
  ATTACHMENTS_DIR,
  LIGHT_DIR,
  normalizeWorkspaceConfig,
  WORKSPACE_CONFIG_PATH,
  type TreeNode,
  type TrashItem,
  type WorkspaceConfig,
} from '@/core/workspace/types'
import {
  authorizeDirectory,
  chooseWorkspace,
  createStorage,
  detectRuntime,
  ensureDirectory,
  forgetDataPath,
  rememberDataPath,
  startupLocation,
  type StorageAdapter,
  type WorkspaceLocation,
} from '@/core/storage'

const LOCATION_KEY = 'light:workspace-location'

/**
 * 工作区状态：持有存储适配器与各领域服务，向 UI 暴露树与文件操作。
 *
 * store 只做「编排 + 响应式」，具体规则（唯一命名、软删除、frontmatter 维护）
 * 都在 core 层的服务里，因此那些逻辑可以脱离 Vue 单测。
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  // 服务实例不需要深层响应式，用 shallowRef 避免 Proxy 包裹类实例
  const storage = shallowRef<StorageAdapter | null>(null)
  const notes = shallowRef<NoteRepository | null>(null)
  const history = shallowRef<HistoryService | null>(null)
  const sidebarOrder = shallowRef<SidebarOrderService | null>(null)
  const trash = shallowRef<TrashService | null>(null)

  const location = ref<WorkspaceLocation | null>(null)
  const config = ref<WorkspaceConfig>({ ...DEFAULT_WORKSPACE_CONFIG })
  const tree = ref<TreeNode[]>([])
  const trashItems = ref<TrashItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isOpen = computed(() => storage.value !== null)

  /**
   * 工作区切换时需要作废的下游缓存（搜索索引、属性定义等）。
   * 用回调登记而不是直接 import 那些 store——workspace 是它们的依赖，
   * 反向引用会形成循环。
   */
  const onWorkspaceChanging: Array<() => void | Promise<void>> = []
  const onWorkspaceChanged: Array<() => void> = []
  const onWorkspaceOpened: Array<() => void | Promise<void>> = []

  function onBeforeOpen(handler: () => void | Promise<void>): void {
    onWorkspaceChanging.push(handler)
  }

  function onChanged(handler: () => void): void {
    onWorkspaceChanged.push(handler)
  }

  function onOpened(handler: () => void | Promise<void>): void {
    onWorkspaceOpened.push(handler)
  }

  /**
   * 「有若干篇笔记被后台改写了」的通知（目前只有改名跟随会触发）。
   * 搜索索引与链接图都缓存着这些笔记的内容，不通知它们就会读到旧文本。
   */
  const onNotesRewritten: Array<(paths: string[]) => void> = []

  function onRewritten(handler: (paths: string[]) => void): void {
    onNotesRewritten.push(handler)
  }

  /** 工作区里全部笔记的路径 */
  function notePaths(): string[] {
    return flattenTree(tree.value)
      .filter((node) => node.kind === 'note')
      .map((node) => node.path)
  }

  /**
   * 改名 / 移动后让指向它的 `[[链接]]` 跟上。
   *
   * 直接扫全库，而不是查链接图的反向索引：图是懒建的，改名时它可能还不存在；
   * 更麻烦的是改名**之后**再建图只会扫到新路径，反向索引里根本找不到旧路径。
   * 改名是低频操作，多读一遍全库换来「不依赖任何缓存状态」是划算的。
   */
  async function retargetLinks(from: string, to: string, pathsBefore: string[]): Promise<void> {
    if (from === to) return

    const pathsAfter = notePaths()
    const changed = await new LinkRewriter(requireNotes()).retarget({
      sources: pathsAfter,
      from,
      to,
      pathsBefore,
      pathsAfter,
    })

    if (changed.length > 0) onNotesRewritten.forEach((handler) => handler(changed))
  }

  const runtime = computed(() => detectRuntime())

  /** 打开（或切换）工作区：装配服务、读配置、扫描树、清理过期回收站 */
  async function open(target: WorkspaceLocation): Promise<void> {
    loading.value = true
    error.value = null
    try {
      // 先把旧工作区里仍在防抖队列中的内容写完。若先替换 adapter，
      // 那次迟到的保存会把旧文件写进新目录。
      for (const handler of onWorkspaceChanging) await handler()

      // 桌面端：fs 作用域是运行时授权的，重启后同样要重新放行，
      // 否则恢复上次工作区时每次读写都会被拒
      if (target.kind === 'tauri-fs') await authorizeDirectory(target.path)

      const adapter = await createStorage(target)
      // 新目录先完整初始化并扫描，全部成功后再一次性提交响应式状态。
      // 这样界面不会出现「新 adapter + 旧文件树」的中间态。
      await adapter.mkdir(LIGHT_DIR)
      const nextConfig = await readConfig(adapter)
      await adapter.mkdir(ATTACHMENTS_DIR)
      const nextNotes = new NoteRepository(adapter)
      const nextHistory = new HistoryService(adapter)
      const nextSidebarOrder = new SidebarOrderService(adapter)
      const nextTrash = new TrashService(adapter)
      await nextSidebarOrder.load()
      await nextTrash.autoClean(nextConfig.trashRetentionDays)
      const [nextScannedTree, nextTrashItems] = await Promise.all([
        scanTree(adapter, '', { exclude: [ATTACHMENTS_DIR] }),
        nextTrash.list(),
      ])
      try { await nextSidebarOrder.reconcile(nextScannedTree) } catch { /* 只影响排序偏好清理。 */ }
      const nextTree = nextSidebarOrder.apply(nextScannedTree)

      storage.value = adapter
      notes.value = nextNotes
      history.value = nextHistory
      sidebarOrder.value = nextSidebarOrder
      trash.value = nextTrash
      location.value = target
      config.value = nextConfig
      tree.value = nextTree
      trashItems.value = nextTrashItems
      persistLocation(target)

      onWorkspaceChanged.forEach((handler) => handler())
      for (const handler of onWorkspaceOpened) await handler()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      loading.value = false
    }
  }

  /**
   * 换一个数据保存位置（设置页用）。
   *
   * 不叫「打开工作区」——用户想的是「我的笔记存在哪」，不是「挂载哪个 Vault」。
   * 选完记住它，下次启动直接用。
   */
  async function changeDataPath(): Promise<boolean> {
    const path = await chooseWorkspace()
    if (!path) return false

    await ensureDirectory(path)
    await open({ kind: 'tauri-fs', path })
    rememberDataPath(path)
    return true
  }

  /** 恢复到默认位置（文档目录下的 Light） */
  async function resetDataPath(): Promise<void> {
    forgetDataPath()
    await open(await startupLocation())
  }

  /**
   * 启动时打开数据目录。
   *
   * 不需要用户做任何选择：客户端用文档目录下的 `Light`（首次自动建），
   * 网页端用浏览器私有存储。上次用过别的位置就沿用那个。
   */
  async function restoreLast(): Promise<void> {
    const saved = readPersistedLocation()
    if (saved) {
      try {
        await open(saved)
        return
      } catch {
        // 目录被移走、盘符变了或权限丢失时不阻塞启动，退回默认位置
      }
    }

    try {
      await open(await startupLocation())
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  /**
   * 重新扫描磁盘。所有写操作后都会调用——磁盘永远是唯一真相。
   *
   * 只有**界面上这棵树**排除附件目录。搜索、导出、链接图各自调 `scanTree`
   * 时不传 exclude：附件目录里如果真放了一篇 `.md`，那它就是一篇笔记，
   * 该被搜到、该被导出。排除是展示层的决定，不能渗进数据层。
   */
  async function refresh(): Promise<void> {
    if (!storage.value) return
    const scanned = await scanTree(storage.value, '', { exclude: [ATTACHMENTS_DIR] })
    try { await sidebarOrder.value?.reconcile(scanned) } catch { /* 只影响排序偏好清理。 */ }
    tree.value = sidebarOrder.value?.apply(scanned) ?? scanned
    trashItems.value = (await trash.value?.list()) ?? []
  }

  // --- 文件操作：一律「委托给服务 → 刷新树 → 返回新路径」 -----------------

  async function createNote(
    dir: string,
    title: string,
    kind: FileKind = 'note',
    initialContent = '',
  ): Promise<string> {
    // 看板与画板的初始结构由各自的模块定义，在这里组装后交给仓库落盘——
    // core/workspace 不该知道看板长什么样
    const content = initialContent || initialDocumentFor(kind)
    const path = await requireNotes().create(dir, title, kind, content)
    await refresh()
    return path
  }

  async function createFolder(dir: string, name: string): Promise<string> {
    const path = await requireNotes().createFolder(dir, name)
    await refresh()
    return path
  }

  /**
   * 打开今天的日记，没有就新建（11.3）。
   *
   * 不记录「哪些笔记是日记」——日记就是路径有规律的普通笔记。
   * 这样用户随时可以把它挪走、改名、当普通笔记用，不会有任何东西对不上。
   *
   * @param date 默认今天；传值可用于「昨天 / 某天」的入口
   */
  async function openDailyNote(date: Date = new Date()): Promise<string> {
    const path = dailyNotePath(date, config.value.dailyNoteFolder, config.value.dailyNoteFormat)
    const storage = requireStorage()

    if (await storage.exists(path)) return path

    // 直接写文件而不走 createNote：createNote 会做同名避让，
    // 而日记的整个前提就是「同一天永远是同一个文件」，避让会凭空多出 `2026-08-29 (2).md`
    await storage.writeText(path, dailyNoteContent(date))
    await refresh()
    return path
  }

  /**
   * 导入外部文件或文件夹到 `dir`。
   *
   * 导入完立刻 `refresh`：用户刚点完确认，文件树还是老样子，第一反应
   * 一定是「没成功」，然后再点一次——于是同样的内容进来两份。
   */
  async function importInto(dir: string, source: 'file' | 'folder'): Promise<ImportResult | null> {
    const storage = requireStorage()
    const absolute = location.value?.kind === 'tauri-fs'
      ? [location.value.path, dir].filter(Boolean).join('/')
      : ''

    const result = await pickAndImport(storage, source, dir, absolute)
    if (result && result.imported > 0) await refresh()
    return result
  }

  async function rename(path: string, newTitle: string): Promise<string> {
    // 必须在改名前取：改完之后旧路径已经不在树里，链接就无从判断指向谁
    const pathsBefore = notePaths()

    const next = await requireNotes().rename(path, newTitle)
    await sidebarOrder.value?.remap(path, next)
    await refresh()
    await retargetLinks(path, next, pathsBefore)
    return next
  }

  async function move(path: string, targetDir: string): Promise<string> {
    const pathsBefore = notePaths()

    const next = await requireNotes().move(path, targetDir)
    await refresh()
    await retargetLinks(path, next, pathsBefore)
    return next
  }

  /** 拖到同级条目的上/下边缘：必要时先跨目录移动，再记录目标目录内顺序。 */
  async function reorder(
    sourcePath: string,
    targetPath: string,
    position: 'before' | 'after',
  ): Promise<string> {
    if (!sidebarOrder.value) throw new Error('侧边栏排序尚未初始化')
    const targetDir = targetPath.split('/').slice(0, -1).join('/')
    const sourceDir = sourcePath.split('/').slice(0, -1).join('/')
    const next = sourceDir === targetDir ? sourcePath : await move(sourcePath, targetDir)
    await sidebarOrder.value.reorder(tree.value, next, targetPath, position)
    tree.value = sidebarOrder.value.apply(tree.value)
    return next
  }

  async function duplicate(path: string): Promise<string> {
    const next = await requireNotes().duplicate(path)
    await refresh()
    return next
  }

  /** 移入回收站（软删除），不是物理删除 */
  async function moveToTrash(path: string): Promise<void> {
    await requireTrash().trash(path)
    await refresh()
  }

  async function restoreFromTrash(archivedPath: string): Promise<string> {
    const next = await requireTrash().restore(archivedPath)
    await refresh()
    return next
  }

  async function purgeFromTrash(archivedPath: string): Promise<void> {
    await requireTrash().purge(archivedPath)
    await refresh()
  }

  async function emptyTrash(): Promise<void> {
    await requireTrash().empty()
    await refresh()
  }

  async function saveConfig(next: WorkspaceConfig): Promise<void> {
    config.value = next
    await requireStorage().writeText(WORKSPACE_CONFIG_PATH, JSON.stringify(next, null, 2))
  }

  // --- 内部 -------------------------------------------------------------

  function requireStorage(): StorageAdapter {
    if (!storage.value) throw new Error('尚未打开工作区')
    return storage.value
  }

  function requireNotes(): NoteRepository {
    if (!notes.value) throw new Error('尚未打开工作区')
    return notes.value
  }

  function requireTrash(): TrashService {
    if (!trash.value) throw new Error('尚未打开工作区')
    return trash.value
  }

  return {
    storage,
    notes,
    history,
    sidebarOrder,
    location,
    config,
    tree,
    trashItems,
    loading,
    error,
    isOpen,
    runtime,
    open,
    changeDataPath,
    resetDataPath,
    onChanged,
    onBeforeOpen,
    onOpened,
    onRewritten,
    restoreLast,
    refresh,
    createNote,
    createFolder,
    importInto,
    openDailyNote,
    rename,
    move,
    reorder,
    duplicate,
    moveToTrash,
    restoreFromTrash,
    purgeFromTrash,
    emptyTrash,
    saveConfig,
  }
})

/** 新建看板 / 画板时的初始文件内容；笔记走 Markdown 那条路，这里不管 */
function initialDocumentFor(kind: FileKind): string {
  if (kind === 'board') return JSON.stringify(createEmptyBoard(() => crypto.randomUUID()), null, 2)
  if (kind === 'canvas') return JSON.stringify(createEmptyCanvas(), null, 2)
  return ''
}

async function readConfig(adapter: StorageAdapter): Promise<WorkspaceConfig> {
  try {
    const parsed = JSON.parse(await adapter.readText(WORKSPACE_CONFIG_PATH)) as unknown
    const normalized = normalizeWorkspaceConfig(parsed)

    // 开发期只有唯一 V1：每次读取都清掉废弃字段和旧版本号。
    try {
      await adapter.writeText(WORKSPACE_CONFIG_PATH, JSON.stringify(normalized, null, 2))
    } catch {
      // 只读目录仍允许打开；内存中只使用当前 V1 字段。
    }
    return normalized
  } catch {
    const defaults = { ...DEFAULT_WORKSPACE_CONFIG }
    // 首次打开目录就落下最小的内部结构，而不是等用户改过一次设置才创建。
    // 失败时仍允许只读打开；真正写文件时会给出更具体的存储错误。
    try {
      await adapter.writeText(WORKSPACE_CONFIG_PATH, JSON.stringify(defaults, null, 2))
    } catch {
      // 只读目录
    }
    return defaults
  }
}

function persistLocation(target: WorkspaceLocation): void {
  localStorage.setItem(LOCATION_KEY, JSON.stringify(target))
}

function readPersistedLocation(): WorkspaceLocation | null {
  try {
    const raw = localStorage.getItem(LOCATION_KEY)
    return raw ? (JSON.parse(raw) as WorkspaceLocation) : null
  } catch {
    return null
  }
}

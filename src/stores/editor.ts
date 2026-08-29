import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { joinTitle, splitTitle } from '@/core/markdown/title'
import { createAutosave } from './autosave'
import { kindOf, type FileKind } from '@/core/workspace/tree'
import type { Note } from '@/core/workspace/note-repository'
import type { HistoryEntry } from '@/core/history/history-service'
import type { SelectionBridge } from '@/features/editor/ai/selection-bridge'
import { useCollectionsStore } from './collections'
import { useLinksStore } from './links'
import { usePreferencesStore } from './preferences'
import { useSearchStore } from './search'
import { useWorkspaceStore } from './workspace'

/**
 * 当前编辑中的笔记。
 *
 * local-first 的体现：所有编辑先进内存并立刻标脏，落盘异步且不阻塞输入；
 * 切换笔记或关闭窗口前强制 flush，保证不丢字。
 */
export const useEditorStore = defineStore('editor', () => {
  const workspace = useWorkspaceStore()
  const collections = useCollectionsStore()
  const search = useSearchStore()
  const preferences = usePreferencesStore()
  const links = useLinksStore()

  /**
   * 已打开的文档路径，即标签页（需求 S11）。
   *
   * 只存路径不存内容：内容始终以磁盘为准，切换标签时重新读取。
   * 缓存多份内容会引入「哪份才是最新」的问题，与「文件即真源」相悖。
   * 持久化到本机，重开应用能恢复上次的工作现场。
   */
  const tabs = useLocalStorage<string[]>('light:open-tabs', [])

  const note = ref<Note | null>(null)
  /**
   * 界面上标题与正文是两层，文件里标题仍是正文开头的 `# H1`（见 core/markdown/title.ts）。
   * 因此 store 持有拆开的两段，只在落盘时合并回去。
   */
  const docTitle = ref<string | null>(null)
  /** 编辑器中的正文（不含首个 H1） */
  const draft = ref('')

  /** 合并后的完整 Markdown，供大纲、字数等需要看全文的地方使用 */
  const fullContent = computed(() => joinTitle(docTitle.value, draft.value))
  const dirty = ref(false)
  const saving = ref(false)
  const lastSavedAt = ref<number | null>(null)
  const loadError = ref<string | null>(null)
  /** 历史写入失败不应阻断正文保存，但必须让历史面板能显示原因。 */
  const historyError = ref<string | null>(null)
  /** 同一路径内容被外部替换时递增，让 Milkdown 重建而不是继续持有旧文档。 */
  const contentRevision = ref(0)


  /**
   * 当前打开的文档路径。
   *
   * 独立于 `note`：看板与画板也占标签页、也要高亮文件树，但它们不是 Markdown，
   * 内容由各自的视图读写。把 activePath 绑死在 note 上的话，打开一个看板
   * 会让整个界面以为「什么都没打开」。
   */
  const activePath = ref<string | null>(null)

  /**
   * 编辑器实例的选区桥（模块 6）。
   *
   * 由 MarkdownEditor 挂载时注册、卸载时清空。放在 store 里是为了让
   * AI 面板这类**兄弟组件**够得着它，而不必把面板塞进编辑器内部——
   * 面板还要服务「整篇摘要」这种与选区无关的场景。
   *
   * shallowRef：桥是一组函数，深层响应式对它没有意义。
   */
  const selectionBridge = shallowRef<SelectionBridge | null>(null)

  /**
   * 「在光标处唤起 AI 输入框」的请求计数。
   *
   * 用递增的数字而不是布尔：连续两次 `/ai` 之间如果没人把布尔翻回 false，
   * 第二次就不会触发。计数每次都变，watch 一定会响应。
   */
  const aiPromptRequests = ref(0)

  function requestAiPrompt(): void {
    aiPromptRequests.value += 1
  }
  /** 当前文档的类型，决定主区域渲染哪个视图 */
  const activeKind = computed<FileKind | null>(() =>
    activePath.value ? (kindOf(activePath.value) ?? null) : null,
  )
  const wordCount = computed(() => countWords(fullContent.value))
  /** 中文按每分钟 400 字估算 */
  const readingMinutes = computed(() => Math.max(1, Math.round(wordCount.value / 400)))

  async function openNote(path: string): Promise<boolean> {
    const storage = workspace.storage
    const kind = kindOf(path)
    if (!storage || !kind || !(await storage.exists(path))) {
      forgetInvalidPath(path)
      const message = `文件不存在或已被移动：${path}`
      loadError.value = message
      workspace.error = message
      return false
    }

    /**
     * 路径相同**且正在编辑**时才什么都不做。
     *
     * 不能只比路径就短路：删掉「未命名.md」再新建一个同名文件，路径是一样的，
     * 但那已经是另一个文件了。直接复用内存里的旧内容，下一次自动保存
     * 就会把上一个文件的内容写进新文件——用户看到的是「新建的笔记里
     * 装着刚删掉的那篇」，而且是真的被写进了磁盘。
     *
     * 有未保存改动时保持现状，否则重读会吞掉用户正在写的东西。
     */
    if (activePath.value === path && dirty.value) return true

    await flush() // 切换前先把上一篇写完，避免丢字

      loadError.value = null
      historyError.value = null
      workspace.error = null

    // 看板 / 画板由各自的视图负责读写，编辑器只记下「现在打开的是它」
    if (kind !== 'note') {
      note.value = null
      docTitle.value = null
      draft.value = ''
      dirty.value = false
      activePath.value = path
      if (!tabs.value.includes(path)) tabs.value = [...tabs.value, path]
      return true
    }

    try {
      // 先把内容读完，再一次性提交状态——**顺序在这里是有意义的**。
      //
      // `activePath` 驱动 EditorPane 的 :key，它一变组件就重建，并拿当时的
      // `draft` 当作编辑器的初始内容。若在 await 之前就把 activePath 换掉，
      // 编辑器会用**上一篇**的正文建起来，而字数、大纲这些读的是新笔记——
      // 界面显示与统计对不上只是表象，真正的危险是用户在那个错的编辑器里
      // 敲一个字，旧正文就被当成新笔记的内容写进磁盘。
      const loaded = await workspace.notes!.read(path)
      const { title, body } = splitTitle(loaded.content)

      note.value = loaded
      docTitle.value = title
      draft.value = body
      dirty.value = false
      lastSavedAt.value = loaded.updatedAt
      contentRevision.value += 1
      activePath.value = path
      if (!tabs.value.includes(path)) tabs.value = [...tabs.value, path]
      return true
    } catch (cause) {
      forgetInvalidPath(path)
      const detail = cause instanceof Error ? cause.message : String(cause)
      loadError.value = `无法打开 ${path}：${detail}`
      workspace.error = loadError.value
      return false
    }
  }

  /** 切换数据目录后按新目录的磁盘真相清理并恢复标签。 */
  async function reconcileTabs(): Promise<void> {
    const storage = workspace.storage
    if (!storage) {
      tabs.value = []
      clearActiveWithoutSaving()
      return
    }

    const candidates = tabs.value.filter((path) => Boolean(kindOf(path)))
    const checks = await Promise.all(candidates.map(async (path) => [path, await storage.exists(path)] as const))
    tabs.value = checks.filter(([, exists]) => exists).map(([path]) => path)

    const current = activePath.value
    if (current && tabs.value.includes(current)) {
      await openNote(current)
      return
    }

    clearActiveWithoutSaving()
    const fallback = tabs.value.at(-1)
    if (fallback) await openNote(fallback)
  }

  function clearActiveWithoutSaving(): void {
    autosave.cancel()
    note.value = null
    activePath.value = null
    docTitle.value = null
    draft.value = ''
    dirty.value = false
  }

  function forgetInvalidPath(path: string): void {
    tabs.value = tabs.value.filter((item) => item !== path)
    if (activePath.value === path) clearActiveWithoutSaving()
  }

  /** 编辑器每次变更调用；只标脏并重置防抖计时，不做同步落盘 */
  function updateContent(markdown: string): void {
    if (!note.value || markdown === draft.value) return
    draft.value = markdown
    dirty.value = true
    schedule()
  }

  /** 标题栏变更。与正文一样走防抖，避免逐字写盘 */
  function updateTitle(value: string): void {
    const next = value.trim() ? value : null
    if (!note.value || next === docTitle.value) return
    docTitle.value = next
    dirty.value = true
    schedule()
  }

  function schedule(): void {
    // 每次调度都重新读延迟：用户在设置里改完，下一次输入就该按新值走
    autosave.schedule(preferences.autosaveDelay)
  }

  /**
   * 一次实际写入。
   *
   * 路径、内容、标题都在进入异步之前定格——等 await 回来时，
   * 它们可能已经属于另一篇笔记了。
   */
  async function writeOnce(): Promise<void> {
    const current = note.value
    if (!current || !dirty.value) return

    const path = current.path
    const snapshot = fullContent.value
    const titleSnapshot = docTitle.value

    saving.value = true
    try {
      // 先保存“将被覆盖的上一版”。历史失败不能阻断 Markdown 真源落盘。
      if (current.id && workspace.history) {
        try {
          await workspace.history.capture(current)
          historyError.value = null
        } catch (cause) {
          historyError.value = cause instanceof Error ? cause.message : String(cause)
        }
      }

      // 标题同时写进 frontmatter.title：搜索与列表都读它，保持一致
      const saved = await workspace.notes!.write(path, {
        content: snapshot,
        ...(titleSnapshot ? { title: titleSnapshot } : {}),
      })

      /**
       * 写入期间可能已经切到别的笔记。
       *
       * 文件本身写对了（path 是定格的），但**回写内存状态**必须确认当前
       * 仍停在这一篇——否则就是拿旧笔记的内容去覆盖新笔记的 store，
       * 表现为「切过去的标签页内容被上一篇替换」。
       */
      if (activePath.value === path) {
        note.value = saved
        lastSavedAt.value = saved.updatedAt
        // 保存期间用户可能又输入了新内容，只有内容未变才清除脏标记
        if (fullContent.value === snapshot) dirty.value = false
      }

      // 索引与链接图跟的是文件，与「现在打开的是哪篇」无关，因此无条件更新
      void search.touch(path)
      void links.touch(path)
    } finally {
      saving.value = false
    }
  }

  /** 防抖落盘队列。竞态处理见 stores/autosave.ts */
  const autosave = createAutosave(writeOnce)

  const save = autosave.save
  /** 立即落盘：切换笔记、关闭窗口、失焦时调用 */
  const flush = autosave.flush

  /** 手动固定当前版本；同内容由 HistoryService 去重。 */
  async function createHistoryVersion(): Promise<HistoryEntry | null> {
    await flush()
    const current = note.value
    if (!current || !workspace.history) return null
    try {
      const entry = await workspace.history.capture(current, { force: true, reason: 'manual' })
      historyError.value = null
      return entry
    } catch (cause) {
      historyError.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    }
  }

  /** 恢复前强制保存当前版，所以恢复动作本身仍可撤回。 */
  async function restoreHistoryVersion(entryId: string): Promise<void> {
    await flush()
    const current = note.value
    if (!current || !workspace.history || !workspace.notes) return

    const historical = await workspace.history.read(current.id, entryId)
    await workspace.history.capture(current, { force: true, reason: 'before-restore' })
    const saved = await workspace.notes.write(current.path, {
      title: historical.title,
      content: historical.content,
    })

    if (activePath.value === current.path) {
      const { title, body } = splitTitle(saved.content)
      note.value = saved
      docTitle.value = title
      draft.value = body
      dirty.value = false
      lastSavedAt.value = saved.updatedAt
      contentRevision.value += 1
    }
    historyError.value = null
    void search.touch(current.path)
    void links.touch(current.path)
  }

  /**
   * 修改单个 frontmatter 属性并立即落盘。
   *
   * 属性改动不像正文那样连续发生，没必要走防抖——立刻写盘，
   * 用户点一下勾选框就能看到「已保存」。
   */
  async function setProperty(key: string, value: unknown): Promise<void> {
    const current = note.value
    if (!current || !workspace.notes) return

    // 先把未落盘的正文一并写入，避免属性写入覆盖掉正在输入的内容
    await flush()

    const saved = await workspace.notes.write(current.path, { properties: { [key]: value } })
    note.value = saved
    lastSavedAt.value = saved.updatedAt
    void search.touch(saved.path)
    void links.touch(saved.path)
    await collections.refresh()
  }

  /** 路径变化（重命名/移动）后重新指向新文件，避免继续往旧路径写 */
  function retarget(path: string): void {
    const previous = activePath.value
    activePath.value = path
    if (note.value) note.value = { ...note.value, path }
    // 标签页记的是路径，改名后必须一并换掉，否则点它会打不开
    if (previous) tabs.value = tabs.value.map((item) => (item === previous ? path : item))
  }

  /**
   * 关闭标签页。关的是当前页时，激活右邻；没有右邻则取左邻。
   * 这与多数编辑器一致——关掉一个标签后视线自然落在它原来的位置。
   */
  async function closeTab(path: string): Promise<void> {
    const index = tabs.value.indexOf(path)
    if (index === -1) return

    const remaining = tabs.value.filter((item) => item !== path)
    tabs.value = remaining

    if (activePath.value !== path) return

    const next = remaining[index] ?? remaining[index - 1]
    if (next) await openNote(next)
    else await close()
  }

  async function closeOthers(path: string): Promise<void> {
    tabs.value = tabs.value.filter((item) => item === path)
    if (activePath.value !== path) await openNote(path)
  }

  async function closeAll(): Promise<void> {
    tabs.value = []
    await close()
  }

  /** 文件被删除时清理对应标签，避免留下打不开的死标签 */
  async function forgetTab(path: string): Promise<void> {
    const under = (candidate: string) => candidate === path || candidate.startsWith(`${path}/`)
    const wasActive = activePath.value ? under(activePath.value) : false
    tabs.value = tabs.value.filter((item) => !under(item))
    if (!wasActive) return

    // 删除后的路径不能再 flush：那会把刚移入回收站的文件重新创建出来。
    clearActiveWithoutSaving()
    const fallback = tabs.value.at(-1)
    if (fallback) await openNote(fallback)
  }

  async function close(): Promise<void> {
    await flush()
    note.value = null
    activePath.value = null
    docTitle.value = null
    draft.value = ''
    dirty.value = false
  }

  return {
    tabs,
    note,
    docTitle,
    fullContent,
    draft,
    dirty,
    saving,
    lastSavedAt,
    loadError,
    historyError,
    contentRevision,
    activePath,
    activeKind,
    selectionBridge,
    aiPromptRequests,
    requestAiPrompt,
    wordCount,
    readingMinutes,
    openNote,
    updateContent,
    updateTitle,
    setProperty,
    save,
    flush,
    createHistoryVersion,
    restoreHistoryVersion,
    retarget,
    closeTab,
    closeOthers,
    closeAll,
    forgetTab,
    reconcileTabs,
    close,
  }
})

/** 中文按字符计、西文按词计，两者相加 */
export function countWords(text: string): number {
  const cjk = text.match(/[一-龥぀-ヿ]/g)?.length ?? 0
  const words = text.replace(/[一-龥぀-ヿ]/g, ' ').match(/[A-Za-z0-9_'-]+/g)?.length ?? 0
  return cjk + words
}

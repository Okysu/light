<script setup lang="ts">
import { FilePlus, FileUp, FolderPlus, FolderUp, Import, Kanban, PencilRuler, Trash2 } from 'lucide-vue-next'
import { computed, reactive, ref } from 'vue'
import ContextMenu, { type MenuItem } from '@/components/ContextMenu.vue'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { FileKind } from '@/core/workspace/tree'
import type { TreeNode } from '@/core/workspace/types'
import { useConfirm } from '@/composables/use-confirm'
import { usePrompt } from '@/composables/use-prompt'
import { useCollectionsStore } from '@/stores/collections'
import { useEditorStore } from '@/stores/editor'
import { useExportStore } from '@/stores/export'
import { useSearchStore } from '@/stores/search'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18nStore } from '@/stores/i18n'
import TreeItem from './TreeItem.vue'
import { hasTreeDrag, readTreeDrag } from './drag-data'

const workspace = useWorkspaceStore()
const editor = useEditorStore()
const ui = useUiStore()
const search = useSearchStore()
const collections = useCollectionsStore()
const exporter = useExportStore()
const i18n = useI18nStore()

/**
 * 标签筛选后的树。
 *
 * 保留通往命中笔记的整条路径，而不是把匹配项摊平成列表——
 * 用户仍需要知道笔记在哪个目录下，摊平会丢掉这层信息。
 */
const visibleTree = computed(() => {
  const allowed = collections.filteredPaths
  if (!allowed) return workspace.tree

  const prune = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((node) => {
        if (node.kind !== 'folder') return allowed.has(node.path) ? node : null
        const children = prune(node.children ?? [])
        return children.length > 0 ? { ...node, children } : null
      })
      .filter((node): node is TreeNode => node !== null)

  return prune(workspace.tree)
})
const { prompt } = usePrompt()
const { confirm } = useConfirm()

/** 展开状态是纯 UI 状态，不落盘：树结构由磁盘决定，展开与否属于会话偏好 */
const expanded = reactive(new Set<string>())
const busy = ref(false)
const rootDropActive = ref(false)
/** 操作结果提示（导入条数、复制成功…）；下一次操作时清掉 */
const statusMessage = ref<string | null>(null)

/** 空白区右键菜单：一律作用于工作区根目录 */
const blankMenuItems = computed<MenuItem[]>(() => [
  { label: i18n.t('explorer.newNote'), icon: FilePlus, action: () => create('', 'note') },
  { label: i18n.t('explorer.newBoard'), icon: Kanban, action: () => create('', 'board') },
  { label: i18n.t('explorer.newCanvas'), icon: PencilRuler, action: () => create('', 'canvas') },
  { label: i18n.t('explorer.newFolder'), icon: FolderPlus, action: () => create('', 'folder') },
  {
    label: i18n.t('explorer.import'),
    icon: Import,
    separatorBefore: true,
    items: [
      { label: i18n.t('explorer.importFile'), icon: FileUp, action: () => runImport('', 'file') },
      { label: i18n.t('explorer.importFolder'), icon: FolderUp, action: () => runImport('', 'folder') },
    ],
  },
  {
    label: i18n.t('explorer.openTrash'),
    icon: Trash2,
    separatorBefore: true,
    action: () => {
      ui.trashOpen = true
    },
  },
])

function toggle(path: string): void {
  if (expanded.has(path)) expanded.delete(path)
  else expanded.add(path)
}

async function select(node: TreeNode): Promise<void> {
  // 三种文档走同一条打开路径；主区域按类型分流（见 App.vue）
  if (node.kind !== 'folder') await editor.openNote(node.path)
}

async function create(dir: string, kind: FileKind | 'folder'): Promise<void> {
  const keys = { note: 'explorer.newNote', board: 'explorer.newBoard', canvas: 'explorer.newCanvas', folder: 'explorer.newFolder' } as const
  const name = await prompt({
    title: i18n.t(keys[kind]),
    defaultValue: kind === 'folder' ? i18n.t('explorer.newFolder') : i18n.t('explorer.untitled'),
    confirmLabel: i18n.t('common.create'),
  })
  if (!name) return

  await guard(async () => {
    const path = kind === 'folder' ? await workspace.createFolder(dir, name) : await workspace.createNote(dir, name, kind)
    if (dir) expanded.add(dir)
    if (kind !== 'folder') await editor.openNote(path)
  })
}

/**
 * 导入外部文件 / 文件夹。
 *
 * 结果一定要说出来。导入是「我的旧东西还在不在」这种高焦虑操作，
 * 静默完成会让人反复去文件树里数——尤其是有文件被跳过时。
 */
async function runImport(dir: string, source: 'file' | 'folder'): Promise<void> {
  await guard(async () => {
    const result = await workspace.importInto(dir, source)
    if (!result) return

    if (dir) expanded.add(dir)
    // 导入进来的正文要能被搜到。作废整份索引而不是逐个 touch——
    // 一次导入可能带进几百个文件，逐个通知比重建还慢
    search.invalidate()

    statusMessage.value =
      result.skipped.length > 0
      ? i18n.t('explorer.importCompleteSkipped', { imported: result.imported, skipped: result.skipped.length })
      : i18n.t('explorer.importComplete', { imported: result.imported })
  })
}

/** 复制整篇笔记到剪贴板（2.8） */
async function copyDocument(node: TreeNode, format: 'markdown' | 'rich'): Promise<void> {
  await guard(async () => {
    const { documentHtml, documentMarkdown, writeToClipboard } = await import(
      '@/core/clipboard/copy-document'
    )

    const raw = await workspace.storage!.readText(node.path)
    const markdown = documentMarkdown(raw, node.path)
    await writeToClipboard(markdown, format === 'rich' ? await documentHtml(markdown) : undefined)

    statusMessage.value = i18n.t(format === 'rich' ? 'explorer.copiedRich' : 'explorer.copiedMarkdown')
  })
}

async function rename(node: TreeNode): Promise<void> {
  const name = await prompt({ title: i18n.t('explorer.renameTitle'), defaultValue: node.name, confirmLabel: i18n.t('explorer.renamed') })
  if (!name || name === node.name) return

  await guard(async () => {
    // 移动文件之前先把未落盘的改动写完。
    // 否则那次写入定格的是旧路径，而文件已经被移走——写入会凭空
    // 再造出一个旧名文件，用户看到「删掉的名字又回来了」
    if (editor.activePath === node.path) await editor.flush()

    const next = await workspace.rename(node.path, name)
    // 路径变了，索引里的旧条目要换成新的
    search.forget(node.path)
    void search.touch(next)
    // 正在编辑的就是它 → 让编辑器指向新路径，否则会继续往旧路径写
    if (editor.activePath === node.path) editor.retarget(next)
  })
}

async function duplicate(node: TreeNode): Promise<void> {
  await guard(() => workspace.duplicate(node.path))
}

async function trash(node: TreeNode): Promise<void> {
  // 移入回收站可以还原，但它常常是误触右键菜单的结果——
  // 而误删一篇正在写的笔记，即使能还原也已经打断了思路
  const ok = await confirm({
    title: i18n.t('explorer.trashConfirmTitle'),
    description:
      node.kind === 'folder'
      ? i18n.t('explorer.trashFolderDescription', { name: node.name })
      : i18n.t('explorer.trashItemDescription', { name: node.name }),
    confirmLabel: i18n.t('explorer.moveTrash'),
    danger: true,
  })
  if (!ok) return

  await guard(async () => {
    // 删除前先保存；删除完成后再 flush 会把旧路径重新创建出来。
    if (editor.activePath === node.path || editor.activePath?.startsWith(`${node.path}/`)) {
      await editor.flush()
    }
    await workspace.moveToTrash(node.path)
    search.forget(node.path)
    collections.forget(node.path)
    // 文件没了，对应标签页也要收掉，否则会留下打不开的死标签
    await editor.forgetTab(node.path)
    await collections.refresh()
  })
}

/** 拖拽移动：目标目录自动展开，让用户看到结果 */
async function move(sourcePath: string, targetDir: string): Promise<void> {
  await guard(async () => {
    // 同 rename：移动前先落盘，避免飞行中的写入落到已经不存在的旧路径上
    if (editor.activePath === sourcePath) await editor.flush()

    const next = await workspace.move(sourcePath, targetDir)
    search.forget(sourcePath)
    void search.touch(next)
    if (targetDir) expanded.add(targetDir)
    if (editor.activePath === sourcePath) editor.retarget(next)
  })
}

/** 拖到条目上/下边缘表示排序；跨目录时同时完成移动。 */
async function reorder(
  sourcePath: string,
  targetPath: string,
  position: 'before' | 'after',
): Promise<void> {
  await guard(async () => {
    if (editor.activePath === sourcePath) await editor.flush()
    const next = await workspace.reorder(sourcePath, targetPath, position)
    search.forget(sourcePath)
    void search.touch(next)
    if (editor.activePath === sourcePath) editor.retarget(next)
  })
}

/** 右键菜单提供与拖拽等价的键盘友好排序入口。 */
async function shift(node: TreeNode, direction: 'up' | 'down'): Promise<void> {
  const siblings = findSiblings(workspace.tree, node.path)
  if (!siblings) return
  const index = siblings.findIndex((item) => item.path === node.path)
  const target = siblings[index + (direction === 'up' ? -1 : 1)]
  if (!target) return
  await reorder(node.path, target.path, direction === 'up' ? 'before' : 'after')
}

function findSiblings(nodes: TreeNode[], path: string): TreeNode[] | null {
  if (nodes.some((node) => node.path === path)) return nodes
  for (const node of nodes) {
    if (node.kind !== 'folder') continue
    const nested = findSiblings(node.children ?? [], path)
    if (nested) return nested
  }
  return null
}

function onRootDragOver(event: DragEvent): void {
  if (!hasTreeDrag(event.dataTransfer)) return
  event.preventDefault()
  rootDropActive.value = true
}

function onRootDrop(event: DragEvent): void {
  rootDropActive.value = false
  const source = readTreeDrag(event.dataTransfer)
  // 已在根目录的条目不必再移动
  if (!source || !source.includes('/')) return
  event.preventDefault()
  void move(source, '')
}

/** 统一收敛异步失败，避免每个处理函数各写一遍 try/catch */
async function guard(action: () => Promise<unknown>): Promise<void> {
  busy.value = true
  workspace.error = null
  statusMessage.value = null
  try {
    await action()
  } catch (cause) {
    workspace.error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between px-3 py-2">
      <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ i18n.t('explorer.notes') }}</span>
      <div class="flex gap-0.5">
        <Button variant="ghost" size="icon-sm" :title="i18n.t('explorer.newNote')" @click="create('', 'note')">
          <FilePlus />
        </Button>
        <Button variant="ghost" size="icon-sm" :title="i18n.t('explorer.newFolder')" @click="create('', 'folder')">
          <FolderPlus />
        </Button>
        <Button variant="ghost" size="icon-sm" :title="i18n.t('explorer.trash')" @click="ui.trashOpen = true">
          <Trash2 />
        </Button>
      </div>
    </div>

    <!-- 空白区域：既是「移回根目录」的拖放目标，也提供根级右键菜单 -->
    <ContextMenu :items="blankMenuItems">
      <div
        class="min-h-0 flex-1"
        :class="rootDropActive && 'bg-accent/30'"
        @dragover="onRootDragOver"
        @dragleave="rootDropActive = false"
        @drop="onRootDrop"
      >
        <ScrollArea class="h-full" viewport-class="px-1 pb-2">
          <p v-if="visibleTree.length === 0" class="px-3 py-8 text-center text-sm text-muted-foreground">
            <template v-if="collections.activeTag">
              {{ i18n.t('explorer.noTaggedBefore') }}{{ collections.activeTag }}{{ i18n.t('explorer.noTaggedAfter') }}
            </template>
            <template v-else>
              {{ i18n.t('explorer.empty') }}<br />
              <span class="text-xs">{{ i18n.t('explorer.emptyHint') }}</span>
            </template>
          </p>

          <ul v-else>
            <TreeItem
              v-for="node in visibleTree"
              :key="node.path"
              :node="node"
              :depth="0"
              :active-path="editor.activePath"
              :expanded="expanded"
              :is-favorite="collections.isFavorite"
              @select="select"
              @favorite="collections.toggleFavorite($event.path)"
              @toggle="toggle"
              @create="create"
              @import="runImport"
              @copy="copyDocument"
              @rename="rename"
              @duplicate="duplicate"
              @trash="trash"
              @properties="ui.openProperties($event.path)"
              @export="exporter.exportPaths([$event.path])"
              @move="move"
              @reorder="reorder"
              @shift="shift"
            />
          </ul>
        </ScrollArea>
      </div>
    </ContextMenu>

    <p v-if="workspace.error" class="border-t border-border px-3 py-2 text-xs text-destructive">
      {{ workspace.error }}
    </p>
    <p
      v-else-if="statusMessage"
      class="border-t border-border px-3 py-2 text-xs text-muted-foreground"
      @click="statusMessage = null"
    >
      {{ statusMessage }}
    </p>
  </div>
</template>

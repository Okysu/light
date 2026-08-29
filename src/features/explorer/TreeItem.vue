<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ClipboardCopy,
  Code,
  Copy,
  Download,
  FilePlus,
  FileText,
  FileUp,
  FolderPlus,
  FolderUp,
  Import,
  Info,
  Kanban,
  PenLine,
  Star,
  StarOff,
  PencilRuler,
  Trash2,
  Type,
} from 'lucide-vue-next'
import { computed, ref } from 'vue'
import ContextMenu, { type MenuItem } from '@/components/ContextMenu.vue'
import { isDescendant } from '@/core/path'
import type { TreeNode } from '@/core/workspace/types'
import { cn } from '@/lib/utils'
import { useI18nStore } from '@/stores/i18n'
import { readTreeDrag, writeTreeDrag } from './drag-data'

const i18n = useI18nStore()

const props = defineProps<{
  node: TreeNode
  depth: number
  activePath: string | null
  expanded: Set<string>
  /**
   * 判断某条目是否已收藏。
   * 传函数而不是布尔值：树是递归渲染的，传布尔会把父节点的状态套给所有子节点。
   */
  isFavorite: (path: string) => boolean
}>()

const emit = defineEmits<{
  select: [node: TreeNode]
  favorite: [node: TreeNode]
  toggle: [path: string]
  create: [dir: string, kind: 'note' | 'board' | 'canvas' | 'folder']
  import: [dir: string, source: 'file' | 'folder']
  copy: [node: TreeNode, format: 'markdown' | 'rich']
  rename: [node: TreeNode]
  duplicate: [node: TreeNode]
  trash: [node: TreeNode]
  properties: [node: TreeNode]
  export: [node: TreeNode]
  move: [sourcePath: string, targetDir: string]
  reorder: [sourcePath: string, targetPath: string, position: 'before' | 'after']
  shift: [node: TreeNode, direction: 'up' | 'down']
}>()

const isFolder = computed(() => props.node.kind === 'folder')
const isOpen = computed(() => props.expanded.has(props.node.path))
const isActive = computed(() => props.activePath === props.node.path)
const dropActive = ref(false)
const dropPosition = ref<'inside' | 'before' | 'after' | null>(null)

const icon = computed(() =>
  props.node.kind === 'board' ? Kanban : props.node.kind === 'canvas' ? PencilRuler : FileText,
)

/** 文件夹的「新建」作用于自身，文件的「新建」作用于其所在目录 */
const targetDir = computed(() =>
  isFolder.value ? props.node.path : props.node.path.split('/').slice(0, -1).join('/'),
)

const favorited = computed(() => props.isFavorite(props.node.path))

const menuItems = computed<MenuItem[]>(() => [
  { label: i18n.t('explorer.newNote'), icon: FilePlus, action: () => emit('create', targetDir.value, 'note') },
  { label: i18n.t('explorer.newBoard'), icon: Kanban, action: () => emit('create', targetDir.value, 'board') },
  { label: i18n.t('explorer.newCanvas'), icon: PencilRuler, action: () => emit('create', targetDir.value, 'canvas') },
  { label: i18n.t('explorer.newFolder'), icon: FolderPlus, action: () => emit('create', targetDir.value, 'folder') },
  {
    label: i18n.t('explorer.import'),
    icon: Import,
    items: [
      { label: i18n.t('explorer.importFile'), icon: FileUp, action: () => emit('import', targetDir.value, 'file') },
      { label: i18n.t('explorer.importFolder'), icon: FolderUp, action: () => emit('import', targetDir.value, 'folder') },
    ],
  },
  { label: i18n.t('explorer.renamed'), icon: PenLine, separatorBefore: true, action: () => emit('rename', props.node) },
  { label: i18n.t('explorer.moveUp'), icon: ArrowUp, action: () => emit('shift', props.node, 'up') },
  { label: i18n.t('explorer.moveDown'), icon: ArrowDown, action: () => emit('shift', props.node, 'down') },
  {
    label: i18n.t('explorer.duplicate'),
    icon: Copy,
    disabled: isFolder.value,
    action: () => emit('duplicate', props.node),
  },
  {
    // 收藏是文档级动作，文件夹没有 frontmatter 可写
    label: i18n.t(favorited.value ? 'sidebar.removeFavorite' : 'explorer.addFavorite'),
    icon: favorited.value ? StarOff : Star,
    disabled: isFolder.value,
    action: () => emit('favorite', props.node),
  },
  {
    label: i18n.t('explorer.copyContent'),
    icon: ClipboardCopy,
    // 只有笔记能复制：看板与画板是 JSON，复制出去的东西对方打不开
    items: isFolder.value || props.node.kind !== 'note'
      ? []
      : [
          { label: i18n.t('explorer.copyMarkdown'), icon: Code, action: () => emit('copy', props.node, 'markdown') },
          { label: i18n.t('explorer.copyRich'), icon: Type, action: () => emit('copy', props.node, 'rich') },
        ],
  },
  { label: i18n.t('properties.title'), icon: Info, action: () => emit('properties', props.node) },
  {
    // 文件夹也能导出：整棵子树打成一个包
    label: i18n.t(isFolder.value ? 'explorer.exportFolder' : 'explorer.exportItem'),
    icon: Download,
    separatorBefore: true,
    action: () => emit('export', props.node),
  },
  {
    label: i18n.t('explorer.moveTrash'),
    icon: Trash2,
    separatorBefore: true,
    danger: true,
    action: () => emit('trash', props.node),
  },
])

function activate(): void {
  if (isFolder.value) emit('toggle', props.node.path)
  else emit('select', props.node)
}

// --- 拖拽 ---------------------------------------------------------------

function onDragStart(event: DragEvent): void {
  if (!event.dataTransfer) return
  writeTreeDrag(event.dataTransfer, props.node.path)
  event.dataTransfer.effectAllowed = 'move'
}

/** 只有文件夹能接收，且不能把目录拖进它自己的子树（否则路径成环） */
function canAccept(event: DragEvent, position: 'inside' | 'before' | 'after'): boolean {
  const source = readTreeDrag(event.dataTransfer)
  if (position === 'inside' && !isFolder.value) return false
  // dragover 阶段多数浏览器读不到数据，此时先放行，drop 时再严格校验。
  if (!source) return position !== 'inside' || isFolder.value
  if (source === props.node.path) return false
  const destination = position === 'inside'
    ? props.node.path
    : props.node.path.split('/').slice(0, -1).join('/')
  return !isDescendant(source, destination)
}

function positionAt(event: DragEvent): 'inside' | 'before' | 'after' {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
  if (isFolder.value && ratio >= 0.28 && ratio <= 0.72) return 'inside'
  return ratio < 0.5 ? 'before' : 'after'
}

function onDragOver(event: DragEvent): void {
  const position = positionAt(event)
  if (!canAccept(event, position)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropActive.value = true
  dropPosition.value = position
}

function onDrop(event: DragEvent): void {
  dropActive.value = false
  const position = dropPosition.value ?? positionAt(event)
  dropPosition.value = null
  const source = readTreeDrag(event.dataTransfer)
  if (!source || !canAccept(event, position)) return

  event.preventDefault()
  if (position === 'inside') {
    emit('move', source, props.node.path)
  } else {
    emit('reorder', source, props.node.path, position)
  }
}
</script>

<template>
  <li>
    <ContextMenu :items="menuItems">
      <button
        type="button"
        draggable="true"
        :class="
          cn(
            'flex w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm transition-colors',
            // 边框常驻、仅换颜色：拖拽高亮时不会把同级条目挤开（S2 规范）
            'border border-transparent',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
            // 右键时明确标示菜单作用于哪个条目（S3）
            'data-[state=open]:border-border data-[state=open]:bg-sidebar-accent',
            dropActive && 'border-primary bg-sidebar-accent',
            dropPosition === 'before' && 'border-t-primary',
            dropPosition === 'after' && 'border-b-primary',
          )
        "
        :style="{
          paddingLeft: `${depth * 0.75 + 0.5}rem`,
          paddingBlock: `calc(0.25rem * var(--light-density))`,
        }"
        :aria-expanded="isFolder ? isOpen : undefined"
        :title="i18n.t('tree.dragHint', { name: node.name })"
        @click="activate"
        @contextmenu.stop
        @dragstart="onDragStart"
        @dragover="onDragOver"
        @dragleave="dropActive = false; dropPosition = null"
        @drop.stop="onDrop"
      >
        <ChevronRight
          v-if="isFolder"
          class="size-3.5 shrink-0 transition-transform"
          :class="isOpen && 'rotate-90'"
        />
        <component :is="icon" v-else class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="truncate">{{ node.name }}</span>
        <Star v-if="favorited" class="ml-auto size-3 shrink-0 fill-current text-muted-foreground" />
      </button>
    </ContextMenu>

    <ul v-if="isFolder && isOpen && node.children?.length">
      <TreeItem
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :active-path="activePath"
        :expanded="expanded"
        :is-favorite="isFavorite"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
        @create="(dir, kind) => emit('create', dir, kind)"
        @import="(dir, source) => emit('import', dir, source)"
        @copy="(node, format) => emit('copy', node, format)"
        @rename="emit('rename', $event)"
        @duplicate="emit('duplicate', $event)"
        @trash="emit('trash', $event)"
        @properties="emit('properties', $event)"
        @favorite="emit('favorite', $event)"
        @export="emit('export', $event)"
        @move="(source, target) => emit('move', source, target)"
        @reorder="(source, target, position) => emit('reorder', source, target, position)"
        @shift="(node, direction) => emit('shift', node, direction)"
      />
    </ul>
  </li>
</template>

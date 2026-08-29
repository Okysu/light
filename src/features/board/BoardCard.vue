<script setup lang="ts">
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  CheckSquare,
  FileText,
  Flag,
  MoveIcon,
  SquarePen,
  Trash2,
} from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ContextMenu, { type MenuItem } from '@/components/ContextMenu.vue'
import type { BoardCard } from '@/core/board/types'
import { cn } from '@/lib/utils'
import { useAttachmentsStore } from '@/stores/attachments'
import { useEditorStore } from '@/stores/editor'
import { useI18nStore } from '@/stores/i18n'

const props = defineProps<{
  card: BoardCard
  dragging: boolean
  /** 所在列，用于「移动到」时排除自身 */
  columnId: string
  /** 全部列，供「移动到」列出目标 */
  columns: ReadonlyArray<{ id: string; title: string }>
}>()

const emit = defineEmits<{
  open: []
  dragstart: [event: DragEvent]
  archive: []
  remove: []
  moveTo: [columnId: string]
}>()
const i18n = useI18nStore()

const attachments = useAttachmentsStore()
const editor = useEditorStore()
const coverUrl = ref('')
let ownedCoverUrl = ''

watch(() => props.card.cover, async (src) => {
  if (ownedCoverUrl) attachments.release(ownedCoverUrl)
  ownedCoverUrl = ''
  coverUrl.value = ''
  if (!src || !editor.activePath) return
  const url = await attachments.resolve(src, editor.activePath)
  if (url) { ownedCoverUrl = url; coverUrl.value = url }
}, { immediate: true })

onBeforeUnmount(() => { if (ownedCoverUrl) attachments.release(ownedCoverUrl) })

/** 可移动到的目标列，由父级传入——卡片自己不该知道整个看板的结构 */
const menuItems = computed<MenuItem[]>(() => [
  { label: i18n.t('board.openCard'), icon: SquarePen, action: () => emit('open') },
  {
    label: i18n.t('board.moveTo'),
    icon: MoveIcon,
    separatorBefore: true,
    // 子项为空（只有一列）时整条不渲染，见 ContextMenu
    items: props.columns
      .filter((column) => column.id !== props.columnId)
      .map((column) => ({
        label: column.title,
        action: () => emit('moveTo', column.id),
      })),
  },
  {
    label: i18n.t(props.card.archived ? 'board.unarchive' : 'board.archive'),
    icon: props.card.archived ? ArchiveRestore : Archive,
    separatorBefore: true,
    action: () => emit('archive'),
  },
  { label: i18n.t('board.deleteCard'), icon: Trash2, danger: true, action: () => emit('remove') },
])

/** 完成进度：只在有子任务时显示，没有的话这行就是噪音 */
const checklist = computed(() => {
  const total = props.card.checklist.length
  if (total === 0) return null
  return { done: props.card.checklist.filter((item) => item.done).length, total }
})

/**
 * 截止日期的紧迫程度。
 * 只分「过期 / 三天内 / 其余」三档——再细分用户也分辨不出颜色差别。
 */
const dueState = computed<'overdue' | 'soon' | 'normal' | null>(() => {
  if (!props.card.due) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(`${props.card.due}T00:00:00`)
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000)

  if (days < 0) return 'overdue'
  if (days <= 3) return 'soon'
  return 'normal'
})

const PRIORITY_KEYS = { low: 'board.low', normal: 'board.normal', high: 'board.high' } as const
</script>

<template>
  <ContextMenu :items="menuItems">
    <article
    draggable="true"
    :class="
      cn(
        'cursor-pointer space-y-1.5 rounded-md border border-border bg-background p-2.5 text-left shadow-sm transition-colors',
        'hover:border-ring',
        // 拖拽中的卡片留个淡影，让人看清自己正在搬哪一张
        dragging && 'opacity-40',
        card.archived && 'opacity-60',
      )
    "
    @click="emit('open')"
    @dragstart="emit('dragstart', $event)"
  >
    <img
      v-if="coverUrl"
      :src="coverUrl"
      alt=""
      class="mb-1.5 h-20 w-full rounded-sm object-cover"
    />

    <p class="text-sm leading-snug">{{ card.title || i18n.t('board.untitledCard') }}</p>

    <div v-if="card.tags.length > 0" class="flex flex-wrap gap-1">
      <span
        v-for="tag in card.tags"
        :key="tag"
        class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
      >
        {{ tag }}
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
      <span v-if="card.archived" class="flex items-center gap-1">
        <Archive class="size-3" />
        {{ i18n.t('board.archived') }}
      </span>

      <span
        v-if="dueState"
        :class="
          cn(
            'flex items-center gap-1',
            dueState === 'overdue' && 'text-destructive',
            dueState === 'soon' && 'text-foreground',
          )
        "
      >
        <CalendarClock class="size-3" />
        {{ card.due }}
      </span>

      <span v-if="card.priority !== 'normal'" class="flex items-center gap-1">
        <Flag class="size-3" />
        {{ i18n.t(PRIORITY_KEYS[card.priority]) }}
      </span>

      <span v-if="checklist" class="flex items-center gap-1">
        <CheckSquare class="size-3" />
        {{ checklist.done }}/{{ checklist.total }}
      </span>

      <span v-if="card.notePath" class="flex items-center gap-1" :title="i18n.t('board.linked')">
        <FileText class="size-3" />
      </span>

      <span v-if="card.assignee" class="ml-auto truncate">{{ card.assignee }}</span>
      </div>
    </article>
  </ContextMenu>
</template>

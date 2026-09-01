<script setup lang="ts">
import { Archive, MoreHorizontal, Plus, Trash2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import ContextMenu, { type MenuAction } from '@/components/ContextMenu.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { countCards } from '@/core/board/operations'
import { isBoardCardDrag, readBoardCardDrag } from '@/core/board/drag'
import type { BoardColumn } from '@/core/board/types'
import { useI18nStore } from '@/stores/i18n'
import BoardCardView from './BoardCard.vue'

const props = defineProps<{
  column: BoardColumn
  /** 未经筛选的原始列，用于显示真实总数 */
  source: BoardColumn | undefined
  draggingCardId: string | null
  documentPath: string
  /** 全部列，卡片的「移动到」菜单要用 */
  columns: ReadonlyArray<{ id: string; title: string }>
}>()

const emit = defineEmits<{
  addCard: []
  openCard: [cardId: string]
  archiveCard: [cardId: string]
  removeCard: [cardId: string]
  moveCardTo: [cardId: string, columnId: string]
  rename: [title: string]
  remove: []
  archiveAll: []
  cardDragStart: [cardId: string]
  cardDragEnd: []
  /** 卡片落到本列的第几位；index 为 undefined 表示放到末尾 */
  drop: [cardId: string, index: number | undefined]
}>()

const editingTitle = ref(false)
const i18n = useI18nStore()
const titleDraft = ref('')
const actionsOpen = ref(false)
/** 拖拽悬停时的插入位置，null 表示当前没有卡片悬在本列上 */
const dropIndex = ref<number | null>(null)

const counts = computed(() => countCards(props.source ?? props.column))

const menuItems = computed<MenuAction[]>(() => [
  { label: i18n.t('board.renameColumn'), icon: MoreHorizontal, action: startRename },
  { label: i18n.t('board.addCard'), icon: Plus, action: () => emit('addCard') },
  { label: i18n.t('board.archiveColumn'), icon: Archive, separatorBefore: true, action: () => emit('archiveAll') },
  { label: i18n.t('board.deleteColumn'), icon: Trash2, danger: true, separatorBefore: true, action: () => emit('remove') },
])

function runAction(action: MenuAction): void {
  actionsOpen.value = false
  void action.action()
}

function startRename(): void {
  titleDraft.value = props.column.title
  editingTitle.value = true
}

function commitRename(): void {
  editingTitle.value = false
  const next = titleDraft.value.trim()
  if (next && next !== props.column.title) emit('rename', next)
}

/**
 * 算出应当插入到第几张卡片之前。
 *
 * 以每张卡片的**垂直中线**为界：光标在上半部就插到它前面，下半部插到后面。
 * 用中线而不是整块区域，是为了让「插到两张卡之间」这个意图能被稳定表达出来。
 */
function onDragOver(event: DragEvent): void {
  if (!props.draggingCardId && !isBoardCardDrag(event.dataTransfer)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

  const list = event.currentTarget as HTMLElement
  const cards = [...list.querySelectorAll<HTMLElement>('[data-card-id]')]

  let index = cards.length
  for (const [i, element] of cards.entries()) {
    const box = element.getBoundingClientRect()
    if (event.clientY < box.top + box.height / 2) {
      index = i
      break
    }
  }

  dropIndex.value = index
}

function onDrop(event: DragEvent): void {
  const cardId = readBoardCardDrag(event.dataTransfer)
  const index = dropIndex.value
  dropIndex.value = null
  if (cardId) emit('drop', cardId, index ?? undefined)
}
</script>

<template>
  <ContextMenu :items="menuItems">
    <!-- 整列空白都可唤起列菜单；卡片自身会阻止冒泡并显示卡片菜单。 -->
    <section class="flex h-full w-72 shrink-0 flex-col rounded-lg border border-border bg-sidebar" @contextmenu.stop>
      <header class="flex shrink-0 items-center gap-2 px-3 py-2">
        <Input
        v-if="editingTitle"
        v-model="titleDraft"
        class="h-7 text-sm"
        autofocus
        @blur="commitRename"
        @keydown.enter.prevent="commitRename"
        @keydown.esc="editingTitle = false"
      />
      <template v-else>
        <h3 class="min-w-0 flex-1 truncate text-sm font-medium" @dblclick="startRename">
          {{ column.title }}
        </h3>
        <span class="shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">
          {{ column.cards.length }}<template v-if="counts.total !== column.cards.length">/{{ counts.total }}</template>
        </span>
        <Popover v-model:open="actionsOpen">
          <PopoverTrigger as-child>
            <Button
              size="icon-sm"
              variant="ghost"
              :title="i18n.t('board.columnActions')"
              @click.stop
            >
              <MoreHorizontal />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-48 p-1">
            <button
              v-for="item in menuItems"
              :key="item.label"
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              :class="item.danger && 'text-destructive hover:bg-destructive/10'"
              @click="runAction(item)"
            >
              <component :is="item.icon" v-if="item.icon" class="size-4" />
              {{ item.label }}
            </button>
          </PopoverContent>
        </Popover>
        </template>
      </header>

      <!-- 卡片列表本身就是放置区：空列也要能接住卡片，所以高度撑满 -->
      <div
        class="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2"
        @dragover="onDragOver"
        @dragleave="dropIndex = null"
        @drop.prevent="onDrop"
      >
      <template v-for="(card, index) in column.cards" :key="card.id">
        <div v-if="dropIndex === index" class="h-0.5 rounded bg-primary" />
        <div :data-card-id="card.id" @contextmenu.stop>
          <BoardCardView
            :card="card"
            :dragging="draggingCardId === card.id"
            :column-id="column.id"
            :columns="columns"
            :document-path="documentPath"
            @open="emit('openCard', card.id)"
            @dragstart="emit('cardDragStart', card.id)"
            @dragend="emit('cardDragEnd')"
            @archive="emit('archiveCard', card.id)"
            @remove="emit('removeCard', card.id)"
            @move-to="emit('moveCardTo', card.id, $event)"
          />
        </div>
      </template>

      <div v-if="dropIndex === column.cards.length" class="h-0.5 rounded bg-primary" />

      <p
        v-if="column.cards.length === 0 && dropIndex === null"
        class="px-1 py-6 text-center text-xs text-muted-foreground"
      >
        {{ i18n.t('board.empty') }}
      </p>
      </div>

      <footer class="shrink-0 px-2 pb-2">
        <!-- 添加走对话框，与新建笔记 / 看板保持同一种交互 -->
        <Button
          class="w-full justify-start text-muted-foreground"
          size="sm"
          variant="ghost"
          @click="emit('addCard')"
        >
          <Plus />
          {{ i18n.t('board.addCard') }}
        </Button>
      </footer>

    </section>
  </ContextMenu>
</template>

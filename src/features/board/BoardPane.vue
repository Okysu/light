<script setup lang="ts">
import { Filter, Plus, X } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { findCard } from '@/core/board/operations'
import type { CardPriority } from '@/core/board/types'
import { useConfirm } from '@/composables/use-confirm'
import { usePrompt } from '@/composables/use-prompt'
import { useBoardStore } from '@/stores/board'
import BoardColumnView from './BoardColumn.vue'
import CardDetail from './CardDetail.vue'
import { useI18nStore } from '@/stores/i18n'

/**
 * 看板视图（模块 3）。
 *
 * 拖拽用原生 HTML5 DnD，不引拖拽库：文件树的拖拽移动已经是这一套，
 * 多一个库就多一套手势语义，用户会觉得两处「拖起来不一样」。
 */

const props = defineProps<{ path: string }>()

const board = useBoardStore()
const i18n = useI18nStore()
const { confirm } = useConfirm()
const { prompt } = usePrompt()

const draggingCardId = ref<string | null>(null)
const openCardId = ref<string | null>(null)
const filterOpen = ref(false)
const addingColumn = ref(false)
const newColumnTitle = ref('')

/** 「不限」的哨兵：reka-ui 的 SelectItem 不接受空字符串作为 value */
const ANY = '__any__'

watch(() => props.path, (next) => void board.open(next), { immediate: true })

const openCard = computed(() =>
  board.board && openCardId.value ? findCard(board.board, openCardId.value) : null,
)

/** 按 id 找原始列，用于显示「筛选后 / 总数」 */
function sourceColumn(columnId: string) {
  return board.board?.columns.find((column) => column.id === columnId)
}

function onCardDrop(cardId: string, columnId: string, index: number | undefined): void {
  draggingCardId.value = null
  board.moveCard(cardId, columnId, index)
}

function commitAddColumn(): void {
  const title = newColumnTitle.value.trim()
  if (title) board.addColumn(title)
  newColumnTitle.value = ''
  addingColumn.value = false
}

/** 供卡片的「移动到」菜单列出目标列 */
const columnSummaries = computed(() =>
  (board.board?.columns ?? []).map((column) => ({ id: column.id, title: column.title })),
)

/** 添加卡片走对话框，与新建笔记 / 看板保持同一种交互 */
async function addCard(columnId: string): Promise<void> {
  const title = await prompt({ title: i18n.t('board.addCard'), defaultValue: '', confirmLabel: i18n.t('common.add') })
  if (title) board.addCard(columnId, title)
}

function toggleArchive(cardId: string): void {
  const card = board.board ? findCard(board.board, cardId) : null
  if (card) board.setArchived(cardId, !card.archived)
}

async function removeCard(cardId: string): Promise<void> {
  const card = board.board ? findCard(board.board, cardId) : null
  const ok = await confirm({
    title: i18n.t('board.deleteConfirmTitle'),
    description: i18n.t('board.deleteConfirmDescription', { name: card?.title || i18n.t('board.untitledCard') }),
    confirmLabel: i18n.t('common.delete'),
    danger: true,
  })
  if (ok) board.removeCard(cardId)
}

async function removeColumn(columnId: string): Promise<void> {
  const column = sourceColumn(columnId)
  const ok = await confirm({
    title: i18n.t('board.deleteColumnTitle'),
    description: i18n.t('board.deleteColumnDescription', { name: column?.title ?? '', count: column?.cards.length ?? 0 }),
    confirmLabel: i18n.t('common.delete'),
    danger: true,
  })
  if (ok) board.removeColumn(columnId)
}

function clearFilter(): void {
  board.filter = {}
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- 工具条：筛选入口与状态 -->
    <div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <Button
        size="sm"
        :variant="board.hasFilter ? 'default' : 'ghost'"
        @click="filterOpen = !filterOpen"
      >
        <Filter />
        {{ i18n.t('board.filter') }}
      </Button>

      <Button v-if="board.hasFilter" size="sm" variant="ghost" @click="clearFilter">
        <X />
        {{ i18n.t('board.clear') }}
      </Button>

      <span class="ml-auto text-xs text-muted-foreground">
        {{ board.saving ? i18n.t('board.saving') : board.dirty ? i18n.t('save.unsaved') : '' }}
      </span>
    </div>

    <!-- 筛选面板（3.5）。收起时完全不占位，看板才是主体 -->
    <div v-if="filterOpen" class="grid shrink-0 grid-cols-2 gap-3 border-b border-border px-3 py-3 md:grid-cols-4">
      <div class="space-y-1">
        <Label class="text-xs font-normal text-muted-foreground">{{ i18n.t('board.keyword') }}</Label>
        <Input
          :model-value="board.filter.keyword ?? ''"
          :placeholder="i18n.t('board.keywordPlaceholder')"
          @update:model-value="board.filter = { ...board.filter, keyword: String($event) }"
        />
      </div>

      <div class="space-y-1">
        <Label class="text-xs font-normal text-muted-foreground">{{ i18n.t('board.priority') }}</Label>
        <Select
          :model-value="board.filter.priority ?? ANY"
          @update:model-value="
            board.filter = { ...board.filter, priority: $event === ANY ? undefined : ($event as CardPriority) }
          "
        >
          <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="ANY">{{ i18n.t('board.any') }}</SelectItem>
            <SelectItem value="high">{{ i18n.t('board.high') }}</SelectItem>
            <SelectItem value="normal">{{ i18n.t('board.normal') }}</SelectItem>
            <SelectItem value="low">{{ i18n.t('board.low') }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="space-y-1">
        <Label class="text-xs font-normal text-muted-foreground">{{ i18n.t('board.dueBy') }}</Label>
        <Input
          type="date"
          :model-value="board.filter.dueBefore ?? ''"
          @change="
            board.filter = {
              ...board.filter,
              dueBefore: ($event.target as HTMLInputElement).value || undefined,
            }
          "
        />
      </div>

      <div class="space-y-1">
        <Label class="text-xs font-normal text-muted-foreground">{{ i18n.t('board.tags') }}</Label>
        <Select
          :model-value="board.filter.tags?.[0] ?? ANY"
          @update:model-value="
            board.filter = { ...board.filter, tags: $event === ANY ? undefined : [$event as string] }
          "
        >
          <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="ANY">{{ i18n.t('board.any') }}</SelectItem>
            <SelectItem v-for="tag in board.allTags" :key="tag" :value="tag">{{ tag }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Label class="col-span-2 flex cursor-pointer items-center gap-2 text-xs font-normal md:col-span-4">
        <Checkbox
          :model-value="board.filter.includeArchived === true"
          @update:model-value="board.filter = { ...board.filter, includeArchived: $event === true }"
        />
        {{ i18n.t('board.showArchived') }}
      </Label>
    </div>

    <!-- 列区域：横向滚动，纵向撑满 -->
    <div v-if="board.visible" class="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
      <BoardColumnView
        v-for="column in board.visible.columns"
        :key="column.id"
        :column="column"
        :source="sourceColumn(column.id)"
        :dragging-card-id="draggingCardId"
        :columns="columnSummaries"
        @add-card="addCard(column.id)"
        @open-card="openCardId = $event"
        @archive-card="toggleArchive($event)"
        @remove-card="removeCard($event)"
        @move-card-to="(cardId, columnId) => board.moveCard(cardId, columnId)"
        @rename="board.renameColumn(column.id, $event)"
        @remove="removeColumn(column.id)"
        @archive-all="board.archiveColumn(column.id)"
        @card-drag-start="draggingCardId = $event"
        @card-drag-end="draggingCardId = null"
        @drop="(cardId, index) => onCardDrop(cardId, column.id, index)"
      />

      <!-- 新增列固定在最右，与卡片的「添加」保持同一种位置语言 -->
      <div class="w-72 shrink-0">
        <div v-if="addingColumn" class="space-y-1.5 rounded-lg border border-border bg-sidebar p-2">
          <Input
            v-model="newColumnTitle"
            :placeholder="i18n.t('board.columnName')"
            autofocus
            @keydown.enter.prevent="commitAddColumn"
            @keydown.esc="addingColumn = false"
          />
          <div class="flex gap-1.5">
            <Button size="sm" :disabled="!newColumnTitle.trim()" @click="commitAddColumn">{{ i18n.t('common.add') }}</Button>
            <Button size="sm" variant="ghost" @click="addingColumn = false">{{ i18n.t('common.cancel') }}</Button>
          </div>
        </div>

        <Button
          v-else
          class="w-full justify-start text-muted-foreground"
          variant="ghost"
          @click="addingColumn = true"
        >
          <Plus />
          {{ i18n.t('board.addColumn') }}
        </Button>
      </div>
    </div>

    <p v-else class="flex h-full items-center justify-center text-sm text-muted-foreground">
      {{ board.loadError ?? i18n.t('board.opening') }}
    </p>

    <CardDetail
      :card="openCard"
      :suggestions="board.allTags"
      @close="openCardId = null"
      @update="openCardId && board.updateCard(openCardId, $event)"
      @remove="
        () => {
          if (openCardId) board.removeCard(openCardId)
          openCardId = null
        }
      "
    />
  </div>
</template>

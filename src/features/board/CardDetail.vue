<script setup lang="ts">
import { Archive, ArchiveRestore, FileText, Image as ImageIcon, Plus, Trash2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import TagInput from '@/components/TagInput.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { BoardCard, CardPriority } from '@/core/board/types'
import { stem } from '@/core/path'
import { flattenTree } from '@/core/workspace/tree'
import { useConfirm } from '@/composables/use-confirm'
import { useEditorStore } from '@/stores/editor'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAttachmentsStore } from '@/stores/attachments'
import { useI18nStore } from '@/stores/i18n'

const props = defineProps<{ card: BoardCard | null; suggestions: string[]; documentPath: string }>()

const emit = defineEmits<{
  close: []
  update: [patch: Partial<BoardCard>]
  remove: []
}>()

const workspace = useWorkspaceStore()
const editor = useEditorStore()
const attachments = useAttachmentsStore()
const i18n = useI18nStore()
const { confirm } = useConfirm()

const newChecklistItem = ref('')

const PRIORITIES = computed<Array<{ value: CardPriority; label: string }>>(() => [
  { value: 'low', label: i18n.t('board.low') },
  { value: 'normal', label: i18n.t('board.normal') },
  { value: 'high', label: i18n.t('board.high') },
])

/** 「不关联」的哨兵：reka-ui 的 SelectItem 不接受空字符串作为 value */
const NO_NOTE = '__none__'

const notePaths = computed(() =>
  flattenTree(workspace.tree)
    .filter((node) => node.kind === 'note')
    .map((node) => node.path),
)

function patch(changes: Partial<BoardCard>): void {
  emit('update', changes)
}

function pickCover(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return
    const href = await attachments.save(new Uint8Array(await file.arrayBuffer()), file.type, props.documentPath, file.name)
    patch({ cover: href })
  })
  input.click()
}

function addChecklistItem(): void {
  const text = newChecklistItem.value.trim()
  if (!text || !props.card) return

  patch({
    checklist: [...props.card.checklist, { id: crypto.randomUUID(), text, done: false }],
  })
  newChecklistItem.value = ''
}

function toggleChecklistItem(id: string, done: boolean): void {
  if (!props.card) return
  patch({
    checklist: props.card.checklist.map((item) => (item.id === id ? { ...item, done } : item)),
  })
}

function removeChecklistItem(id: string): void {
  if (!props.card) return
  patch({ checklist: props.card.checklist.filter((item) => item.id !== id) })
}

/** 跳转到关联的笔记（3.3）。跳之前先关面板，否则会盖在编辑器上 */
async function openNote(): Promise<void> {
  if (!props.card?.notePath) return
  emit('close')
  await editor.openNote(props.card.notePath)
}

async function remove(): Promise<void> {
  const ok = await confirm({
    title: i18n.t('board.deleteConfirmTitle'),
    description: i18n.t('board.deleteConfirmDescription', { name: props.card?.title || i18n.t('board.untitledCard') }),
    confirmLabel: i18n.t('common.delete'),
    danger: true,
  })
  if (ok) emit('remove')
}
</script>

<template>
  <Dialog
    :open="card !== null"
    :title="card?.title || i18n.t('board.card')"
    hide-header
    class="max-h-[85vh] w-[36rem] max-w-[94vw]"
    @update:open="!$event && emit('close')"
  >
    <div v-if="card" class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <!-- 标题单独一行且字号大些：它是卡片的主体 -->
      <Input
        :model-value="card.title"
        class="h-auto border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
        :placeholder="i18n.t('board.title')"
        @change="patch({ title: ($event.target as HTMLInputElement).value })"
      />

      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1.5">
          <Label class="text-xs font-normal text-muted-foreground">{{ i18n.t('board.due') }}</Label>
          <Input
            type="date"
            :model-value="card.due"
            @change="patch({ due: ($event.target as HTMLInputElement).value })"
          />
        </div>

        <div class="space-y-1.5">
          <Label class="text-xs font-normal text-muted-foreground">{{ i18n.t('board.priority') }}</Label>
          <Select :model-value="card.priority" @update:model-value="patch({ priority: $event as CardPriority })">
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="item in PRIORITIES" :key="item.value" :value="item.value">
                {{ item.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div class="space-y-1.5">
        <Label class="text-xs font-normal text-muted-foreground">{{ i18n.t('board.cover') }}</Label>
        <div class="flex gap-2">
        <Button variant="outline" size="sm" @click="pickCover"><ImageIcon />{{ i18n.t(card.cover ? 'board.changeCover' : 'board.chooseCover') }}</Button>
          <Button v-if="card.cover" variant="ghost" size="sm" @click="patch({ cover: '' })">{{ i18n.t('common.remove') }}</Button>
        </div>
      </div>

      <div class="space-y-1.5">
        <Label class="text-xs font-normal text-muted-foreground">{{ i18n.t('board.assignee') }}</Label>
        <Input
          :model-value="card.assignee"
          :placeholder="i18n.t('board.unspecified')"
          @change="patch({ assignee: ($event.target as HTMLInputElement).value })"
        />
      </div>

      <div class="space-y-1.5">
        <Label class="text-xs font-normal text-muted-foreground">{{ i18n.t('board.tags') }}</Label>
        <TagInput
          :values="card.tags"
          :suggestions="suggestions"
          :placeholder="i18n.t('board.tagsPlaceholder')"
          @add="patch({ tags: [...card.tags, $event] })"
          @remove="patch({ tags: card.tags.filter((tag) => tag !== $event) })"
        />
      </div>

      <!-- 关联笔记（3.3）：卡片是「要做的事」，笔记是「事情的内容」 -->
      <div class="space-y-1.5">
        <Label class="text-xs font-normal text-muted-foreground">{{ i18n.t('board.note') }}</Label>
        <div class="flex gap-2">
          <Select
            :model-value="card.notePath || NO_NOTE"
            @update:model-value="patch({ notePath: $event === NO_NOTE ? '' : ($event as string) })"
          >
            <SelectTrigger class="flex-1"><SelectValue :placeholder="i18n.t('board.unlinked')" /></SelectTrigger>
            <SelectContent>
              <SelectItem :value="NO_NOTE">{{ i18n.t('board.unlink') }}</SelectItem>
              <SelectItem v-for="path in notePaths" :key="path" :value="path">{{ stem(path) }}</SelectItem>
            </SelectContent>
          </Select>
          <Button v-if="card.notePath" variant="outline" size="icon" :title="i18n.t('board.openNote')" @click="openNote">
            <FileText />
          </Button>
        </div>
      </div>

      <div class="space-y-1.5">
        <Label class="text-xs font-normal text-muted-foreground">{{ i18n.t('board.description') }}</Label>
        <Textarea
          :model-value="card.description"
          rows="4"
          :placeholder="i18n.t('board.markdown')"
          class="resize-y text-sm"
          @change="patch({ description: ($event.target as HTMLTextAreaElement).value })"
        />
      </div>

      <div class="space-y-1.5">
        <Label class="text-xs font-normal text-muted-foreground">
          {{ i18n.t('board.checklist') }}
          <span v-if="card.checklist.length > 0">
            （{{ card.checklist.filter((i) => i.done).length }}/{{ card.checklist.length }}）
          </span>
        </Label>

        <ul class="space-y-1">
          <li v-for="item in card.checklist" :key="item.id" class="flex items-center gap-2">
            <Checkbox
              :model-value="item.done"
              @update:model-value="toggleChecklistItem(item.id, $event === true)"
            />
            <span class="min-w-0 flex-1 truncate text-sm" :class="item.done && 'text-muted-foreground line-through'">
              {{ item.text }}
            </span>
            <Button size="icon-sm" variant="ghost" :title="i18n.t('common.delete')" @click="removeChecklistItem(item.id)">
              <X />
            </Button>
          </li>
        </ul>

        <div class="flex gap-2">
          <Input
            v-model="newChecklistItem"
            class="flex-1"
            :placeholder="i18n.t('board.subtask')"
            @keydown.enter.prevent="addChecklistItem"
          />
          <Button variant="outline" :disabled="!newChecklistItem.trim()" @click="addChecklistItem">
            <Plus />
          </Button>
        </div>
      </div>
    </div>

    <footer v-if="card" class="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
      <Button size="sm" variant="outline" @click="patch({ archived: !card.archived })">
        <ArchiveRestore v-if="card.archived" />
        <Archive v-else />
        {{ i18n.t(card.archived ? 'board.unarchive' : 'board.archive') }}
      </Button>
      <Button class="ml-auto" size="sm" variant="ghost" @click="remove">
        <Trash2 />
        {{ i18n.t('board.deleteCard') }}
      </Button>
      <Button size="sm" @click="emit('close')">{{ i18n.t('common.done') }}</Button>
    </footer>
  </Dialog>
</template>

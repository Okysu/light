<script setup lang="ts">
import { History, RotateCcw, Save } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useConfirm } from '@/composables/use-confirm'
import { lineDiff, type DiffLine } from '@/core/history/line-diff'
import type { HistoryEntry, HistorySnapshot } from '@/core/history/history-service'
import { formatBytes, formatRelativeTime } from '@/lib/utils'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18nStore } from '@/stores/i18n'

const ui = useUiStore()
const editor = useEditorStore()
const workspace = useWorkspaceStore()
const i18n = useI18nStore()
const { confirm } = useConfirm()

const entries = ref<HistoryEntry[]>([])
const selectedId = ref<string | null>(null)
const snapshot = ref<HistorySnapshot | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const feedback = ref('')

const differences = computed(() =>
  snapshot.value && editor.note ? lineDiff(snapshot.value.content, editor.note.content) : [],
)
const added = computed(() => differences.value.filter((line) => line.kind === 'added').length)
const removed = computed(() => differences.value.filter((line) => line.kind === 'removed').length)

function reasonLabel(reason: HistoryEntry['reason']): string {
  if (reason === 'manual') return i18n.t('history.manual')
  if (reason === 'before-restore') return i18n.t('history.beforeRestore')
  return i18n.t('history.automatic')
}

function exactTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(i18n.locale, { hour12: false })
}

async function load(selectId?: string | null): Promise<void> {
  const note = editor.note
  if (!note || !workspace.history) return
  busy.value = true
  error.value = null
  try {
    entries.value = await workspace.history.list(note.id)
    const next = selectId ?? entries.value[0]?.id ?? null
    await select(next)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

async function select(entryId: string | null): Promise<void> {
  selectedId.value = entryId
  snapshot.value = null
  if (!entryId || !editor.note || !workspace.history) return
  try {
    snapshot.value = await workspace.history.read(editor.note.id, entryId)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function saveCurrent(): Promise<void> {
  busy.value = true
  feedback.value = ''
  error.value = null
  try {
    const entry = await editor.createHistoryVersion()
    feedback.value = i18n.t(entry ? 'history.saved' : 'history.noChanges')
    await load(entry?.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

async function restore(): Promise<void> {
  const entry = entries.value.find((candidate) => candidate.id === selectedId.value)
  if (!entry) return
  const ok = await confirm({
    title: i18n.t('history.restoreConfirmTitle'),
    description: i18n.t('history.restoreConfirmDescription', { time: exactTime(entry.createdAt) }),
    confirmLabel: i18n.t('history.restoreConfirm'),
  })
  if (!ok) return

  busy.value = true
  error.value = null
  try {
    await editor.restoreHistoryVersion(entry.id)
    ui.historyOpen = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

watch(
  () => ui.historyOpen,
  async (open) => {
    if (!open) return
    entries.value = []
    selectedId.value = null
    snapshot.value = null
    feedback.value = ''
    error.value = null
    await editor.flush()
    await load()
  },
)

function rowClass(line: DiffLine): string {
  if (line.kind === 'added') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (line.kind === 'removed') return 'bg-destructive/10 text-destructive'
  return 'text-muted-foreground'
}
</script>

<template>
  <Dialog
    v-model:open="ui.historyOpen"
    :title="i18n.t('history.title')"
    :description="i18n.t('history.description')"
    class="h-[78vh] w-[64rem] max-w-[96vw]"
  >
    <div class="flex items-center justify-between gap-3 border-b border-border px-5 pb-3 pt-2">
      <div class="min-w-0">
        <p class="truncate text-sm font-medium">{{ editor.note?.title }}</p>
        <p class="text-xs text-muted-foreground">{{ i18n.t('history.policy') }}</p>
      </div>
      <Button size="sm" variant="outline" :disabled="busy || !editor.note" @click="saveCurrent">
        <Save />
        {{ i18n.t('history.saveCurrent') }}
      </Button>
    </div>

    <div class="flex min-h-0 flex-1">
      <aside class="w-60 shrink-0 border-r border-border">
        <ScrollArea class="h-full" viewport-class="p-2">
          <p v-if="busy && entries.length === 0" class="px-3 py-8 text-center text-sm text-muted-foreground">
            {{ i18n.t('history.loading') }}
          </p>
          <div v-else-if="entries.length === 0" class="px-3 py-10 text-center text-muted-foreground">
            <History class="mx-auto mb-2 size-5" />
            <p class="text-sm">{{ i18n.t('history.empty') }}</p>
            <p class="mt-1 text-xs">{{ i18n.t('history.emptyHint') }}</p>
          </div>
          <button
            v-for="entry in entries"
            :key="entry.id"
            type="button"
            class="mb-1 w-full rounded-md border px-3 py-2 text-left transition-colors"
            :class="selectedId === entry.id ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-accent'"
            @click="select(entry.id)"
          >
            <span class="block text-sm">{{ formatRelativeTime(entry.createdAt, i18n.locale) }}</span>
            <span class="mt-0.5 block text-xs text-muted-foreground">{{ exactTime(entry.createdAt) }}</span>
            <span class="mt-1 block text-[11px] text-muted-foreground">
              {{ reasonLabel(entry.reason) }} · {{ formatBytes(entry.byteLength) }}
            </span>
          </button>
        </ScrollArea>
      </aside>

      <section class="flex min-w-0 flex-1 flex-col">
        <div class="flex min-h-10 items-center gap-3 border-b border-border px-4 text-xs text-muted-foreground">
          <template v-if="snapshot">
            <span v-if="added || removed">{{ i18n.t('history.diff', { added, removed }) }}</span>
            <span v-else>{{ i18n.t('history.same') }}</span>
            <Button class="ml-auto" size="sm" variant="outline" :disabled="busy" @click="restore">
              <RotateCcw />
              {{ i18n.t('history.restore') }}
            </Button>
          </template>
        </div>

        <ScrollArea class="min-h-0 flex-1" viewport-class="py-2 font-mono text-xs">
          <p v-if="!snapshot && entries.length" class="px-5 py-10 text-center text-muted-foreground">
            {{ i18n.t('history.select') }}
          </p>
          <div v-else-if="snapshot" class="min-w-max">
            <div
              v-for="(line, index) in differences"
              :key="`${index}:${line.kind}`"
              class="grid min-h-5 grid-cols-[3rem_3rem_1.5rem_minmax(20rem,1fr)] px-2 leading-5"
              :class="rowClass(line)"
            >
              <span class="select-none text-right opacity-50">{{ line.oldLine ?? '' }}</span>
              <span class="select-none text-right opacity-50">{{ line.newLine ?? '' }}</span>
              <span class="select-none text-center">{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ' }}</span>
              <span class="whitespace-pre pr-4">{{ line.text || ' ' }}</span>
            </div>
          </div>
        </ScrollArea>
      </section>
    </div>

    <p v-if="error || editor.historyError" class="border-t border-border px-5 py-2 text-xs text-destructive">
      {{ error || editor.historyError }}
    </p>
    <p v-else-if="feedback" class="border-t border-border px-5 py-2 text-xs text-muted-foreground" role="status">
      {{ feedback }}
    </p>
  </Dialog>
</template>

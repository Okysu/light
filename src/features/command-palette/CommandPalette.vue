<script setup lang="ts">
import {
  CaseSensitive,
  Columns2,
  Download,
  FilePlus,
  FileText,
  Focus,
  History as HistoryIcon,
  FolderPlus,
  CalendarDays,
  ClipboardCopy,
  Kanban,
  Moon,
  Paperclip,
  PencilRuler,
  Printer,
  Regex,
  Settings2,
  Share2,
  Sparkles,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { fuzzyFilter } from '@/core/fuzzy'
import type { MatchRange } from '@/core/search/search-service'
import { flattenTree } from '@/core/workspace/tree'
import { usePrompt } from '@/composables/use-prompt'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/editor'
import { useExportStore } from '@/stores/export'
import { useSearchStore } from '@/stores/search'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18nStore } from '@/stores/i18n'
import { SHORTCUT_BINDINGS } from '@/core/keyboard/bindings'
import { formatShortcut, isMacPlatform, resolveShortcut } from '@/core/keyboard/shortcut'
import { usePreferencesStore } from '@/stores/preferences'

/**
 * 命令面板：**唯一**的搜索与命令入口。
 *
 * 标题匹配与全文检索合并在这里，而不是分成两个面板——
 * 用户想找一篇笔记时并不会预先知道该用「按标题跳转」还是「全文搜索」，
 * 多一个入口只是多一次选择成本。命令与笔记同列展示，一次输入覆盖全部意图。
 */

interface Entry {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  group: 'documents' | 'commands'
  /** 全文命中时的正文片段与高亮区间 */
  snippet?: string
  ranges?: MatchRange[]
  /** 当前条件下无从执行。列出但不可选，让用户知道有这个功能、以及为什么现在用不了 */
  disabled?: boolean
  disabledReason?: string
  run: () => void | Promise<void>
}

const ui = useUiStore()
const workspace = useWorkspaceStore()
const editor = useEditorStore()
const exporter = useExportStore()
const theme = useThemeStore()
const search = useSearchStore()
const i18n = useI18nStore()
const preferences = usePreferencesStore()
const isMac = isMacPlatform()
const { prompt } = usePrompt()

const query = ref('')
const activeIndex = ref(0)
const input = ref<HTMLInputElement | null>(null)

const ICONS: Record<string, LucideIcon> = { note: FileText, board: Kanban, canvas: PencilRuler }

function shortcutHint(id: string): string {
  const binding = SHORTCUT_BINDINGS.find((candidate) => candidate.id === id)
  return binding ? formatShortcut(resolveShortcut(binding, preferences.shortcutOverrides), isMac) : ''
}

function folderOf(path: string): string {
  return path.split('/').slice(0, -1).join('/') || i18n.t('palette.root')
}

/** 空查询时列出全部文档，便于直接挑一篇打开 */
const allNotes = computed<Entry[]>(() =>
  flattenTree(workspace.tree)
    .filter((node) => node.kind !== 'folder')
    .map((node) => ({
      id: `note:${node.path}`,
      label: node.name,
      hint: folderOf(node.path),
      icon: ICONS[node.kind] ?? FileText,
      group: 'documents' as const,
      run: async () => { await editor.openNote(node.path) },
    })),
)

/** 全文命中：带片段与高亮，优先于纯标题匹配 */
const searchEntries = computed<Entry[]>(() =>
  search.results.map((hit) => ({
    id: `note:${hit.path}`,
    label: hit.title,
    hint: folderOf(hit.path),
    // 图标跟着文档类型走：看板卡片的命中显示成一张纸，用户会以为找错了东西
    icon: ICONS[hit.kind] ?? FileText,
    group: 'documents' as const,
    snippet: hit.snippet,
    ranges: hit.ranges,
    run: async () => { await editor.openNote(hit.path) },
  })),
)

/** 复制当前打开的笔记（2.8） */
async function copyCurrent(format: 'markdown' | 'rich'): Promise<void> {
  const path = editor.activePath
  if (!path || !workspace.storage) return

  const { documentHtml, documentMarkdown, writeToClipboard } = await import(
    '@/core/clipboard/copy-document'
  )
  const markdown = documentMarkdown(await workspace.storage.readText(path), path)
  await writeToClipboard(markdown, format === 'rich' ? await documentHtml(markdown) : undefined)
}

const actions = computed<Entry[]>(() => {
  const command = i18n.t('common.command')
  const openFirst = i18n.t('palette.openFirst')
  const createDocument = (kind: 'note' | 'board' | 'canvas') => async () => {
    const key = kind === 'note' ? 'explorer.newNote' : kind === 'board' ? 'explorer.newBoard' : 'explorer.newCanvas'
    const name = await prompt({ title: i18n.t(key), defaultValue: i18n.t('explorer.untitled'), confirmLabel: i18n.t('common.create') })
    if (name) await editor.openNote(await workspace.createNote('', name, kind))
  }
  return [
    { id: 'action:new-note', label: i18n.t('explorer.newNote'), hint: command, icon: FilePlus, group: 'commands', run: createDocument('note') },
    { id: 'action:new-board', label: i18n.t('explorer.newBoard'), hint: command, icon: Kanban, group: 'commands', run: createDocument('board') },
    { id: 'action:new-canvas', label: i18n.t('explorer.newCanvas'), hint: command, icon: PencilRuler, group: 'commands', run: createDocument('canvas') },
    { id: 'action:ai', label: i18n.t('palette.ai'), hint: shortcutHint('ai-assistant'), icon: Sparkles, group: 'commands', run: () => { ui.aiOpen = true } },
    { id: 'action:daily-note', label: i18n.t('palette.openDaily'), hint: shortcutHint('daily-note'), icon: CalendarDays, group: 'commands', run: async () => { await editor.openNote(await workspace.openDailyNote()) } },
    { id: 'action:copy-markdown', label: i18n.t('palette.copyMarkdown'), hint: command, icon: ClipboardCopy, group: 'commands', disabled: !editor.note, disabledReason: openFirst, run: () => copyCurrent('markdown') },
    { id: 'action:copy-rich', label: i18n.t('palette.copyRich'), hint: command, icon: ClipboardCopy, group: 'commands', disabled: !editor.note, disabledReason: openFirst, run: () => copyCurrent('rich') },
    { id: 'action:new-folder', label: i18n.t('explorer.newFolder'), hint: command, icon: FolderPlus, group: 'commands', run: async () => {
      const name = await prompt({ title: i18n.t('explorer.newFolder'), defaultValue: i18n.t('explorer.newFolder'), confirmLabel: i18n.t('common.create') })
      if (name) await workspace.createFolder('', name)
    } },
    { id: 'action:trash', label: i18n.t('palette.openTrash'), hint: command, icon: Trash2, group: 'commands', run: () => { ui.trashOpen = true } },
    { id: 'action:print', label: i18n.t('palette.print'), hint: command, icon: Printer, group: 'commands', run: () => {
      ui.commandPaletteOpen = false
      requestAnimationFrame(() => window.print())
    } },
    { id: 'action:export', label: i18n.t('palette.exportAll'), hint: command, icon: Download, group: 'commands', run: () => exporter.exportWorkspace() },
    { id: 'action:history', label: i18n.t('app.history'), hint: command, icon: HistoryIcon, group: 'commands', disabled: !editor.note, disabledReason: openFirst, run: () => { ui.historyOpen = true } },
    { id: 'action:attachments', label: i18n.t('palette.attachments'), hint: command, icon: Paperclip, group: 'commands', run: () => { ui.attachmentsOpen = true } },
    { id: 'action:graph', label: i18n.t('palette.graph'), hint: command, icon: Share2, group: 'commands', run: () => { ui.graphOpen = true } },
    { id: 'action:settings', label: i18n.t('settings.title'), hint: command, icon: Settings2, group: 'commands', run: () => { ui.settingsOpen = true } },
    { id: 'action:theme', label: theme.isDark ? i18n.t('palette.themeLight') : i18n.t('palette.themeDark'), hint: command, icon: theme.isDark ? Sun : Moon, group: 'commands', run: () => theme.toggleDark() },
    { id: 'action:zen', label: ui.zenMode ? i18n.t('palette.zenExit') : i18n.t('palette.zenEnter'), hint: command, icon: Focus, group: 'commands', run: () => ui.toggleZen() },
    { id: 'action:outline', label: ui.outlineVisible ? i18n.t('palette.outlineHide') : i18n.t('palette.outlineShow'), hint: command, icon: Columns2, group: 'commands', run: () => { ui.outlineVisible = !ui.outlineVisible } },
  ]
})

const results = computed<Entry[]>(() => {
  const keyword = query.value.trim()
  if (!keyword) return [...allNotes.value, ...actions.value]

  const matchedActions = fuzzyFilter(actions.value, keyword, (entry) => entry.label)

  // 全文命中优先；标题模糊匹配补充那些正文没命中、但标题像的笔记
  const hitIds = new Set(searchEntries.value.map((entry) => entry.id))
  const titleMatches = fuzzyFilter(allNotes.value, keyword, (entry) => entry.label).filter(
    (entry) => !hitIds.has(entry.id),
  )

  return [...searchEntries.value, ...titleMatches, ...matchedActions]
})

/** 按分组切片，用于插入分组标题；索引沿用全局序号，键盘导航才对得上 */
const grouped = computed(() => {
  const groups: Array<{ name: string; entries: Array<{ entry: Entry; index: number }> }> = []

  results.value.forEach((entry, index) => {
    const last = groups[groups.length - 1]
    if (last && last.name === entry.group) last.entries.push({ entry, index })
    else groups.push({ name: entry.group, entries: [{ entry, index }] })
  })

  return groups
})

// 打开时建索引并聚焦
watch(
  () => ui.commandPaletteOpen,
  async (open) => {
    if (!open) return
    query.value = ''
    activeIndex.value = 0
    await nextTick()
    input.value?.focus()
    await search.ensureIndex()
  },
)

// 输入即全文检索；索引在内存中，无需防抖
watch([query, () => search.regex, () => search.caseSensitive], () => {
  activeIndex.value = 0
  search.query = query.value
  search.run()
})

/**
 * 按高亮区间切分片段。
 * 用结构化数据而非拼 HTML：正文来自用户文件，v-html 等于把任意内容当 HTML 执行。
 */
function splitByRanges(text: string, ranges: MatchRange[]): Array<{ text: string; hit: boolean }> {
  if (ranges.length === 0) return [{ text, hit: false }]

  const parts: Array<{ text: string; hit: boolean }> = []
  let cursor = 0

  for (const range of ranges) {
    if (range.start > cursor) parts.push({ text: text.slice(cursor, range.start), hit: false })
    parts.push({ text: text.slice(range.start, range.end), hit: true })
    cursor = range.end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false })

  return parts
}

function move(delta: number): void {
  const total = results.value.length
  if (total === 0) return
  activeIndex.value = (activeIndex.value + delta + total) % total
}

async function runAt(index: number): Promise<void> {
  const entry = results.value[index]
  if (!entry || entry.disabled) return
  // 先关面板：动作里可能再打开别的对话框，避免两层模态叠在一起
  ui.commandPaletteOpen = false
  await entry.run()
}
</script>

<template>
  <Dialog
    v-model:open="ui.commandPaletteOpen"
    :title="i18n.t('palette.title')"
    :description="i18n.t('palette.description')"
    hide-header
    class="top-[12%] max-h-[74vh] translate-y-0"
  >
    <div class="border-b border-border px-4 py-3">
      <div class="flex items-center gap-2">
        <!-- 裸 input：搜索框与对话框顶栏是一体的，带边框的 Input 会割裂出一个方框。
             shadcn 的 Command 组件里 CommandInput 也是这么做的。 -->
        <input
          ref="input"
          v-model="query"
          type="text"
          :placeholder="search.regex ? i18n.t('palette.regexPlaceholder') : i18n.t('palette.placeholder')"
          class="light-command-input min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="runAt(activeIndex)"
        />

        <Button
          size="icon-sm"
          :variant="search.regex ? 'default' : 'ghost'"
          :title="i18n.t('palette.regex')"
          @click="search.regex = !search.regex"
        >
          <Regex />
        </Button>
        <Button
          size="icon-sm"
          :variant="search.caseSensitive ? 'default' : 'ghost'"
          :title="i18n.t('palette.case')"
          @click="search.caseSensitive = !search.caseSensitive"
        >
          <CaseSensitive />
        </Button>
      </div>

      <p class="mt-1.5 text-xs text-muted-foreground">
        <span v-if="search.indexing">{{ i18n.t('palette.indexing') }}</span>
        <span v-else-if="search.error" class="text-destructive">{{ search.error }}</span>
        <span v-else-if="query.trim()">{{ i18n.t('palette.results', { count: results.length }) }}</span>
      </p>
    </div>

    <ScrollArea class="min-h-0 flex-1" viewport-class="p-1">
      <p v-if="results.length === 0" class="px-3 py-8 text-center text-sm text-muted-foreground">
        {{ i18n.t('common.noResults') }}
      </p>

      <template v-for="group in grouped" :key="group.name">
        <p class="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {{ group.name === 'documents' ? i18n.t('common.documents') : i18n.t('common.command') }}
        </p>

        <button
          v-for="{ entry, index } in group.entries"
          :key="entry.id"
          type="button"
          :disabled="entry.disabled"
          :class="
            cn(
              'flex w-full flex-col gap-0.5 rounded-md border border-transparent px-3 py-2 text-left',
              index === activeIndex && !entry.disabled && 'bg-accent text-accent-foreground',
              entry.disabled && 'cursor-not-allowed opacity-50',
            )
          "
          @mouseenter="activeIndex = index"
          @click="runAt(index)"
        >
          <span class="flex items-center gap-2.5 text-sm">
            <component :is="entry.icon" class="size-4 shrink-0 text-muted-foreground" />
            <span class="truncate">{{ entry.label }}</span>
            <span class="ml-auto shrink-0 truncate text-xs text-muted-foreground">
              {{ entry.disabled ? entry.disabledReason ?? entry.hint : entry.hint }}
            </span>
          </span>

          <span
            v-if="entry.snippet"
            class="line-clamp-2 whitespace-pre-wrap break-all pl-[1.625rem] text-xs text-muted-foreground"
          >
            <template v-for="(part, partIndex) in splitByRanges(entry.snippet, entry.ranges ?? [])" :key="partIndex">
              <mark v-if="part.hit" class="rounded-sm bg-primary/30 px-0.5 font-medium text-foreground">{{
                part.text
              }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
        </button>
      </template>
    </ScrollArea>
  </Dialog>
</template>

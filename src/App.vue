<script setup lang="ts">
import { useEventListener, useMediaQuery } from '@vueuse/core'
import { Focus, History, ListTree, Moon, PanelLeft, Search, Sparkles, Sun } from 'lucide-vue-next'
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import AppLockOverlay from '@/features/security/AppLockOverlay.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import { Button } from '@/components/ui/button'
import { DESKTOP_EVENT, onDesktopEvent } from '@/core/desktop/events'
import { SHORTCUT_BINDINGS } from '@/core/keyboard/bindings'
import { formatShortcut, isMacPlatform, matchesShortcut, resolveShortcut } from '@/core/keyboard/shortcut'
import AiPanel from '@/features/ai/AiPanel.vue'
import CommandPalette from '@/features/command-palette/CommandPalette.vue'
import OutlinePanel from '@/features/editor/OutlinePanel.vue'
import TabBar from '@/features/editor/TabBar.vue'
import Sidebar from '@/features/explorer/Sidebar.vue'
import AttachmentsPanel from '@/features/attachments/AttachmentsPanel.vue'
import GraphPanel from '@/features/graph/GraphPanel.vue'
import HistoryPanel from '@/features/history/HistoryPanel.vue'
import { WELCOME_NOTE } from '@/features/onboarding/welcome-note'
import { installWelcomeAssets } from '@/features/onboarding/welcome-assets'
import PropertiesPanel from '@/features/properties/PropertiesPanel.vue'
import SettingsPanel from '@/features/settings/SettingsPanel.vue'
import TrashPanel from '@/features/trash/TrashPanel.vue'
import { formatRelativeTime } from '@/lib/utils'
import { useAiStore } from '@/stores/ai'
import { useEditorStore } from '@/stores/editor'
import { useExportStore } from '@/stores/export'
import { useAttachmentsStore } from '@/stores/attachments'
import { useCanvasStore } from '@/stores/canvas'
import { useBoardStore } from '@/stores/board'
import { useLinksStore } from '@/stores/links'
import { useThemeStore } from '@/stores/theme'
import { useCollectionsStore } from '@/stores/collections'
import { usePropertiesStore } from '@/stores/properties'
import { usePreferencesStore } from '@/stores/preferences'
import { useSearchStore } from '@/stores/search'
import { useSyncStore } from '@/stores/sync'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSecurityStore } from '@/stores/security'
import { useI18nStore } from '@/stores/i18n'
import ToastHost from '@/components/ui/toast/ToastHost.vue'
import { useToastStore } from '@/stores/toast'
import { useExtensionsStore } from '@/stores/extensions'
import DesktopTitleBar from '@/features/desktop/DesktopTitleBar.vue'

/**
 * 编辑器按需加载：Milkdown + ProseMirror + CodeMirror + KaTeX 合计超过 1 MB，
 * 而用户打开第一篇笔记之前完全用不到。首屏因此只加载外壳与文件树。
 */
const EditorPane = defineAsyncComponent(() => import('@/features/editor/EditorPane.vue'))
/** 看板同样按需加载：多数会话只写笔记 */
const BoardPane = defineAsyncComponent(() => import('@/features/board/BoardPane.vue'))
const CanvasPane = defineAsyncComponent(() => import('@/features/canvas/CanvasPane.vue'))

const workspace = useWorkspaceStore()
const editor = useEditorStore()
const theme = useThemeStore()
const ui = useUiStore()
const ai = useAiStore()
const search = useSearchStore()
const sync = useSyncStore()
const properties = usePropertiesStore()
const preferences = usePreferencesStore()
const collections = useCollectionsStore()
const linksStore = useLinksStore()
const attachments = useAttachmentsStore()
const canvasStore = useCanvasStore()
const boardStore = useBoardStore()
const security = useSecurityStore()
const i18n = useI18nStore()
const toast = useToastStore()
const exporter = useExportStore()
const extensions = useExtensionsStore()

extensions.initialize()

workspace.onBeforeOpen(async () => {
  await Promise.all([editor.flush(), boardStore.flush(), canvasStore.flush()])
})

// 切换工作区后，索引与属性定义都属于上一个 Vault，必须作废
function invalidateWorkspaceCaches(): void {
  search.invalidate()
  properties.invalidate()
  collections.invalidate()
  linksStore.invalidate()
  attachments.invalidate()
  boardStore.invalidate()
  canvasStore.invalidate()
}

function invalidateSyncedCaches(): void {
  search.invalidate()
  // 同步可能只改属性定义，活动路径不变：不能等表单的 activePath watcher 来重载。
  // 保留旧表单，加载完成后替换，否则会永久降级为 created / updated 等原始字段。
  void properties.ensureLoaded(true)
  linksStore.invalidate()
  attachments.invalidate()
  void collections.refresh()
}

workspace.onChanged(() => {
  invalidateWorkspaceCaches()
})

workspace.onOpened(async () => {
  if (!security.locked) await editor.reconcileTabs()
  if (editor.activeKind === 'board' && editor.activePath) await boardStore.open(editor.activePath)
  if (editor.activeKind === 'canvas' && editor.activePath) await canvasStore.open(editor.activePath)
  await collections.refresh()
  await sync.load()
  void sync.autoSync()
})

// 远端下载可能改写笔记、属性、附件和关系图，所有可重建缓存统一作废。
watch(() => sync.lastSyncedAt, (value, previous) => {
  // 同步 Store 已经重载活动文档；这里只作废可重建的派生缓存。
  // 若复用切目录逻辑，会把刚打开的看板/画板再次清空。
  if (value && value !== previous) invalidateSyncedCaches()
  if (value && value !== previous) void extensions.load()
})

// 数据层仍保留 error 供设置页展示；顶层统一用 Toast 告知，避免错误藏在已关闭的面板里。
watch(
  [
    () => workspace.error,
    () => editor.loadError,
    () => sync.error,
    () => ai.error,
    () => search.error,
    () => exporter.error,
    () => properties.error,
  ],
  (current, previous) => {
    current.forEach((message, index) => {
      if (message && message !== previous[index]) toast.error(message)
    })
  },
)

// 导出可能从设置、命令面板或文件树触发。结果统一浮到顶层，不能只留在
// 某个已经关闭的面板里，更不能让右键菜单里的失败看起来像没有响应。
watch(() => exporter.lastResult, (message, previous) => {
  if (message && message !== previous) toast.success(message)
})

// 改名跟随会在后台改写若干篇笔记，索引与链接图缓存的是旧文本，必须一并更新
workspace.onRewritten((paths) => {
  paths.forEach((path) => {
    void search.touch(path)
    void linksStore.touch(path)
  })
})

/** 打开今天的日记（11.3）。没有就新建，同一天永远是同一个文件 */
async function openDailyNote(): Promise<void> {
  try {
    await editor.openNote(await workspace.openDailyNote())
  } catch (cause) {
    workspace.error = cause instanceof Error ? cause.message : String(cause)
  }
}

// 打开笔记即记入「最近访问」；这是本机浏览行为，不写进 Vault
watch(
  () => editor.activePath,
  (path) => {
    if (path) collections.markVisited(path)
  },
)

const saveStatus = computed(() => {
  if (editor.saving) return i18n.t('save.saving')
  if (editor.dirty) return i18n.t('save.unsaved')
  if (editor.lastSavedAt) return i18n.t('save.saved', { time: formatRelativeTime(editor.lastSavedAt, i18n.locale) })
  return ''
})

/**
 * 窄屏（手机、分屏、小窗）。
 *
 * 断点取 768px：再窄的话侧边栏 256 + 大纲 208 会把正文挤到只剩一条缝，
 * 而正文才是这个应用的主体。窄屏下两侧面板改为**覆盖式浮层**——
 * 不占布局宽度，用完即走。
 */
const isNarrow = useMediaQuery('(max-width: 767px)')

// 专注模式下两侧面板一律让位，退出后恢复用户原本的偏好
const showSidebar = computed(() => !ui.zenMode && ui.sidebarVisible)
// 大纲在窄屏下不显示：它是辅助导航，而窄屏里连正文都不够宽
const showOutline = computed(
  () => !ui.zenMode && !isNarrow.value && ui.outlineVisible && editor.note !== null,
)

/** 窄屏下打开侧边栏时压一层遮罩，点它收起——触摸设备没有「移开鼠标」这一说 */
const sidebarIsOverlay = computed(() => isNarrow.value && showSidebar.value)

/** 侧边栏折叠时的临时浮出，属于瞬时交互，不进 store 也不持久化 */
const peekSidebar = ref(false)

// 收起侧边栏时顺手清掉浮出状态，避免下次折叠时残留为展开
watch(showSidebar, () => {
  peekSidebar.value = false
})

/**
 * 客户端事件订阅。取消函数收集起来统一注销——
 * HMR 下组件会反复挂载，漏注销会让一次事件触发多份处理。
 */
const unlisten: Array<() => void> = []

onUnmounted(() => {
  unlisten.forEach((off) => off())
})

onMounted(async () => {
  await workspace.restoreLast()

  // 主进程在隐藏窗口 / 退出前发 flush：自动保存是防抖的，这里补上最后一次落盘
  unlisten.push(
    await onDesktopEvent(DESKTOP_EVENT.flush, () => {
      void editor.flush()
    }),
  )
  // 速记窗口写入的笔记不在本窗口的内存快照里，收到广播后重扫磁盘
  unlisten.push(
    await onDesktopEvent(DESKTOP_EVENT.noteCreated, () => {
      void workspace.refresh()
    }),
  )

  // 空工作区给一篇欢迎笔记，避免用户面对完全空白的界面
  if (workspace.isOpen && workspace.tree.length === 0) {
    await installWelcomeAssets(workspace.storage!)
    const path = await workspace.createNote('', i18n.t('app.welcomeTitle'))
    await workspace.notes!.write(path, { content: WELCOME_NOTE })
    await workspace.refresh()
    await editor.openNote(path)
  }

})

// 离线期间照常编辑；网络恢复后才在后台追上远端。
useEventListener(window, 'online', () => {
  void sync.autoSync()
})

/**
 * 快捷键动作表：id 来自 `core/keyboard/bindings.ts`。
 *
 * 组合键写在 core 层、动作写在这里，两边靠 id 对齐——设置页因此能在不 import
 * 任何组件的前提下把快捷键列全，也不会出现「说明里写的和实际按出来的不一样」。
 * 返回 false 表示当前情境下不适用，让按键继续走默认行为。
 */
const SHORTCUT_ACTIONS: Record<string, () => boolean> = {
  'command-palette': () => (ui.toggleCommandPalette(), true),
  'toggle-sidebar': () => ((ui.sidebarVisible = !ui.sidebarVisible), true),
  'toggle-zen': () => (ui.toggleZen(), true),
  // 不 await：快捷键处理必须同步返回「我接下了」，否则 preventDefault 来不及
  'daily-note': () => (void openDailyNote(), true),
  'ai-assistant': () => ((ui.aiOpen = !ui.aiOpen), true),
  'exit-zen': () => {
    if (!ui.zenMode) return false
    ui.zenMode = false
    return true
  },
}

/**
 * 编辑器内也要生效，因此挂在 window 上并显式 preventDefault，
 * 否则 Ctrl+K 会被浏览器的地址栏搜索抢走。
 */
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  security.recordActivity()
  if (ui.shortcutCaptureActive) return

  for (const binding of SHORTCUT_BINDINGS) {
    if (!matchesShortcut(event, resolveShortcut(binding, preferences.shortcutOverrides))) continue

    if (SHORTCUT_ACTIONS[binding.id]?.()) event.preventDefault()
    return
  }
})

// 关窗/刷新前尽力落盘。beforeunload 中异步写入不保证完成，
// 因此真正的保障是短自动保存间隔，这里只是兜底。
useEventListener(window, 'beforeunload', () => {
  void editor.flush()
})

// 切到后台时立即落盘：移动端与桌面端最可靠的「即将失去执行机会」信号
useEventListener(document, 'visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    void editor.flush().then(() => sync.autoSync())
  }
})

useEventListener(window, 'pointerdown', () => security.recordActivity(), { passive: true })

const isMac = isMacPlatform()
function shortcutLabel(id: string): string {
  const binding = SHORTCUT_BINDINGS.find((candidate) => candidate.id === id)
  return binding ? formatShortcut(resolveShortcut(binding, preferences.shortcutOverrides), isMac) : ''
}
</script>

<template>
  <div class="app-chrome flex h-full flex-col bg-background text-foreground">
    <DesktopTitleBar />
    <a href="#light-main" class="sr-only fixed left-2 top-2 z-[120] rounded bg-background px-3 py-2 focus:not-sr-only">{{ i18n.t('app.skip') }}</a>
    <header v-if="!ui.zenMode" class="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      <Button variant="ghost" size="icon-sm" :title="`${i18n.t('app.sidebar')} (${shortcutLabel('toggle-sidebar')})`" @click="ui.sidebarVisible = !ui.sidebarVisible">
        <PanelLeft />
      </Button>

      <span class="text-sm font-semibold">Light</span>

      <div class="ml-auto flex items-center gap-1">
        <span v-if="!isNarrow" class="mr-1 text-xs text-muted-foreground" role="status" aria-live="polite">{{ saveStatus }}</span>

        <Button variant="ghost" size="icon-sm" :title="`${i18n.t('app.search')} (${shortcutLabel('command-palette')})`" @click="ui.toggleCommandPalette()">
          <Search />
        </Button>
        <!-- 只在开了 AI 时出现。没配置的用户不需要一个常驻的、点了只会说「去设置」的按钮 -->
        <Button
          v-if="ai.settings.enabled"
          variant="ghost"
          size="icon-sm"
          :title="`${i18n.t('app.ai')} (${shortcutLabel('ai-assistant')})`"
          @click="ui.aiOpen = true"
        >
          <Sparkles />
        </Button>
        <!-- 窄屏收掉次要入口：大纲那时不显示，专注模式也没什么可让位的 -->
        <Button
          v-if="editor.note && !isNarrow"
          variant="ghost"
          size="icon-sm"
          :title="i18n.t('app.outline')"
          @click="ui.outlineVisible = !ui.outlineVisible"
        >
          <ListTree />
        </Button>
        <Button
          v-if="editor.note && !isNarrow"
          variant="ghost"
          size="icon-sm"
          :title="i18n.t('app.history')"
          @click="ui.historyOpen = true"
        >
          <History />
        </Button>
        <Button v-if="!isNarrow" variant="ghost" size="icon-sm" :title="`${i18n.t('app.zen')} (${shortcutLabel('toggle-zen')})`" @click="ui.toggleZen()">
          <Focus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :title="theme.isDark ? i18n.t('app.light') : i18n.t('app.dark')"
          @click="theme.toggleDark()"
        >
          <Moon v-if="theme.isDark" />
          <Sun v-else />
        </Button>
      </div>
    </header>

    <div class="relative flex min-h-0 flex-1">
      <!-- 窄屏下侧边栏浮在正文之上，不占宽度 -->
      <aside
        v-if="showSidebar"
        class="shrink-0 border-r border-border bg-sidebar text-sidebar-foreground"
        :class="isNarrow ? 'absolute inset-y-0 left-0 z-30 w-64 shadow-xl' : 'w-64'"
      >
        <Sidebar />
      </aside>

      <div
        v-if="sidebarIsOverlay"
        class="absolute inset-0 z-20 bg-black/30"
        @click="ui.sidebarVisible = false"
      />

      <!-- 折叠后：左边缘留一条窄触发区，悬停即浮出侧边栏，移开自动收起。
           浮层不占布局空间，因此不会把正文推开（S5）。
           窄屏没有这条触发区——触摸设备没有 hover，只会变成误触 -->
      <template v-if="!showSidebar && !ui.zenMode && !isNarrow">
        <div
          class="absolute inset-y-0 left-0 z-20 w-2 cursor-e-resize"
          :title="i18n.t('app.peekSidebar')"
          @mouseenter="peekSidebar = true"
        />
        <Transition name="peek">
          <aside
            v-if="peekSidebar"
            class="absolute inset-y-0 left-0 z-30 w-64 border-r border-border bg-sidebar text-sidebar-foreground shadow-xl"
            @mouseleave="peekSidebar = false"
          >
            <Sidebar />
          </aside>
        </Transition>
      </template>

      <main id="light-main" class="flex min-w-0 flex-1 flex-col select-text" tabindex="-1">
        <TabBar v-if="!ui.zenMode" />
        <!-- key 绑定笔记路径：切换笔记时整体重建编辑器，
             既避免手动回填内容顶飞光标，也让撤销历史不会跨笔记串联 -->
        <!-- 按文档类型分流。key 绑路径：切换时整体重建，不必手动清理上一份状态 -->
        <BoardPane
          v-if="editor.activeKind === 'board' && editor.activePath"
          :key="editor.activePath"
          :path="editor.activePath"
        />
        <CanvasPane
          v-else-if="editor.activeKind === 'canvas' && editor.activePath"
          :key="editor.activePath"
          :path="editor.activePath"
        />
        <EditorPane v-else-if="editor.note" :key="`${editor.activePath ?? ''}:${editor.contentRevision}`" />
        <div v-else class="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <p v-if="editor.loadError" class="max-w-md px-6 text-center text-sm text-destructive">
            {{ editor.loadError }}
          </p>
          <p class="text-sm">{{ i18n.t('app.empty') }}</p>
          <p class="text-xs">{{ i18n.t('app.emptyHint', { shortcut: shortcutLabel('command-palette') }) }}</p>
        </div>
      </main>

      <aside v-if="showOutline" class="w-52 shrink-0 border-l border-border bg-sidebar text-sidebar-foreground">
        <OutlinePanel />
      </aside>
    </div>

    <footer
      v-if="editor.note && !ui.zenMode"
      class="flex h-7 shrink-0 items-center gap-4 border-t border-border px-3 text-xs text-muted-foreground"
    >
      <span class="truncate">{{ editor.note.title }}</span>
      <span class="ml-auto shrink-0">{{ i18n.t('app.words', { count: editor.wordCount }) }}</span>
      <span class="shrink-0">{{ i18n.t('app.minutes', { count: editor.readingMinutes }) }}</span>
    </footer>

    <CommandPalette />
    <AiPanel />
    <TrashPanel />
    <GraphPanel />
    <HistoryPanel />
    <AttachmentsPanel />
    <SettingsPanel />
    <PropertiesPanel />
    <PromptDialog />
    <ConfirmDialog />
    <AppLockOverlay />
    <ToastHost />
  </div>
</template>

<style scoped>
/* 侧边栏浮出：从左侧滑入，移开即滑出 */
.peek-enter-active,
.peek-leave-active {
  transition:
    transform 160ms ease,
    opacity 160ms ease;
}

.peek-enter-from,
.peek-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}
</style>

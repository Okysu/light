<script setup lang="ts">
import {
  ChevronRight,
  Cloud,
  Download,
  Info,
  Keyboard,
  Palette,
  PencilLine,
  Sparkles,
  Tags,
  Trash2,
  Wrench,
  Shield,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import { computed, reactive, ref } from 'vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import AboutSection from './sections/AboutSection.vue'
import AiSection from './sections/AiSection.vue'
import AppearanceSection from './sections/AppearanceSection.vue'
import EditorSection from './sections/EditorSection.vue'
import ExportSection from './sections/ExportSection.vue'
import PropertiesSection from './sections/PropertiesSection.vue'
import ShortcutsSection from './sections/ShortcutsSection.vue'
import SyncSection from './sections/SyncSection.vue'
import TrashSection from './sections/TrashSection.vue'
import WorkspaceSection from './sections/WorkspaceSection.vue'
import SecuritySection from './sections/SecuritySection.vue'
import { useI18nStore } from '@/stores/i18n'

const ui = useUiStore()
const workspace = useWorkspaceStore()
const i18n = useI18nStore()

interface SettingsPage {
  id: string
  label: string
  icon: Component
  component: Component
}

/**
 * 分组按**归属对象**划分，这是这个面板最重要的一条线：
 * 用户需要能一眼分辨「这项设置影响这台设备，还是影响整个 Vault」。
 *
 * 归属同时决定存储位置——「应用」类进 localStorage（见 stores/preferences.ts），
 * 「库」类进 `.light/`。混了会出两种坏结果：主题写进数据目录会让两台设备
 * 互相覆盖对方的偏好；同步凭据写进 localStorage 则换台设备就得重配。
 */
const GROUPS = computed<Array<{ id: string; title: string; hint: string; pages: SettingsPage[] }>>(() => [
  {
    id: 'app',
    title: i18n.t('settings.app'),
    hint: i18n.t('settings.appHint'),
    pages: [
      { id: 'appearance', label: i18n.t('settings.appearance'), icon: Palette, component: AppearanceSection },
      { id: 'editor', label: i18n.t('settings.editor'), icon: PencilLine, component: EditorSection },
      { id: 'shortcuts', label: i18n.t('settings.shortcuts'), icon: Keyboard, component: ShortcutsSection },
      { id: 'security', label: i18n.t('settings.security'), icon: Shield, component: SecuritySection },
      // AI 归「应用」而不是「库」：API Key 是这台设备的凭据，
      // 跟着数据目录走就意味着它会被同步到网盘、被打进导出的压缩包
      { id: 'ai', label: i18n.t('settings.ai'), icon: Sparkles, component: AiSection },
      { id: 'about', label: i18n.t('settings.about'), icon: Info, component: AboutSection },
    ],
  },
  {
    id: 'workspace',
    title: i18n.t('settings.data'),
    hint: i18n.t('settings.dataHint'),
    pages: [
      { id: 'workspace', label: i18n.t('settings.general'), icon: Wrench, component: WorkspaceSection },
      { id: 'properties', label: i18n.t('settings.properties'), icon: Tags, component: PropertiesSection },
      { id: 'export', label: i18n.t('settings.export'), icon: Download, component: ExportSection },
      { id: 'trash', label: i18n.t('settings.trash'), icon: Trash2, component: TrashSection },
      { id: 'sync', label: i18n.t('settings.sync'), icon: Cloud, component: SyncSection },
    ],
  },
])

const activeId = ref('appearance')

/** 分组的展开状态。默认全开——设置项本就不多，一上来全折叠反而多一次点击 */
const expanded = reactive<Record<string, boolean>>(
  Object.fromEntries(GROUPS.value.map((group) => [group.id, true])),
)

const activePage = computed(
  () => GROUPS.value.flatMap((group) => group.pages).find((page) => page.id === activeId.value) ?? null,
)

/** 数据目录还没就绪时这组设置无从落盘，禁用而不是隐藏——隐藏会让人以为功能不存在 */
function isDisabled(groupId: string): boolean {
  return groupId === 'workspace' && !workspace.isOpen
}
</script>

<template>
  <Dialog
    v-model:open="ui.settingsOpen"
    :title="i18n.t('settings.title')"
    :description="i18n.t('settings.description')"
    hide-header
    class="h-[85vh] max-h-[42rem] w-[54rem] max-w-[96vw] p-0"
  >
    <div class="flex h-full min-h-0">
      <!-- 左侧分组导航 -->
      <!-- 窄屏下导航收窄，但保留分组结构——功能不该因为屏幕小就消失 -->
      <nav class="w-36 shrink-0 border-r border-border bg-sidebar sm:w-52">
        <ScrollArea class="h-full" viewport-class="px-2 py-3 space-y-3">
          <Collapsible v-for="group in GROUPS" :key="group.id" v-model:open="expanded[group.id]">
            <CollapsibleTrigger
              class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
            >
              <ChevronRight
                class="size-4 shrink-0 text-muted-foreground transition-transform"
                :class="expanded[group.id] && 'rotate-90'"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold text-sidebar-foreground">{{ group.title }}</span>
                <span class="block whitespace-normal break-words text-xs leading-snug text-muted-foreground">{{ group.hint }}</span>
              </span>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div class="mt-1 space-y-0.5 pl-2">
                <button
                  v-for="page in group.pages"
                  :key="page.id"
                  class="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent disabled:pointer-events-none disabled:opacity-40"
                  :class="activeId === page.id && 'border-border bg-sidebar-accent font-medium'"
                  :disabled="isDisabled(group.id)"
                  @click="activeId = page.id"
                >
                  <component :is="page.icon" class="size-4 shrink-0 text-muted-foreground" />
                  <span class="truncate">{{ page.label }}</span>
                </button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </ScrollArea>
      </nav>

      <!-- 右侧内容区 -->
      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex h-12 shrink-0 items-center border-b border-border px-5">
          <h2 class="text-sm font-semibold">{{ activePage?.label }}</h2>
        </header>

        <ScrollArea class="min-h-0 flex-1" viewport-class="px-5 py-4">
          <!-- key 绑定页面 id：切页时重建，避免上一页的临时输入残留到下一页 -->
          <component :is="activePage.component" v-if="activePage" :key="activePage.id" />
        </ScrollArea>
      </div>
    </div>
  </Dialog>
</template>

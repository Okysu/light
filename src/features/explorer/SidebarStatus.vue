<script setup lang="ts">
import { useOnline } from '@vueuse/core'
import { Cloud, LoaderCircle, RefreshCw, Settings2, Sparkles } from 'lucide-vue-next'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/utils'
import { useAiStore } from '@/stores/ai'
import { useI18nStore } from '@/stores/i18n'
import { useSyncStore } from '@/stores/sync'
import { useToastStore } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import SidebarSection from './SidebarSection.vue'
import { aiStatusKey, canSyncFromSidebar, syncStatusKey } from './sidebar-status'

const ai = useAiStore()
const sync = useSyncStore()
const ui = useUiStore()
const i18n = useI18nStore()
const toast = useToastStore()
const online = useOnline()

const aiLabel = computed(() => i18n.t(aiStatusKey({
  enabled: ai.settings.enabled, ready: ai.ready, busy: ai.busy, error: ai.error,
})))
const syncState = computed(() => ({
  enabled: sync.config.enabled,
  ready: sync.ready,
  running: sync.running,
  testing: sync.testing,
  gcRunning: sync.gcRunning,
  online: online.value,
  error: sync.error,
  vaultStatus: sync.vaultStatus,
  lastSyncedAt: sync.lastSyncedAt,
}))
const syncLabel = computed(() => i18n.t(syncStatusKey(syncState.value)))
const canSync = computed(() => canSyncFromSidebar(syncState.value))
const progress = computed(() => sync.progress
  ? `${i18n.t(`sync.stage.${sync.progress.phase}`)} ${sync.progress.current}/${sync.progress.total}`
  : '')

async function runSync(): Promise<void> {
  if (!canSync.value) return
  try {
    const result = await sync.syncNow()
    if (result) toast.success(i18n.t('sync.complete', {
      uploaded: result.uploaded, downloaded: result.downloaded, conflicts: result.conflicts.length,
    }))
  } catch (cause) {
    // 顶层通常会通过 sync.error 弹出 Toast；也覆盖进入 Store 前的工作区错误。
    toast.error(cause instanceof Error ? cause.message : String(cause))
  }
}
</script>

<template>
  <SidebarSection id="app-status" :title="i18n.t('sidebar.appStatus')" :default-open="true">
    <div class="space-y-2 px-3 pb-3">
      <Button variant="outline" size="sm" class="w-full justify-start" @click="ui.settingsOpen = true">
        <Settings2 class="size-3.5" />
        {{ i18n.t('settings.title') }}
      </Button>

      <div class="space-y-1.5 text-xs" role="status" aria-live="polite" aria-atomic="true">
        <div class="flex min-w-0 items-start gap-2" :title="ai.error ?? undefined">
          <Sparkles class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span>{{ i18n.t('settings.ai') }}</span>
          <span class="ml-auto min-w-0 break-words text-right text-muted-foreground" :class="ai.error && 'text-destructive'">
            {{ aiLabel }}
          </span>
        </div>
        <div class="flex min-w-0 items-start gap-2" :title="sync.error ?? undefined">
          <Cloud class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span>{{ i18n.t('settings.sync') }}</span>
          <span class="ml-auto min-w-0 break-words text-right text-muted-foreground" :class="sync.error && 'text-destructive'">
            {{ syncLabel }}
          </span>
        </div>
        <p v-if="progress" class="break-words text-muted-foreground">{{ progress }}</p>
        <p v-else-if="sync.lastSyncedAt" class="break-words text-muted-foreground">
          {{ i18n.t('sync.last', { time: formatRelativeTime(sync.lastSyncedAt, i18n.locale) }) }}
        </p>
      </div>

      <Button variant="ghost" size="sm" class="w-full justify-start" :disabled="!canSync" @click="runSync">
        <LoaderCircle v-if="sync.running" class="size-3.5 animate-spin" />
        <RefreshCw v-else class="size-3.5" />
        {{ sync.running ? i18n.t('sync.syncing') : i18n.t('sync.now') }}
      </Button>
    </div>
  </SidebarSection>
</template>

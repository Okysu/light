<script setup lang="ts">
import { Cloud, ShieldCheck } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { ConflictPolicy, SyncConfig } from '@/core/sync/types'
import { formatRelativeTime } from '@/lib/utils'
import { useSyncStore } from '@/stores/sync'
import { useI18nStore } from '@/stores/i18n'
import { useToastStore } from '@/stores/toast'
import SettingRow from '../SettingRow.vue'

const sync = useSyncStore()
const i18n = useI18nStore()
const toast = useToastStore()
const accessKey = ref('')
const secretKey = ref('')
const vaultPassword = ref('')
const recoveryKey = ref('')
const message = ref<string | null>(null)
watch(message, (value) => { if (value) toast.info(value) })

const POLICIES = computed<Array<{ value: ConflictPolicy; label: string; description: string }>>(() => [
  { value: 'merge-text', label: i18n.t('sync.mergeText'), description: i18n.t('sync.mergeTextHint') },
  { value: 'keep-both', label: i18n.t('sync.keepBoth'), description: i18n.t('sync.keepBothHint') },
  { value: 'manual', label: i18n.t('sync.manual'), description: i18n.t('sync.manualHint') },
  { value: 'prefer-local', label: i18n.t('sync.localFirst'), description: i18n.t('sync.localFirstHint') },
  { value: 'prefer-remote', label: i18n.t('sync.remoteFirst'), description: i18n.t('sync.remoteFirstHint') },
])

const activePolicy = computed(() => POLICIES.value.find((item) => item.value === sync.config.conflictPolicy)!)
const progressText = computed(() => {
  const value = sync.progress
  if (!value) return ''
  const labels = {
    scan: i18n.t('sync.stage.scan'),
    download: i18n.t('sync.stage.download'),
    upload: i18n.t('sync.stage.upload'),
    commit: i18n.t('sync.stage.commit'),
    cleanup: i18n.t('sync.stage.cleanup'),
  }
  return `${labels[value.phase]} ${value.current}/${value.total}${value.path ? ` · ${value.path}` : ''}`
})

onMounted(() => sync.load())

function set<K extends keyof SyncConfig>(key: K, value: SyncConfig[K]): void {
  void sync.save({ ...sync.config, [key]: value })
}

function setAttachment(patch: Partial<SyncConfig['attachmentPolicy']>): void {
  set('attachmentPolicy', { ...sync.config.attachmentPolicy, ...patch })
}

async function saveCredentials(): Promise<void> {
  message.value = null
  try {
    await sync.saveCredentials(accessKey.value, secretKey.value)
    accessKey.value = ''
    secretKey.value = ''
    message.value = i18n.t('sync.credentialsSaved')
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function testConnection(): Promise<void> {
  message.value = null
  try {
    await sync.testConnection()
    message.value = i18n.t('sync.connectionOk')
  } catch {
    // 具体错误由 store 统一提供
  }
}

async function runSync(): Promise<void> {
  message.value = null
  try {
    const result = await sync.syncNow()
    if (!result) return
    message.value = i18n.t('sync.complete', { uploaded: result.uploaded, downloaded: result.downloaded, merged: result.merged.length, conflicts: result.conflicts.length })
  } catch {
    // 具体错误由 store 统一提供
  }
}

async function createVault(resetExisting = false): Promise<void> {
  message.value = null
  if (resetExisting && !window.confirm(i18n.t('sync.resetConfirm'))) return
  try {
    await sync.createVault(vaultPassword.value, resetExisting)
    vaultPassword.value = ''
    message.value = i18n.t('sync.vaultCreated')
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function unlockWithPassword(): Promise<void> {
  message.value = null
  try {
    await sync.unlockVaultWithPassword(vaultPassword.value)
    vaultPassword.value = ''
    message.value = i18n.t('sync.vaultUnlocked')
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function unlockWithRecovery(): Promise<void> {
  message.value = null
  try {
    await sync.unlockVaultWithRecovery(recoveryKey.value.trim())
    recoveryKey.value = ''
    message.value = i18n.t('sync.recoveryUnlocked')
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function copyRecovery(): Promise<void> {
  if (!sync.recoveryExport) return
  await navigator.clipboard.writeText(sync.recoveryExport)
  message.value = i18n.t('sync.recoveryCopied')
}

async function previewGc(): Promise<void> {
  message.value = null
  try {
    const plan = await sync.previewGarbageCollection()
    message.value = plan.candidateCount
      ? i18n.t('sync.gcCandidates', { count: plan.candidateCount })
      : i18n.t('sync.gcNone')
  } catch {
    // 具体错误由 store 统一提供
  }
}

async function executeGc(): Promise<void> {
  const plan = sync.gcPlan
  if (!plan || !window.confirm(i18n.t('sync.gcConfirm', { count: plan.candidateCount }))) return
  message.value = null
  try {
    const result = await sync.executeGarbageCollection()
    message.value = i18n.t('sync.gcComplete', { count: result.deletedCount })
  } catch {
    // 具体错误由 store 统一提供
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
      <p class="mb-1 flex items-center gap-1.5 font-medium text-foreground">
        <ShieldCheck class="size-3.5" />
        {{ i18n.t('sync.flow') }}
      </p>
      <p>
        {{ i18n.t('sync.flow1') }}
      </p>
      <p class="mt-1.5">
        {{ i18n.t('sync.flow2') }}
      </p>
    </div>

    <SettingRow :label="i18n.t('sync.enable')" :description="i18n.t('sync.enableHint')">
      <Switch :model-value="sync.config.enabled" @update:model-value="set('enabled', $event)" />
    </SettingRow>

    <SettingRow :label="i18n.t('sync.vault')" :description="i18n.t('sync.vaultHint')">
      <div class="flex w-full flex-col gap-2">
        <p class="text-xs text-muted-foreground">
          {{ i18n.t('sync.status', { status: sync.vaultStatus === 'unlocked' ? i18n.t('sync.unlocked') : sync.vaultStatus === 'locked' ? i18n.t('sync.locked') : sync.vaultStatus === 'absent' ? i18n.t('sync.absent') : i18n.t('sync.unknown') }) }}
        </p>
        <Input
          v-if="sync.vaultStatus === 'locked' || sync.vaultStatus === 'absent'"
          v-model="vaultPassword"
          type="password"
          autocomplete="new-password"
          :placeholder="i18n.t('sync.vaultPassword')"
          @keydown.enter="sync.vaultStatus === 'absent' ? createVault(false) : unlockWithPassword()"
        />
        <Button v-if="sync.vaultStatus === 'unknown'" size="sm" variant="outline" class="self-start" @click="testConnection">
          {{ i18n.t('sync.detect') }}
        </Button>
        <div v-if="sync.vaultStatus === 'locked' || sync.vaultStatus === 'absent'" class="flex flex-wrap gap-2">
          <Button v-if="sync.vaultStatus === 'absent'" size="sm" @click="createVault(false)">{{ i18n.t('sync.create') }}</Button>
          <Button v-else size="sm" @click="unlockWithPassword">{{ i18n.t('sync.unlockPassword') }}</Button>
          <Button v-if="sync.vaultStatus === 'locked'" size="sm" variant="destructive" @click="createVault(true)">{{ i18n.t('sync.reset') }}</Button>
        </div>
        <div v-if="sync.vaultStatus === 'locked'" class="flex gap-2">
          <Input v-model="recoveryKey" class="flex-1 font-mono" placeholder="light-recovery:v1:…" />
          <Button size="sm" variant="outline" @click="unlockWithRecovery">{{ i18n.t('sync.unlockRecovery') }}</Button>
        </div>
        <Button v-if="sync.vaultStatus === 'unlocked'" size="sm" variant="outline" class="self-end" @click="sync.lockVault()">
          {{ i18n.t('sync.lockLocal') }}
        </Button>
        <div v-if="sync.recoveryExport" class="rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
          <p class="mb-1 text-xs font-medium">{{ i18n.t('sync.recoveryOnce') }}</p>
          <p class="break-all font-mono text-xs">{{ sync.recoveryExport }}</p>
          <Button size="sm" variant="outline" class="mt-2" @click="copyRecovery">{{ i18n.t('sync.copyRecovery') }}</Button>
        </div>
      </div>
    </SettingRow>

    <SettingRow :label="i18n.t('sync.remote')" :description="i18n.t('sync.remoteHint')">
      <div class="flex w-full flex-col gap-2">
        <Input
          :model-value="sync.config.endpoint"
          class="font-mono"
          placeholder="https://s3.example.com"
          @update:model-value="set('endpoint', String($event))"
        />
        <div class="grid grid-cols-2 gap-2">
          <Input
            :model-value="sync.config.region"
            class="font-mono"
            placeholder="auto / us-east-1"
            @update:model-value="set('region', String($event))"
          />
          <Input
            :model-value="sync.config.bucket"
            class="font-mono"
            placeholder="Bucket"
            @update:model-value="set('bucket', String($event))"
          />
        </div>
        <Input
          :model-value="sync.config.prefix"
          class="font-mono"
          :placeholder="i18n.t('sync.prefixPlaceholder')"
          @update:model-value="set('prefix', String($event))"
        />
      </div>
    </SettingRow>

    <SettingRow :label="i18n.t('sync.pathStyle')" :description="i18n.t('sync.pathStyleHint')">
      <Switch :model-value="sync.config.forcePathStyle" @update:model-value="set('forcePathStyle', $event)" />
    </SettingRow>

    <SettingRow :label="i18n.t('sync.credentials')" :description="i18n.t('sync.credentialsHint')">
      <div class="flex w-full flex-col gap-2">
        <Input v-model="accessKey" type="password" class="font-mono" autocomplete="off" placeholder="AccessKey" />
        <div class="flex gap-2">
          <Input
            v-model="secretKey"
            type="password"
            class="flex-1 font-mono"
            autocomplete="off"
            :placeholder="sync.hasCredentials ? i18n.t('sync.secretSaved') : 'SecretKey'"
            @keydown.enter="saveCredentials"
          />
          <Button size="sm" @click="saveCredentials">{{ i18n.t('sync.save') }}</Button>
        </div>
        <Button v-if="sync.hasCredentials" size="sm" variant="ghost" class="self-end" @click="sync.forgetCredentials()">
          {{ i18n.t('sync.clearCredentials') }}
        </Button>
      </div>
    </SettingRow>

    <SettingRow :label="i18n.t('sync.conflict')" :description="activePolicy.description">
      <div class="flex w-full flex-wrap gap-1.5">
        <Button
          v-for="policy in POLICIES"
          :key="policy.value"
          size="sm"
          :variant="sync.config.conflictPolicy === policy.value ? 'default' : 'outline'"
          @click="set('conflictPolicy', policy.value)"
        >
          {{ policy.label }}
        </Button>
      </div>
    </SettingRow>

    <SettingRow :label="i18n.t('sync.auto')" :description="i18n.t('sync.autoHint')">
      <Switch :model-value="sync.config.autoSync" @update:model-value="set('autoSync', $event)" />
    </SettingRow>

    <SettingRow :label="i18n.t('sync.attachments')" :description="i18n.t('sync.attachmentsHint')">
      <Switch
        :model-value="sync.config.attachmentPolicy.enabled"
        @update:model-value="setAttachment({ enabled: $event })"
      />
    </SettingRow>

    <SettingRow :label="i18n.t('sync.attachmentRules')" :description="i18n.t('sync.attachmentRulesHint')">
      <div class="grid w-full grid-cols-2 gap-2">
        <Input
          type="number"
          min="0"
          :model-value="String(sync.config.attachmentPolicy.maxSizeMb)"
          :placeholder="i18n.t('sync.maxMb')"
          @update:model-value="setAttachment({ maxSizeMb: Math.max(0, Number($event) || 0) })"
        />
        <Input
          :model-value="sync.config.attachmentPolicy.excludedExtensions.join(', ')"
          :placeholder="i18n.t('sync.exclude')"
          @update:model-value="setAttachment({ excludedExtensions: String($event).split(',').map((value) => value.trim()).filter(Boolean) })"
        />
      </div>
    </SettingRow>

    <SettingRow :label="i18n.t('sync.gc')" :description="i18n.t('sync.gcHint')">
      <div class="flex w-full flex-col gap-2">
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" :disabled="!sync.ready || sync.running || sync.gcRunning" @click="previewGc">
            {{ sync.gcRunning ? i18n.t('sync.scanning') : i18n.t('sync.scanGc') }}
          </Button>
          <Button
            v-if="sync.gcPlan && sync.gcPlan.candidateCount > 0"
            size="sm"
            variant="destructive"
            :disabled="sync.gcRunning"
            @click="executeGc"
          >
            {{ i18n.t('sync.confirmGc', { count: sync.gcPlan.candidateCount }) }}
          </Button>
        </div>
        <p v-if="sync.gcPlan" class="text-xs text-muted-foreground">
          {{ i18n.t('sync.gcSummary', { candidate: sync.gcPlan.candidateCount, grace: sync.gcPlan.skippedWithinGrace, referenced: sync.gcPlan.skippedReferenced, unknown: sync.gcPlan.skippedUnknownAge }) }}
        </p>
      </div>
    </SettingRow>

    <div class="flex flex-wrap items-center gap-2 border-t border-border pt-4">
      <Button variant="outline" :disabled="sync.testing || sync.running" @click="testConnection">
        {{ sync.testing ? i18n.t('sync.testing') : i18n.t('sync.test') }}
      </Button>
      <Button :disabled="sync.running || sync.testing || !sync.ready" @click="runSync">
        <Cloud class="size-4" />
        {{ sync.running ? i18n.t('sync.syncing') : i18n.t('sync.now') }}
      </Button>
      <Button v-if="sync.running" variant="ghost" @click="sync.cancelSync()">{{ i18n.t('common.cancel') }}</Button>
      <span v-if="progressText" class="min-w-0 truncate text-xs text-muted-foreground">{{ progressText }}</span>
    </div>

    <p v-if="sync.error" class="text-xs text-destructive">{{ sync.error }}</p>
    <p v-else-if="message" class="text-xs text-muted-foreground">{{ message }}</p>
    <p v-else-if="sync.lastSyncedAt" class="text-xs text-muted-foreground">
      {{ i18n.t('sync.last', { time: formatRelativeTime(sync.lastSyncedAt, i18n.locale) }) }}
    </p>
    <p class="text-xs leading-relaxed text-muted-foreground">
      {{ i18n.t('sync.cors') }}
    </p>
  </div>
</template>

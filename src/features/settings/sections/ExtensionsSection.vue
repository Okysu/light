<script setup lang="ts">
import { Code2, FilePlus2, Play, RefreshCw, ShieldCheck, Trash2 } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/composables/use-confirm'
import { parseExtensionManifest } from '@/core/extensions/manifest'
import type { ExtensionRuntimeState, ExtensionSettingDefinition, ExtensionSettingValue } from '@/core/extensions/types'
import { permissionLabels, useExtensionsStore } from '@/stores/extensions'
import { useI18nStore } from '@/stores/i18n'
import { useToastStore } from '@/stores/toast'
import SettingRow from '../SettingRow.vue'

const extensions = useExtensionsStore()
const i18n = useI18nStore()
const toast = useToastStore()
const { confirm } = useConfirm()
const selectedId = ref<string | null>(null)
const manifestText = ref('')
const sourceText = ref('')
const editingNew = ref(false)
const saving = ref(false)

const selected = computed(() => extensions.items.find((item) => item.extension.manifest.id === selectedId.value) ?? null)

onMounted(() => {
  if (!selectedId.value && extensions.items[0]) selectExtension(extensions.items[0])
})

watch(() => extensions.items.map((item) => item.extension.manifest.id).join('|'), () => {
  if (selectedId.value && extensions.items.some((item) => item.extension.manifest.id === selectedId.value)) return
  const first = extensions.items[0]
  if (first) selectExtension(first)
  else newScript()
})

function selectExtension(item: ExtensionRuntimeState): void {
  selectedId.value = item.extension.manifest.id
  manifestText.value = JSON.stringify(item.extension.manifest, null, 2)
  sourceText.value = item.extension.source
  editingNew.value = false
}

function newScript(): void {
  selectedId.value = null
  editingNew.value = true
  manifestText.value = JSON.stringify({
    version: 1,
    id: 'my-light-script',
    name: i18n.t('extensions.exampleName'),
    description: i18n.t('extensions.exampleDescription'),
    entry: 'main.js',
    permissions: [],
    contributes: {
      commands: [{ id: 'hello', title: i18n.t('extensions.exampleCommand') }],
      slash: [{ command: 'hello', title: i18n.t('extensions.exampleCommand'), group: i18n.t('extensions.group'), keywords: ['hello', 'light'] }],
    },
  }, null, 2)
  sourceText.value = `light.commands.handle('hello', async () => {
  await light.ui.showToast({ type: 'success', message: 'Hello from Light!' })
})`
}

async function save(): Promise<void> {
  saving.value = true
  try {
    const manifest = parseExtensionManifest(JSON.parse(manifestText.value) as unknown)
    await extensions.install(manifest, sourceText.value)
    const installed = extensions.items.find((item) => item.extension.manifest.id === manifest.id)
    if (installed) selectExtension(installed)
    toast.success(i18n.t('extensions.saved'))
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause))
  } finally {
    saving.value = false
  }
}

async function toggle(item: ExtensionRuntimeState, enabled: boolean): Promise<void> {
  if (enabled && item.status === 'permission-required') return
  await extensions.setEnabled(item.extension.manifest.id, enabled)
}

async function removeSelected(): Promise<void> {
  const item = selected.value
  if (!item) return
  const accepted = await confirm({
    title: i18n.t('extensions.deleteTitle'),
    description: i18n.t('extensions.deleteDescription', { name: item.extension.manifest.name }),
    confirmLabel: i18n.t('common.delete'),
    cancelLabel: i18n.t('common.cancel'),
    danger: true,
  })
  if (!accepted) return
  await extensions.uninstall(item.extension.manifest.id)
  toast.success(i18n.t('extensions.deleted'))
}

async function changeSetting(key: string, definition: ExtensionSettingDefinition, value: unknown): Promise<void> {
  if (!selected.value) return
  let next: ExtensionSettingValue = value as ExtensionSettingValue
  if (definition.type === 'number') next = Number(value)
  await extensions.updateSetting(selected.value.extension.manifest.id, key, next)
}

function statusLabel(status: ExtensionRuntimeState['status']): string {
  return i18n.t(`extensions.status.${status}` as Parameters<typeof i18n.t>[0])
}

function permissionLabel(permission: ExtensionRuntimeState['extension']['manifest']['permissions'][number]): string {
  const label = permissionLabels(permission)
  return i18n.locale === 'en-US' ? label.en : label.zh
}
</script>

<template>
  <div class="space-y-6">
    <SettingRow :label="i18n.t('extensions.title')" :description="i18n.t('extensions.description')">
      <div class="flex flex-wrap gap-2">
        <Button size="sm" @click="newScript"><FilePlus2 />{{ i18n.t('extensions.new') }}</Button>
        <Button size="sm" variant="outline" :disabled="extensions.loading" @click="extensions.load">
          <RefreshCw :class="extensions.loading && 'animate-spin'" />{{ i18n.t('common.refresh') }}
        </Button>
      </div>
    </SettingRow>

    <div v-if="extensions.error" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
      {{ extensions.error }}
    </div>

    <div v-if="extensions.items.length" class="grid gap-2 sm:grid-cols-2">
      <button
        v-for="item in extensions.items"
        :key="item.extension.manifest.id"
        type="button"
        class="rounded-md border p-3 text-left transition-colors hover:bg-accent"
        :class="selectedId === item.extension.manifest.id && 'border-primary bg-accent'"
        @click="selectExtension(item)"
      >
        <span class="flex items-center gap-2">
          <Code2 class="size-4 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ item.extension.manifest.name }}</span>
          <span class="text-[10px] text-muted-foreground">{{ statusLabel(item.status) }}</span>
        </span>
        <span class="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{{ item.extension.manifest.id }}</span>
      </button>
    </div>

    <template v-if="selected || editingNew">
      <details class="rounded-md border p-3 text-xs">
        <summary class="cursor-pointer font-medium">{{ i18n.t('extensions.apiReference') }}</summary>
        <p class="mt-2 leading-relaxed text-muted-foreground">{{ i18n.t('extensions.apiReferenceHint') }}</p>
        <pre class="mt-2 overflow-x-auto rounded bg-muted p-2 font-mono leading-relaxed">light.app.getContext()
light.settings.get(key) / set(key, value)
light.storage.get(key) / set(key, value)
light.commands.handle(id, handler)
light.events.on(name, handler)
light.ui.showToast({ type, message })
light.workspace.list(path) / readText(path) / writeText(path, text)
light.workspace.search(query) / trash(path)
light.document.getActive() / getText() / getSelection()
light.document.replaceSelection(markdown) / insertAfterSelection(markdown)
light.ai.isAvailable() / complete({ instruction, input })</pre>
      </details>

      <SettingRow :label="i18n.t('extensions.manifest')" :description="i18n.t('extensions.manifestHint')">
        <Textarea v-model="manifestText" class="min-h-56 resize-y font-mono text-xs" spellcheck="false" />
      </SettingRow>

      <SettingRow :label="i18n.t('extensions.source')" :description="i18n.t('extensions.sourceHint')">
        <Textarea v-model="sourceText" class="min-h-64 resize-y font-mono text-xs" spellcheck="false" />
        <div class="mt-2 flex flex-wrap gap-2">
          <Button size="sm" :disabled="saving" @click="save">{{ saving ? i18n.t('extensions.saving') : i18n.t('common.save') }}</Button>
          <Button v-if="selected" size="sm" variant="destructive" @click="removeSelected"><Trash2 />{{ i18n.t('common.delete') }}</Button>
        </div>
      </SettingRow>
    </template>

    <template v-if="selected">
      <SettingRow :label="i18n.t('extensions.runtime')" :description="i18n.t('extensions.runtimeHint')">
        <div class="flex items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <p class="text-sm font-medium">{{ statusLabel(selected.status) }}</p>
            <p v-if="selected.device.lastError" class="mt-1 break-all text-xs text-destructive">{{ selected.device.lastError }}</p>
          </div>
          <Switch :model-value="selected.device.enabled" @update:model-value="toggle(selected, Boolean($event))" />
        </div>

        <div v-if="selected.status === 'permission-required'" class="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <p class="text-sm font-medium">{{ i18n.t('extensions.permissionRequired') }}</p>
          <ul class="my-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li v-for="permission in selected.extension.manifest.permissions" :key="permission">{{ permissionLabel(permission) }}</li>
            <li v-if="selected.extension.manifest.permissions.length === 0">{{ i18n.t('extensions.noPermissions') }}</li>
          </ul>
          <Button size="sm" @click="extensions.approveAndEnable(selected.extension.manifest.id)"><ShieldCheck />{{ i18n.t('extensions.approve') }}</Button>
        </div>

        <Button v-if="selected.device.granted.length" class="mt-2" size="sm" variant="outline" @click="extensions.revokePermissions(selected.extension.manifest.id)">
          {{ i18n.t('extensions.revoke') }}
        </Button>
      </SettingRow>

      <SettingRow
        v-if="Object.keys(selected.extension.manifest.settings ?? {}).length"
        :label="i18n.t('extensions.configuration')"
        :description="i18n.t('extensions.configurationHint')"
      >
        <div class="space-y-4 rounded-md border p-3">
          <div v-for="(definition, key) in selected.extension.manifest.settings" :key="key" class="space-y-1.5">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <Label :for="`extension-setting-${key}`">{{ definition.label }}</Label>
                <p v-if="definition.description" class="text-xs text-muted-foreground">{{ definition.description }}</p>
              </div>
              <Switch
                v-if="definition.type === 'boolean'"
                :id="`extension-setting-${key}`"
                :model-value="Boolean(extensions.settingValue(selected.extension.manifest.id, key))"
                @update:model-value="changeSetting(key, definition, Boolean($event))"
              />
            </div>
            <Textarea
              v-if="definition.type === 'textarea'"
              :id="`extension-setting-${key}`"
              :model-value="String(extensions.settingValue(selected.extension.manifest.id, key) ?? '')"
              @change="changeSetting(key, definition, ($event.target as HTMLTextAreaElement).value)"
            />
            <Input
              v-else-if="['text', 'number', 'secret'].includes(definition.type)"
              :id="`extension-setting-${key}`"
              :type="definition.type === 'secret' ? 'password' : definition.type"
              :model-value="String(extensions.settingValue(selected.extension.manifest.id, key) ?? '')"
              @change="changeSetting(key, definition, ($event.target as HTMLInputElement).value)"
            />
            <select
              v-else-if="definition.type === 'select'"
              :id="`extension-setting-${key}`"
              class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              :value="String(extensions.settingValue(selected.extension.manifest.id, key) ?? '')"
              @change="changeSetting(key, definition, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="option in definition.options" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>
        </div>
      </SettingRow>

      <SettingRow :label="i18n.t('extensions.logs')" :description="i18n.t('extensions.logsHint')">
        <div class="max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px]">
          <p v-if="selected.logs.length === 0" class="text-muted-foreground">{{ i18n.t('extensions.noLogs') }}</p>
          <p v-for="log in selected.logs" :key="`${log.at}-${log.message}`" :class="log.level === 'error' && 'text-destructive'">
            {{ new Date(log.at).toLocaleTimeString(i18n.locale) }} · {{ log.message }}
          </p>
        </div>
      </SettingRow>
    </template>

    <div class="rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
      <p class="flex items-center gap-1.5 font-medium text-foreground"><Play class="size-3.5" />{{ i18n.t('extensions.securityTitle') }}</p>
      <p class="mt-1">{{ i18n.t('extensions.securityHint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { builtinDescription, builtinName, builtinText } from '@/core/extensions/builtins'
import type {
  ExtensionRuntimeState,
  ExtensionSettingDefinition,
  ExtensionSettingValue,
  ExtensionSettingsActionContribution,
  ExtensionSettingsSectionContribution,
} from '@/core/extensions/types'
import { useExtensionsStore } from '@/stores/extensions'
import { useI18nStore } from '@/stores/i18n'

const props = defineProps<{ extensionId: string }>()
const extensions = useExtensionsStore()
const i18n = useI18nStore()
const runningAction = ref<string | null>(null)

const item = computed(() => extensions.items.find((candidate) => candidate.extension.manifest.id === props.extensionId) ?? null)
const sections = computed(() => item.value?.extension.manifest.contributes?.settings ?? [])

async function changeSetting(key: string, definition: ExtensionSettingDefinition, value: unknown): Promise<void> {
  const current = item.value
  if (!current) return
  let next: ExtensionSettingValue = value as ExtensionSettingValue
  if (definition.type === 'number') next = Number(value)
  await extensions.updateSetting(current.extension.manifest.id, key, next)
}

async function runAction(action: ExtensionSettingsActionContribution): Promise<void> {
  const current = item.value
  if (!current || current.status !== 'active') return
  runningAction.value = action.command
  try {
    await extensions.invoke(current.extension.manifest.id, action.command)
  } catch {
    // Store 已经统一记录日志并显示错误 Toast。
  } finally {
    runningAction.value = null
  }
}

function settingLabel(key: string, definition: ExtensionSettingDefinition): string {
  return builtinText(props.extensionId, i18n.locale, `setting.${key}`, definition.label)
}

function settingDescription(key: string, definition: ExtensionSettingDefinition): string | undefined {
  if (!item.value?.extension.builtin) return definition.description
  return builtinText(props.extensionId, i18n.locale, `setting.${key}.description`, '') || undefined
}

function optionLabel(key: string, value: string, fallback: string): string {
  return builtinText(props.extensionId, i18n.locale, `option.${key}.${value}`, fallback)
}

function sectionTitle(section: ExtensionSettingsSectionContribution): string {
  return builtinText(props.extensionId, i18n.locale, `section.${section.id}`, section.title)
}

function sectionDescription(section: ExtensionSettingsSectionContribution): string | undefined {
  return builtinText(props.extensionId, i18n.locale, `section.${section.id}.description`, section.description ?? '') || undefined
}

function actionTitle(action: ExtensionSettingsActionContribution): string {
  return builtinText(props.extensionId, i18n.locale, `action.${action.command}`, action.title)
}

function fieldVisible(definition: ExtensionSettingDefinition): boolean {
  const current = item.value
  if (!current || !definition.visibleWhen) return true
  return extensions.settingValue(current.extension.manifest.id, definition.visibleWhen.key) === definition.visibleWhen.equals
}

function statusLabel(status: ExtensionRuntimeState['status']): string {
  return i18n.t(`extensions.status.${status}` as Parameters<typeof i18n.t>[0])
}
</script>

<template>
  <div v-if="item" class="space-y-5">
    <div class="rounded-md border bg-muted/20 p-4">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-base font-semibold">{{ builtinName(item.extension, i18n.locale) }}</h3>
          <p v-if="builtinDescription(item.extension, i18n.locale)" class="mt-1 text-sm leading-relaxed text-muted-foreground">
            {{ builtinDescription(item.extension, i18n.locale) }}
          </p>
        </div>
        <span class="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{{ statusLabel(item.status) }}</span>
      </div>
    </div>

    <div v-if="!item.device.enabled" class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
      {{ i18n.t('extensions.enableForGui') }}
    </div>

    <section v-for="section in sections" v-else :key="section.id" class="space-y-4 rounded-md border p-4">
      <div>
        <h3 class="text-sm font-semibold">{{ sectionTitle(section) }}</h3>
        <p v-if="sectionDescription(section)" class="mt-1 text-xs leading-relaxed text-muted-foreground">{{ sectionDescription(section) }}</p>
      </div>

      <template v-for="key in section.fields" :key="key">
        <div v-if="item.extension.manifest.settings?.[key] && fieldVisible(item.extension.manifest.settings[key])" class="space-y-1.5">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <Label :for="`extension-setting-${section.id}-${key}`">{{ settingLabel(key, item.extension.manifest.settings[key]) }}</Label>
              <p v-if="settingDescription(key, item.extension.manifest.settings[key])" class="text-xs text-muted-foreground">
                {{ settingDescription(key, item.extension.manifest.settings[key]) }}
              </p>
            </div>
            <Switch
              v-if="item.extension.manifest.settings[key].type === 'boolean'"
              :id="`extension-setting-${section.id}-${key}`"
              :model-value="Boolean(extensions.settingValue(item.extension.manifest.id, key))"
              @update:model-value="changeSetting(key, item.extension.manifest.settings![key]!, Boolean($event))"
            />
          </div>
          <Textarea
            v-if="item.extension.manifest.settings[key].type === 'textarea'"
            :id="`extension-setting-${section.id}-${key}`"
            :model-value="String(extensions.settingValue(item.extension.manifest.id, key) ?? '')"
            :placeholder="item.extension.manifest.settings[key].placeholder"
            @change="changeSetting(key, item.extension.manifest.settings![key]!, ($event.target as HTMLTextAreaElement).value)"
          />
          <Input
            v-else-if="['text', 'number', 'secret'].includes(item.extension.manifest.settings[key].type)"
            :id="`extension-setting-${section.id}-${key}`"
            :type="item.extension.manifest.settings[key].type === 'secret' ? 'password' : item.extension.manifest.settings[key].type"
            :model-value="String(extensions.settingValue(item.extension.manifest.id, key) ?? '')"
            :placeholder="item.extension.manifest.settings[key].placeholder"
            :min="item.extension.manifest.settings[key].min"
            :max="item.extension.manifest.settings[key].max"
            @change="changeSetting(key, item.extension.manifest.settings![key]!, ($event.target as HTMLInputElement).value)"
          />
          <select
            v-else-if="item.extension.manifest.settings[key].type === 'select'"
            :id="`extension-setting-${section.id}-${key}`"
            class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            :value="String(extensions.settingValue(item.extension.manifest.id, key) ?? '')"
            @change="changeSetting(key, item.extension.manifest.settings![key]!, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="option in item.extension.manifest.settings[key].options" :key="option.value" :value="option.value">
              {{ optionLabel(key, option.value, option.label) }}
            </option>
          </select>
        </div>
      </template>

      <div v-if="section.actions?.length" class="flex flex-wrap gap-2 border-t pt-3">
        <Button
          v-for="action in section.actions"
          :key="action.command"
          size="sm"
          :variant="action.variant ?? 'default'"
          :disabled="item.status !== 'active' || runningAction !== null"
          @click="runAction(action)"
        >
          {{ runningAction === action.command ? i18n.t('extensions.running') : actionTitle(action) }}
        </Button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ShieldCheck } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { AI_SCENARIOS } from '@/core/ai/scenarios'
import { isScenarioEnabled, parseExtraBody, resolveProvider } from '@/core/ai/settings'
import { PROVIDER_DEFAULTS, type ProviderKind } from '@/core/ai/types'
import { useAiStore } from '@/stores/ai'
import { useI18nStore } from '@/stores/i18n'
import { useToastStore } from '@/stores/toast'
import { useAiScenarioI18n } from '@/composables/use-ai-scenario-i18n'
import SettingRow from '../SettingRow.vue'

/**
 * AI 设置（6.1 / 6.2 / 6.4）。
 *
 * 隐私说明放在最上面而不是折叠在角落（12.3 也要求这一点）：
 * 用户要决定的是「我愿不愿意把笔记正文发给这家服务商」，
 * 而这个决定只有在他知道数据流向时才成立。
 */

const ai = useAiStore()
const i18n = useI18nStore()
const toast = useToastStore()
const scenarioI18n = useAiScenarioI18n()

const KINDS = computed<Array<{ value: ProviderKind; label: string }>>(() => [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'custom', label: i18n.t('ai.custom') },
])

/** 输入框里的明文 Key。只活在内存里，保存后立刻清空 */
const keyInput = ref('')
const keyMessage = ref<string | null>(null)

const resolved = computed(() => resolveProvider(ai.settings.provider))
const defaults = computed(() => PROVIDER_DEFAULTS[ai.settings.provider.kind])

function setProvider<K extends 'kind' | 'baseUrl' | 'model'>(key: K, value: string): void {
  ai.save({ ...ai.settings, provider: { ...ai.settings.provider, [key]: value } })
}

async function saveKey(): Promise<void> {
  keyMessage.value = null
  try {
    await ai.saveApiKey(keyInput.value)
    // 明文不在界面上多留一秒。用户离开去泡杯咖啡，屏幕上不该还挂着他的 Key
    keyInput.value = ''
    keyMessage.value
      = ai.settings.secret ? i18n.t('ai.savedLocal') : i18n.t('ai.cleared')
    toast.success(keyMessage.value)
  } catch (cause) {
    keyMessage.value = cause instanceof Error ? cause.message : String(cause)
    toast.error(keyMessage.value)
  }
}

async function forgetKey(): Promise<void> {
  await ai.forgetApiKey()
  keyInput.value = ''
  keyMessage.value = i18n.t('ai.clearedAll')
  toast.success(keyMessage.value)
}

/**
 * 额外参数的即时校验。
 *
 * 只提示、不阻止保存——用户是边写边存的，写到一半就把输入退回去
 * 比留一个红字提示烦人得多。真正发请求时解不开就当没配（见 parseExtraBody）。
 */
const parsedExtra = computed(() => parseExtraBody(ai.settings.extraBody))

const extraBodyError = computed(() => {
  if (!ai.settings.extraBody.trim() || parsedExtra.value) return null
  return i18n.t('ai.extraInvalid')
})

const extraBodyKeys = computed(() => Object.keys(parsedExtra.value ?? {}))

/**
 * 几个常见诉求的现成写法。
 *
 * 思考类的字段各家都不一样，因此按服务商分开列——让用户自己去翻文档
 * 拼 JSON 的话，这个功能十有八九就没人用了。
 */
const BODY_PRESETS = computed(() => [
  { label: i18n.t('ai.thinkingOpenai'), json: JSON.stringify({ reasoning_effort: 'high' }, null, 2) },
  {
    label: i18n.t('ai.thinkingAnthropic'),
    json: JSON.stringify({ thinking: { type: 'enabled', budget_tokens: 4000 } }, null, 2),
  },
  {
    label: i18n.t('ai.thinkingOther'),
    json: JSON.stringify({ reasoning: { effort: 'medium' } }, null, 2),
  },
  { label: i18n.t('ai.deterministic'), json: JSON.stringify({ temperature: 0.2 }, null, 2) },
  { label: i18n.t('ai.clear'), json: '' },
] as const)

function toggleScenario(id: string, enabled: boolean): void {
  ai.save({ ...ai.settings, scenarios: { ...ai.settings.scenarios, [id]: enabled } })
}
</script>

<template>
  <div class="space-y-6">
    <!-- 隐私边界（6.2 / 12.3）：说在最前面，且不做任何模糊化 -->
    <div class="rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
      <p class="mb-1 flex items-center gap-1.5 font-medium text-foreground">
        <ShieldCheck class="size-3.5" />
        {{ i18n.t('ai.flow') }}
      </p>
      <p>
        {{ i18n.t('ai.flow1') }}
      </p>
      <p class="mt-1.5">
        {{ i18n.t('ai.flow2') }}
      </p>
    </div>

    <SettingRow :label="i18n.t('ai.enable')" :description="i18n.t('ai.enableHint')">
      <Switch
        :model-value="ai.settings.enabled"
        @update:model-value="ai.save({ ...ai.settings, enabled: $event })"
      />
    </SettingRow>

    <template v-if="ai.settings.enabled">
      <SettingRow :label="i18n.t('ai.provider')" :description="i18n.t('ai.providerHint')">
        <div class="flex gap-2">
          <Button
            v-for="option in KINDS"
            :key="option.value"
            size="sm"
            :variant="ai.settings.provider.kind === option.value ? 'default' : 'outline'"
            @click="setProvider('kind', option.value)"
          >
            {{ option.label }}
          </Button>
        </div>
      </SettingRow>

      <SettingRow label="API Key" :description="i18n.t('ai.keyHint')">
        <div class="flex w-full flex-col gap-2">
          <div class="flex gap-2">
            <Input
              v-model="keyInput"
              type="password"
              class="flex-1 font-mono"
              :placeholder="ai.settings.secret ? i18n.t('ai.keySaved') : i18n.t('ai.keyPaste')"
              autocomplete="off"
              @keydown.enter="saveKey"
            />
            <Button size="sm" @click="saveKey">{{ i18n.t('ai.save') }}</Button>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="keyMessage" class="text-xs text-muted-foreground">{{ keyMessage }}</span>
            <Button
              v-if="ai.settings.secret"
              size="sm"
              variant="ghost"
              class="ml-auto"
              @click="forgetKey"
            >
              {{ i18n.t('ai.clearCredential') }}
            </Button>
          </div>
          <p v-if="ai.settings.provider.kind === 'custom'" class="text-xs text-muted-foreground">
            {{ i18n.t('ai.localHint') }}
          </p>
        </div>
      </SettingRow>

      <SettingRow :label="i18n.t('ai.endpoint')" :description="i18n.t('ai.endpointHint')">
        <div class="flex w-full flex-col gap-2">
          <Input
            :model-value="ai.settings.provider.baseUrl"
            class="w-full font-mono"
            :placeholder="defaults.baseUrl"
            @update:model-value="setProvider('baseUrl', String($event))"
          />
          <Input
            :model-value="ai.settings.provider.model"
            class="w-full font-mono"
            :placeholder="defaults.model"
            @update:model-value="setProvider('model', String($event))"
          />
          <p class="text-xs text-muted-foreground">
            {{ i18n.t('ai.actual') }} <code class="rounded bg-muted px-1">{{ resolved.baseUrl }}</code>
            · <code class="rounded bg-muted px-1">{{ resolved.model }}</code>
          </p>
        </div>
      </SettingRow>

      <SettingRow
        :label="i18n.t('ai.maxTokens')"
        :description="i18n.t('ai.maxTokensHint')"
      >
        <div class="flex w-full items-center gap-2">
          <Input
            :model-value="ai.settings.maxTokens || ''"
            type="number"
            min="0"
            class="w-32 font-mono"
            placeholder="0"
            @update:model-value="ai.save({ ...ai.settings, maxTokens: Math.max(0, Number($event) || 0) })"
          />
          <span class="text-xs text-muted-foreground">
            {{ ai.settings.maxTokens > 0 ? i18n.t('ai.maxTokensValue', { count: ai.settings.maxTokens }) : i18n.t('ai.unlimited') }}
          </span>
        </div>
      </SettingRow>

      <SettingRow
        :label="i18n.t('ai.extra')"
        :description="i18n.t('ai.extraHint')"
      >
        <div class="flex w-full flex-col gap-2">
          <Textarea
            :model-value="ai.settings.extraBody"
            class="min-h-24 w-full font-mono text-xs"
            spellcheck="false"
            placeholder='{ "temperature": 0.7 }'
            @update:model-value="ai.save({ ...ai.settings, extraBody: String($event) })"
          />

          <p v-if="extraBodyError" class="text-xs text-destructive">{{ extraBodyError }}</p>
          <p v-else-if="ai.settings.extraBody.trim()" class="text-xs text-muted-foreground">
            {{ i18n.t('ai.extraMerged', { count: extraBodyKeys.length, keys: extraBodyKeys.join(', ') }) }}
          </p>

          <!-- 给出可直接复制的例子。让用户自己去翻文档拼 JSON，
               这个功能十有八九就没人用了 -->
          <div class="flex flex-wrap gap-1.5">
            <Button
              v-for="preset in BODY_PRESETS"
              :key="preset.label"
              size="sm"
              variant="outline"
              class="h-6 px-2 text-xs"
              :title="preset.json"
              @click="ai.save({ ...ai.settings, extraBody: preset.json })"
            >
              {{ preset.label }}
            </Button>
          </div>
        </div>
      </SettingRow>

      <SettingRow :label="i18n.t('ai.features')" :description="i18n.t('ai.featuresHint')">
        <div class="w-full space-y-2">
          <div
            v-for="scenario in AI_SCENARIOS"
            :key="scenario.id"
            class="flex items-center justify-between gap-3"
          >
            <div class="min-w-0">
              <p class="truncate text-sm">{{ scenarioI18n.label(scenario) }}</p>
              <p class="whitespace-normal text-xs leading-snug text-muted-foreground">{{ scenarioI18n.description(scenario) }}</p>
            </div>
            <Switch
              :model-value="isScenarioEnabled(ai.settings, scenario.id)"
              @update:model-value="toggleScenario(scenario.id, $event)"
            />
          </div>
        </div>
      </SettingRow>
    </template>
  </div>
</template>

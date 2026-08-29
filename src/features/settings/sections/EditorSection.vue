<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { usePreferencesStore } from '@/stores/preferences'
import { useI18nStore } from '@/stores/i18n'
import { computed } from 'vue'
import SettingRow from '../SettingRow.vue'

const preferences = usePreferencesStore()
const i18n = useI18nStore()

/**
 * 自动保存延迟给档位而不是输入框：这个值没有「精确到毫秒」的意义，
 * 而放开输入必然要处理 0 与超大值——0 会让每次按键都写盘。
 */
const DELAYS = computed(() => [
  { value: 200, label: i18n.t('editor.fast'), hint: '0.2 s' },
  { value: 400, label: i18n.t('editor.default'), hint: '0.4 s' },
  { value: 1000, label: i18n.t('editor.slow'), hint: '1 s' },
  { value: 3000, label: i18n.t('editor.diskSaver'), hint: '3 s' },
] as const)
</script>

<template>
  <div class="space-y-6">
    <SettingRow
      :label="i18n.t('editor.autosave')"
      :description="i18n.t('editor.autosaveHint')"
    >
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="option in DELAYS"
          :key="option.value"
          size="sm"
          :variant="preferences.autosaveDelay === option.value ? 'default' : 'outline'"
          @click="preferences.autosaveDelay = option.value"
        >
          {{ option.label }}
          <span class="ml-1 text-xs opacity-70">{{ option.hint }}</span>
        </Button>
      </div>
    </SettingRow>

    <SettingRow :label="i18n.t('editor.spellcheck')" :description="i18n.t('editor.spellcheckHint')">
      <div class="flex w-full items-center justify-between gap-3">
        <Label for="spellcheck" class="cursor-pointer font-normal">{{ i18n.t('editor.enableSpellcheck') }}</Label>
        <Switch id="spellcheck" v-model="preferences.spellcheck" />
      </div>
    </SettingRow>
  </div>
</template>

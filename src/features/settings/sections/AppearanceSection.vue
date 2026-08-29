<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { computed, ref } from 'vue'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { THEME_PRESETS, type ThemePreset } from '@/core/theme/presets'
import type { Appearance } from '@/stores/theme'
import { useThemeStore } from '@/stores/theme'
import { useI18nStore } from '@/stores/i18n'
import SettingRow from '../SettingRow.vue'

const theme = useThemeStore()
const i18n = useI18nStore()
const schemeName = ref('')

async function saveCurrentScheme(): Promise<void> {
  if (!schemeName.value.trim()) return
  await theme.saveScheme(schemeName.value)
  schemeName.value = ''
}

/**
 * 色块预览：底色与文字色各占一半。
 *
 * 按当前明暗模式取对应那套值——用户在深色下选主题，看到的应该是它在深色下的样子。
 * 预设没有覆盖某个变量时回退到当前生效值，这样「极简」也能显示出真实外观
 * 而不是一个空白圆圈。
 */
function swatch(preset: ThemePreset): string {
  const values = theme.isDark ? preset.dark : preset.light
  const read = (key: string, fallback: string): string =>
    values[key] ??
    (getComputedStyle(document.documentElement).getPropertyValue(`--${key}`).trim() || fallback)

  return `linear-gradient(135deg, ${read('background', '#fff')} 50%, ${read('foreground', '#000')} 50%)`
}

function presetText(preset: ThemePreset, field: 'name' | 'hint'): string {
  const key = `preset.${preset.id}${field === 'hint' ? 'Hint' : ''}` as
    | 'preset.default' | 'preset.defaultHint' | 'preset.sepia' | 'preset.sepiaHint'
    | 'preset.contrast' | 'preset.contrastHint' | 'preset.forest' | 'preset.forestHint'
  return i18n.t(key)
}

const APPEARANCES = computed<Array<{ value: Appearance; label: string }>>(() => [
  { value: 'light', label: i18n.t('appearance.light') },
  { value: 'dark', label: i18n.t('appearance.dark') },
  { value: 'system', label: i18n.t('appearance.system') },
])

/**
 * 页宽档位（S10）。
 * 独立于下面的滑块：页宽是「选一个合适的阅读宽度」，不是连续微调，
 * 且「全宽」是百分比而非 rem，塞进滑块会让取值语义不一致。
 */
const PAGE_WIDTHS = computed(() => [
  { value: '45rem', label: i18n.t('appearance.default') },
  { value: '60rem', label: i18n.t('appearance.wide') },
  { value: '100%', label: i18n.t('appearance.full') },
] as const)

/** 数值型排版项统一走一份配置，避免为每个滑块写一遍模板 */
const SLIDERS = computed(() => [
  { key: 'fontSize', label: i18n.t('appearance.fontSize'), min: 0.8, max: 1.4, step: 0.05, unit: 'rem' },
  { key: 'lineHeight', label: i18n.t('appearance.lineHeight'), min: 1.2, max: 2.4, step: 0.05, unit: '' },
  { key: 'density', label: i18n.t('appearance.density'), min: 0.8, max: 1.4, step: 0.05, unit: '' },
] as const)

function readSlider(key: 'fontSize' | 'lineHeight' | 'density'): number {
  const value = theme.typography[key]
  return typeof value === 'number' ? value : Number.parseFloat(String(value))
}

/** Slider 的 model 是数组（它支持多个滑块），这里只取第一个值 */
function writeSlider(key: 'fontSize' | 'lineHeight' | 'density', next: number[] | undefined, unit: string): void {
  const value = next?.[0]
  if (value === undefined) return

  theme.typography = {
    ...theme.typography,
    [key]: unit ? `${value}${unit}` : key === 'density' ? value : String(value),
  }
}
</script>

<template>
  <div class="space-y-6">
    <SettingRow :label="i18n.t('locale.label')" :description="i18n.t('locale.description')">
      <div class="flex gap-2">
        <Button size="sm" :variant="i18n.locale === 'zh-CN' ? 'default' : 'outline'" @click="i18n.locale = 'zh-CN'">{{ i18n.t('locale.zh') }}</Button>
        <Button size="sm" :variant="i18n.locale === 'en-US' ? 'default' : 'outline'" @click="i18n.locale = 'en-US'">{{ i18n.t('locale.en') }}</Button>
      </div>
    </SettingRow>
    <SettingRow :label="i18n.t('appearance.theme')" :description="i18n.t('appearance.themeHint')">
      <div class="flex gap-2">
        <Button
          v-for="option in APPEARANCES"
          :key="option.value"
          size="sm"
          :variant="theme.appearance === option.value ? 'default' : 'outline'"
          @click="theme.appearance = option.value"
        >
          {{ option.label }}
        </Button>
      </div>
    </SettingRow>

    <!--
      色板放在主题之后、页宽之前：它与明暗模式是同一类决定（界面长什么样），
      而页宽属于阅读设置。每个预设给出两个色块预览，让用户不必逐个点开试。
    -->
    <SettingRow :label="i18n.t('appearance.colors')" :description="i18n.t('appearance.colorsHint')">
      <div class="grid w-full grid-cols-2 gap-2">
        <button
          v-for="option in THEME_PRESETS"
          :key="option.id"
          type="button"
          class="flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors"
          :class="theme.preset === option.id ? 'border-ring ring-1 ring-ring' : 'border-border hover:bg-accent'"
          @click="theme.preset = option.id"
        >
          <span
            class="size-7 shrink-0 rounded-full border border-border"
            :style="{ background: swatch(option) }"
          />
          <span class="min-w-0">
            <span class="block truncate text-sm">{{ presetText(option, 'name') }}</span>
            <span class="block whitespace-normal text-xs leading-snug text-muted-foreground">{{ presetText(option, 'hint') }}</span>
          </span>
        </button>
      </div>
    </SettingRow>

    <SettingRow :label="i18n.t('appearance.schemes')" :description="i18n.t('appearance.schemesHint')">
      <div class="w-full space-y-2">
        <div class="flex gap-2">
          <Input v-model="schemeName" :placeholder="i18n.t('appearance.schemeName')" @keydown.enter.prevent="saveCurrentScheme" />
          <Button size="sm" :disabled="!schemeName.trim()" @click="saveCurrentScheme">{{ i18n.t('appearance.saveCurrent') }}</Button>
        </div>
        <div v-if="theme.schemes.length" class="space-y-1">
          <div v-for="scheme in theme.schemes" :key="scheme.id" class="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
            <button class="min-w-0 flex-1 truncate text-left text-sm" @click="theme.applyScheme(scheme.id)">{{ scheme.name }}</button>
            <Button size="sm" variant="ghost" @click="theme.removeScheme(scheme.id)">{{ i18n.t('appearance.delete') }}</Button>
          </div>
        </div>
        <p v-else class="text-xs text-muted-foreground">{{ i18n.t('appearance.noSchemes') }}</p>
      </div>
    </SettingRow>

    <SettingRow :label="i18n.t('appearance.pageWidth')" :description="i18n.t('appearance.pageWidthHint')">
      <div class="flex gap-2">
        <Button
          v-for="option in PAGE_WIDTHS"
          :key="option.value"
          size="sm"
          :variant="theme.typography.editorWidth === option.value ? 'default' : 'outline'"
          @click="theme.typography = { ...theme.typography, editorWidth: option.value }"
        >
          {{ option.label }}
        </Button>
      </div>
    </SettingRow>

    <SettingRow :label="i18n.t('appearance.typography')">
      <div class="space-y-4">
        <div v-for="slider in SLIDERS" :key="slider.key" class="space-y-2">
          <div class="flex items-center justify-between">
            <Label class="text-xs font-normal text-muted-foreground">{{ slider.label }}</Label>
            <span class="font-mono text-xs text-muted-foreground">
              {{ readSlider(slider.key) }}{{ slider.unit }}
            </span>
          </div>
          <Slider
            :model-value="[readSlider(slider.key)]"
            :min="slider.min"
            :max="slider.max"
            :step="slider.step"
            @update:model-value="writeSlider(slider.key, $event, slider.unit)"
          />
        </div>

        <div class="space-y-1.5">
          <Label for="font-family" class="text-xs font-normal text-muted-foreground">{{ i18n.t('appearance.font') }}</Label>
          <Input id="font-family" v-model="theme.typography.fontFamily" class="w-full font-mono text-xs" />
        </div>

        <Button size="sm" variant="ghost" @click="theme.resetTypography()">{{ i18n.t('appearance.resetTypography') }}</Button>
      </div>
    </SettingRow>

    <SettingRow
      :label="i18n.t('appearance.customCss')"
      :description="i18n.t('appearance.customCssHint')"
    >
      <Textarea
        v-model="theme.customCss"
        rows="8"
        spellcheck="false"
        placeholder=":root { --primary: oklch(0.55 0.2 260); }"
        class="w-full resize-y font-mono text-xs"
      />
    </SettingRow>
  </div>
</template>

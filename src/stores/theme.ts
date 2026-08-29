import { useMediaQuery } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watchEffect } from 'vue'
import { DEFAULT_PRESET_ID, findPreset, presetCss } from '@/core/theme/presets'
import { ThemeSchemeService, type ThemeScheme } from '@/core/theme/schemes'
import { useWorkspaceStore } from './workspace'

const STORAGE_KEY = 'light:appearance'
const PRESET_STYLE_ID = 'light-preset'
const TYPOGRAPHY_STYLE_ID = 'light-typography'
const CUSTOM_STYLE_ID = 'light-custom-css'

export type Appearance = 'light' | 'dark' | 'system'

export interface Typography {
  /** 正文最大宽度，CSS 长度值 */
  editorWidth: string
  fontSize: string
  lineHeight: string
  fontFamily: string
  /** 侧边栏行高倍率 */
  density: number
}

const DEFAULT_TYPOGRAPHY: Typography = {
  editorWidth: '45rem',
  fontSize: '1rem',
  lineHeight: '1.75',
  fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
  density: 1,
}

interface Persisted {
  appearance: Appearance
  /** 预设主题 id（5.3）；与明暗模式正交，两者可任意组合 */
  preset: string
  typography: Typography
  customCss: string
}

/**
 * 外观定制。
 *
 * 三层变量的分工见 `src/styles/main.css`：这里只写第 1、2 层的 CSS 变量，
 * 从不直接改组件类名，因此换肤永远不会破坏 shadcn-vue 的组件结构。
 * 用户的自定义 CSS 追加在最后一个 <style> 中，天然具有最高优先级。
 */
export const useThemeStore = defineStore('theme', () => {
  const workspace = useWorkspaceStore()
  const persisted = readPersisted()

  const appearance = ref<Appearance>(persisted.appearance)
  const preset = ref(persisted.preset)
  const typography = ref<Typography>(persisted.typography)
  const customCss = ref(persisted.customCss)
  const schemes = ref<ThemeScheme[]>([])

  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const isDark = computed(() =>
    appearance.value === 'system' ? prefersDark.value : appearance.value === 'dark',
  )

  // 三个 effect 各自独立：改字号不会触发暗色模式重算，也便于单独调试
  watchEffect(() => {
    document.documentElement.classList.toggle('dark', isDark.value)
  })

  // 预设主题的 effect 必须排在排版之前：<style> 节点按首次创建顺序进 <head>，
  // 也就决定了优先级。预设只管颜色，排版与自定义 CSS 都该盖在它上面。
  watchEffect(() => {
    styleElement(PRESET_STYLE_ID).textContent = presetCss(findPreset(preset.value))
  })

  // 排版变量写进 <style> 而不是元素内联样式：内联样式的优先级高于任何选择器，
  // 一旦用内联写，用户自定义 CSS 里的 :root 规则就永远覆盖不了排版设置。
  // 两个 style 节点的先后顺序即优先级顺序，自定义 CSS 始终在后。
  watchEffect(() => {
    const { editorWidth, fontSize, lineHeight, fontFamily, density } = typography.value
    styleElement(TYPOGRAPHY_STYLE_ID).textContent = `:root {
  --light-editor-width: ${editorWidth};
  --light-editor-font-size: ${fontSize};
  --light-editor-line-height: ${lineHeight};
  --light-font-sans: ${fontFamily};
  --light-density: ${density};
}`
  })

  watchEffect(() => {
    styleElement(CUSTOM_STYLE_ID).textContent = customCss.value
  })

  watchEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        appearance: appearance.value,
        preset: preset.value,
        typography: typography.value,
        customCss: customCss.value,
      } satisfies Persisted),
    )
  })

  function toggleDark(): void {
    appearance.value = isDark.value ? 'light' : 'dark'
  }

  function resetTypography(): void {
    typography.value = { ...DEFAULT_TYPOGRAPHY }
  }

  async function loadSchemes(): Promise<void> {
    if (!workspace.storage) {
      schemes.value = []
      return
    }
    schemes.value = (await new ThemeSchemeService(workspace.storage).read()).schemes
  }

  async function saveScheme(name: string): Promise<ThemeScheme> {
    if (!workspace.storage) throw new Error('数据目录尚未就绪')
    const trimmed = name.trim()
    if (!trimmed) throw new Error('主题方案名称不能为空')
    const existing = schemes.value.find((item) => item.name === trimmed)
    const scheme: ThemeScheme = {
      id: existing?.id ?? crypto.randomUUID(),
      name: trimmed,
      appearance: appearance.value,
      preset: preset.value,
      typography: { ...typography.value },
      customCss: customCss.value,
      updatedAt: Date.now(),
    }
    schemes.value = existing
      ? schemes.value.map((item) => item.id === existing.id ? scheme : item)
      : [...schemes.value, scheme]
    await new ThemeSchemeService(workspace.storage).write({ version: 1, schemes: schemes.value })
    return scheme
  }

  function applyScheme(id: string): void {
    const scheme = schemes.value.find((item) => item.id === id)
    if (!scheme) return
    appearance.value = scheme.appearance
    preset.value = scheme.preset
    typography.value = { ...scheme.typography }
    customCss.value = scheme.customCss
  }

  async function removeScheme(id: string): Promise<void> {
    if (!workspace.storage) return
    schemes.value = schemes.value.filter((item) => item.id !== id)
    await new ThemeSchemeService(workspace.storage).write({ version: 1, schemes: schemes.value })
  }

  workspace.onOpened(loadSchemes)
  workspace.onChanged(() => { schemes.value = [] })

  return {
    appearance, preset, typography, customCss, schemes, isDark,
    toggleDark, resetTypography, loadSchemes, saveScheme, applyScheme, removeScheme,
  }
})

/**
 * 取得（必要时创建）指定 id 的 <style> 节点，复用同一个节点避免重复插入。
 *
 * 首次调用顺序决定了它们在 <head> 中的先后，也就决定了优先级：
 * 排版层先建、自定义 CSS 后建，因此用户写的 `:root` 规则总能覆盖排版设置。
 */
function styleElement(id: string): HTMLStyleElement {
  const existing = document.getElementById(id)
  if (existing instanceof HTMLStyleElement) return existing

  const element = document.createElement('style')
  element.id = id
  document.head.append(element)
  return element
}

function readPersisted(): Persisted {
  const fallback: Persisted = {
    appearance: 'system',
    preset: DEFAULT_PRESET_ID,
    typography: { ...DEFAULT_TYPOGRAPHY },
    customCss: '',
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      appearance: parsed.appearance ?? fallback.appearance,
      preset: parsed.preset ?? fallback.preset,
      typography: { ...DEFAULT_TYPOGRAPHY, ...parsed.typography },
      customCss: typeof parsed.customCss === 'string' ? parsed.customCss : '',
    }
  } catch {
    return fallback
  }
}

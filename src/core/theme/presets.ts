/**
 * 内置预设主题（需求 5.3）。
 *
 * 预设只覆盖第 1 层的颜色变量，不碰组件类名、不碰排版层——因此它与
 * 「明暗模式」「字号页宽」「自定义 CSS」四件事互不干扰，可以任意组合。
 * 每个预设都必须同时给出亮色与暗色两套值：只给一套的话，用户切到暗色
 * 会得到一个白底黑字的「暗色模式」，那比没有预设更糟。
 *
 * 数量刻意克制。预设的价值在于「不用自己调也有几个能看的选择」，
 * 堆到十几个就变成了又一道选择题，而真正想精细控制的人有自定义 CSS。
 */

export interface ThemePreset {
  id: string
  name: string
  description: string
  /** 亮色下的变量覆盖；空对象表示沿用内置值 */
  light: Record<string, string>
  dark: Record<string, string>
}

export const DEFAULT_PRESET_ID = 'default'

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: DEFAULT_PRESET_ID,
    name: '极简',
    description: '中性灰阶，不带任何色彩倾向',
    light: {},
    dark: {},
  },
  {
    id: 'sepia',
    name: '护眼',
    description: '暖色纸张底色，降低蓝光与刺目的纯白',
    light: {
      background: 'oklch(0.965 0.018 85)',
      card: 'oklch(0.975 0.014 85)',
      popover: 'oklch(0.975 0.014 85)',
      foreground: 'oklch(0.26 0.02 60)',
      'card-foreground': 'oklch(0.26 0.02 60)',
      'popover-foreground': 'oklch(0.26 0.02 60)',
      muted: 'oklch(0.93 0.022 85)',
      'muted-foreground': 'oklch(0.50 0.025 70)',
      accent: 'oklch(0.92 0.03 85)',
      'accent-foreground': 'oklch(0.26 0.02 60)',
      secondary: 'oklch(0.93 0.022 85)',
      'secondary-foreground': 'oklch(0.26 0.02 60)',
      border: 'oklch(0.88 0.025 82)',
      input: 'oklch(0.88 0.025 82)',
      sidebar: 'oklch(0.945 0.024 85)',
      'sidebar-foreground': 'oklch(0.26 0.02 60)',
      'sidebar-accent': 'oklch(0.91 0.03 85)',
      'sidebar-border': 'oklch(0.88 0.025 82)',
    },
    dark: {
      // 暗色下的「护眼」是偏暖的深褐，而不是把亮色那套调暗——
      // 后者会得到浑浊的土色，看着比纯黑更累
      background: 'oklch(0.20 0.012 60)',
      card: 'oklch(0.24 0.012 60)',
      popover: 'oklch(0.24 0.012 60)',
      foreground: 'oklch(0.90 0.015 80)',
      'card-foreground': 'oklch(0.90 0.015 80)',
      'popover-foreground': 'oklch(0.90 0.015 80)',
      muted: 'oklch(0.27 0.012 60)',
      'muted-foreground': 'oklch(0.70 0.018 75)',
      accent: 'oklch(0.30 0.016 65)',
      'accent-foreground': 'oklch(0.92 0.015 80)',
      secondary: 'oklch(0.27 0.012 60)',
      'secondary-foreground': 'oklch(0.90 0.015 80)',
      border: 'oklch(0.32 0.014 62)',
      input: 'oklch(0.32 0.014 62)',
      sidebar: 'oklch(0.18 0.012 60)',
      'sidebar-foreground': 'oklch(0.90 0.015 80)',
      'sidebar-accent': 'oklch(0.28 0.016 65)',
      'sidebar-border': 'oklch(0.32 0.014 62)',
    },
  },
  {
    id: 'contrast',
    name: '高对比',
    description: '纯黑白与加重的边框，弱视或强光环境下更易辨认',
    light: {
      background: 'oklch(1 0 0)',
      foreground: 'oklch(0 0 0)',
      'card-foreground': 'oklch(0 0 0)',
      'popover-foreground': 'oklch(0 0 0)',
      // 次要文字也必须够黑。高对比模式下把说明文字调淡，
      // 等于把最需要放大的那部分排除在外
      'muted-foreground': 'oklch(0.32 0 0)',
      'accent-foreground': 'oklch(0 0 0)',
      'secondary-foreground': 'oklch(0 0 0)',
      border: 'oklch(0.45 0 0)',
      input: 'oklch(0.35 0 0)',
      ring: 'oklch(0 0 0)',
      'sidebar-foreground': 'oklch(0 0 0)',
      'sidebar-border': 'oklch(0.45 0 0)',
    },
    dark: {
      background: 'oklch(0 0 0)',
      card: 'oklch(0.10 0 0)',
      popover: 'oklch(0.10 0 0)',
      foreground: 'oklch(1 0 0)',
      'card-foreground': 'oklch(1 0 0)',
      'popover-foreground': 'oklch(1 0 0)',
      'muted-foreground': 'oklch(0.80 0 0)',
      'accent-foreground': 'oklch(1 0 0)',
      'secondary-foreground': 'oklch(1 0 0)',
      border: 'oklch(0.62 0 0)',
      input: 'oklch(0.70 0 0)',
      ring: 'oklch(1 0 0)',
      sidebar: 'oklch(0 0 0)',
      'sidebar-foreground': 'oklch(1 0 0)',
      'sidebar-border': 'oklch(0.62 0 0)',
    },
  },
  {
    id: 'forest',
    name: '林间',
    description: '低饱和的青绿调，界面有色彩但不抢正文',
    light: {
      background: 'oklch(0.98 0.008 165)',
      card: 'oklch(0.99 0.006 165)',
      popover: 'oklch(0.99 0.006 165)',
      foreground: 'oklch(0.22 0.02 170)',
      'card-foreground': 'oklch(0.22 0.02 170)',
      'popover-foreground': 'oklch(0.22 0.02 170)',
      primary: 'oklch(0.45 0.09 165)',
      'primary-foreground': 'oklch(0.98 0.008 165)',
      muted: 'oklch(0.94 0.014 165)',
      'muted-foreground': 'oklch(0.48 0.025 168)',
      accent: 'oklch(0.92 0.025 165)',
      'accent-foreground': 'oklch(0.22 0.02 170)',
      secondary: 'oklch(0.94 0.014 165)',
      'secondary-foreground': 'oklch(0.22 0.02 170)',
      border: 'oklch(0.89 0.018 165)',
      input: 'oklch(0.89 0.018 165)',
      ring: 'oklch(0.55 0.08 165)',
      sidebar: 'oklch(0.955 0.014 165)',
      'sidebar-foreground': 'oklch(0.22 0.02 170)',
      'sidebar-accent': 'oklch(0.91 0.026 165)',
      'sidebar-border': 'oklch(0.89 0.018 165)',
    },
    dark: {
      background: 'oklch(0.17 0.016 175)',
      card: 'oklch(0.21 0.016 175)',
      popover: 'oklch(0.21 0.016 175)',
      foreground: 'oklch(0.92 0.012 165)',
      'card-foreground': 'oklch(0.92 0.012 165)',
      'popover-foreground': 'oklch(0.92 0.012 165)',
      primary: 'oklch(0.75 0.10 165)',
      'primary-foreground': 'oklch(0.17 0.016 175)',
      muted: 'oklch(0.25 0.016 175)',
      'muted-foreground': 'oklch(0.70 0.02 168)',
      accent: 'oklch(0.29 0.026 170)',
      'accent-foreground': 'oklch(0.94 0.012 165)',
      secondary: 'oklch(0.25 0.016 175)',
      'secondary-foreground': 'oklch(0.92 0.012 165)',
      border: 'oklch(0.31 0.02 172)',
      input: 'oklch(0.31 0.02 172)',
      ring: 'oklch(0.62 0.08 165)',
      sidebar: 'oklch(0.15 0.016 175)',
      'sidebar-foreground': 'oklch(0.92 0.012 165)',
      'sidebar-accent': 'oklch(0.27 0.026 170)',
      'sidebar-border': 'oklch(0.31 0.02 172)',
    },
  },
]

export function findPreset(id: string): ThemePreset {
  return THEME_PRESETS.find((preset) => preset.id === id) ?? THEME_PRESETS[0]!
}

/**
 * 生成预设对应的 CSS。
 *
 * 亮色写成 `:root:not(.dark)` 而不是 `:root`。这不是风格问题：预设的
 * `<style>` 排在 main.css 之后，而 `:root` 与 `.dark` 的优先级相同，
 * 靠后者胜出——用普通的 `:root`，暗色模式下亮色变量会盖掉 main.css 的 `.dark`，
 * 界面会变成白底。加一个 `:not(.dark)` 让两条规则在选择器层面互斥，
 * 顺序就不再重要。
 */
export function presetCss(preset: ThemePreset): string {
  const block = (selector: string, values: Record<string, string>): string => {
    const entries = Object.entries(values)
    if (entries.length === 0) return ''
    return `${selector} {\n${entries.map(([key, value]) => `  --${key}: ${value};`).join('\n')}\n}`
  }

  return [block(':root:not(.dark)', preset.light), block('.dark', preset.dark)]
    .filter(Boolean)
    .join('\n\n')
}

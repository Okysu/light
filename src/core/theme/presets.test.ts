import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESET_ID, findPreset, presetCss, THEME_PRESETS } from './presets'

describe('THEME_PRESETS', () => {
  it('id 唯一', () => {
    const ids = THEME_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个预设都同时给出亮色与暗色——只给一套会让暗色模式变成白底', () => {
    for (const preset of THEME_PRESETS) {
      if (preset.id === DEFAULT_PRESET_ID) continue
      expect(Object.keys(preset.light).length, preset.id).toBeGreaterThan(0)
      expect(Object.keys(preset.dark).length, preset.id).toBeGreaterThan(0)
    }
  })

  it('凡是改了底色的都同时改了前景色，不会出现白底白字', () => {
    for (const preset of THEME_PRESETS) {
      for (const values of [preset.light, preset.dark]) {
        if (values['background'] === undefined) continue
        expect(values['foreground'], preset.id).toBeDefined()
      }
    }
  })
})

describe('findPreset', () => {
  it('按 id 取', () => {
    expect(findPreset('sepia').name).toBe('护眼')
  })

  it('id 不认识时退回第一个，而不是留下一个空主题', () => {
    expect(findPreset('已经删掉的主题').id).toBe(DEFAULT_PRESET_ID)
  })
})

describe('presetCss', () => {
  it('亮色规则写成 :root:not(.dark)，避免盖掉内置的暗色变量', () => {
    const css = presetCss(findPreset('sepia'))

    expect(css).toContain(':root:not(.dark) {')
    expect(css).toMatch(/^\.dark \{/m)
    // 普通的 :root 会因为排在 main.css 之后而胜过 .dark，界面在暗色下会变白底
    expect(css).not.toMatch(/^:root \{/m)
  })

  it('变量名带上 -- 前缀', () => {
    expect(presetCss(findPreset('contrast'))).toContain('--foreground:')
  })

  it('默认预设不产生任何规则', () => {
    expect(presetCss(findPreset(DEFAULT_PRESET_ID))).toBe('')
  })
})

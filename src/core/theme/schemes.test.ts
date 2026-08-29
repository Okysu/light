import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage'
import { normalizeThemeSchemes, ThemeSchemeService, THEME_SCHEMES_PATH } from './schemes'

describe('主题方案', () => {
  it('归一化损坏字段并丢弃无 id/name 的条目', () => {
    const doc = normalizeThemeSchemes({ schemes: [
      { id: 'a', name: '方案', typography: { editorWidth: '60rem', density: 1.2 }, customCss: 1 },
      { id: '', name: '坏项', typography: {} },
    ] })
    expect(doc.version).toBe(1)
    expect(doc.schemes).toHaveLength(1)
    expect(doc.schemes[0]?.typography.editorWidth).toBe('60rem')
    expect(doc.schemes[0]?.customCss).toBe('')
  })

  it('保存到同步范围内的 .light/themes.json 并可读回', async () => {
    const storage = new MemoryAdapter()
    const service = new ThemeSchemeService(storage)
    await service.write({ version: 1, schemes: [{
      id: 'x', name: '护眼写作', appearance: 'system', preset: 'forest',
      typography: { editorWidth: '45rem', fontSize: '1rem', lineHeight: '1.75', fontFamily: 'serif', density: 1 },
      customCss: ':root{}', updatedAt: 1,
    }] })
    expect(await storage.exists(THEME_SCHEMES_PATH)).toBe(true)
    expect((await service.read()).schemes[0]?.name).toBe('护眼写作')
  })
})

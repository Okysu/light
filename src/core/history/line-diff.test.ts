import { describe, expect, it } from 'vitest'
import { lineDiff } from './line-diff'

describe('lineDiff', () => {
  it('标出新增、删除与未变化的行', () => {
    expect(lineDiff('一\n旧\n三', '一\n新\n三')).toEqual([
      { kind: 'same', text: '一', oldLine: 1, newLine: 1 },
      { kind: 'added', text: '新', oldLine: null, newLine: 2 },
      { kind: 'removed', text: '旧', oldLine: 2, newLine: null },
      { kind: 'same', text: '三', oldLine: 3, newLine: 3 },
    ])
  })

  it('纯新增与纯删除的行号正确', () => {
    expect(lineDiff('', '新增').some((line) => line.kind === 'added' && line.newLine === 1)).toBe(true)
    expect(lineDiff('删除', '').some((line) => line.kind === 'removed' && line.oldLine === 1)).toBe(true)
  })

  it('超长文本退化后仍保留共同前后缀与全部差异', () => {
    const before = ['头', ...Array.from({ length: 400 }, (_, index) => `旧${index}`), '尾'].join('\n')
    const after = ['头', ...Array.from({ length: 400 }, (_, index) => `新${index}`), '尾'].join('\n')
    const result = lineDiff(before, after)
    expect(result[0]).toMatchObject({ kind: 'same', text: '头' })
    expect(result.at(-1)).toMatchObject({ kind: 'same', text: '尾' })
    expect(result.filter((line) => line.kind === 'removed')).toHaveLength(400)
    expect(result.filter((line) => line.kind === 'added')).toHaveLength(400)
  })
})

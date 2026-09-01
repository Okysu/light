import { describe, expect, it } from 'vitest'
import { createStreamTextNormalizer } from './stream-text'

function normalize(chunks: string[]): string {
  const next = createStreamTextNormalizer()
  return chunks.map(next).join('')
}

describe('AI 流式文本归一化', () => {
  it('保留标准增量流', () => {
    expect(normalize(['你', '好', '，', '世界'])).toBe('你好，世界')
  })

  it('把累计快照转换成增量，避免续写重复', () => {
    expect(normalize(['你', '你好', '你好，世', '你好，世界'])).toBe('你好，世界')
  })

  it('忽略累计模式里的重复与过期快照', () => {
    expect(normalize(['开', '开始', '开始', '开', '开始续写'])).toBe('开始续写')
  })

  it('累计服务恢复为标准增量后不吞字', () => {
    expect(normalize(['A', 'AB', 'C', 'D'])).toBe('ABCD')
  })

  it('标准增量中相邻的相同文本仍会保留', () => {
    expect(normalize(['哈', '哈', '！'])).toBe('哈哈！')
  })
})

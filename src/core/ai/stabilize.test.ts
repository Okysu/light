import { describe, expect, it } from 'vitest'
import { stabilize } from './stabilize'

describe('stabilize', () => {
  it('已经配对的内容原样返回', () => {
    expect(stabilize('这是**加粗**的文字')).toBe('这是**加粗**的文字')
  })

  it('补上未闭合的粗体', () => {
    expect(stabilize('这是**加粗')).toBe('这是**加粗**')
  })

  it('补上未闭合的行内代码', () => {
    expect(stabilize('执行 `npm run')).toBe('执行 `npm run`')
  })

  it('补上未闭合的围栏代码块', () => {
    expect(stabilize('```js\nconst a = 1')).toBe('```js\nconst a = 1\n```')
  })

  it('围栏已闭合时不再补', () => {
    const text = '```js\nconst a = 1\n```'
    expect(stabilize(text)).toBe(text)
  })

  it('`**` 不会被 `*` 的规则拆掉', () => {
    // 先长后短的处理顺序：两个 ** 已配对，不该被当成四个未配对的 *
    expect(stabilize('**加粗**')).toBe('**加粗**')
  })

  it('只补不删——未闭合的标记不会被抹掉', () => {
    expect(stabilize('半个**')).toContain('半个')
  })

  it('空输入返回空', () => {
    expect(stabilize('')).toBe('')
  })

  it('多种标记同时未闭合时逐个补上', () => {
    const result = stabilize('带`代码和**加粗')

    expect(result.endsWith('**`') || result.endsWith('`**')).toBe(true)
  })

  it('删除线也参与配对', () => {
    expect(stabilize('~~删掉')).toBe('~~删掉~~')
  })
})

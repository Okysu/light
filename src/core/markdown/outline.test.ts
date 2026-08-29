import { describe, expect, it } from 'vitest'
import { parseOutline } from './outline'

describe('parseOutline', () => {
  it('提取各级 ATX 标题并记录层级', () => {
    const outline = parseOutline('# 一级\n\n## 二级\n\n###### 六级\n')
    expect(outline.map((h) => [h.level, h.text])).toEqual([
      [1, '一级'],
      [2, '二级'],
      [6, '六级'],
    ])
  })

  it('index 按出现顺序递增，用于对应 DOM 中的标题元素', () => {
    expect(parseOutline('# a\n## b\n### c\n').map((h) => h.index)).toEqual([0, 1, 2])
  })

  it('忽略代码块内的井号', () => {
    const markdown = '# 真标题\n\n```bash\n# 这是注释不是标题\n```\n\n## 另一个真标题\n'
    expect(parseOutline(markdown).map((h) => h.text)).toEqual(['真标题', '另一个真标题'])
  })

  it('波浪号围栏同样有效，且不同围栏字符不会互相闭合', () => {
    const markdown = '~~~\n# 注释\n~~~\n\n# 标题\n'
    expect(parseOutline(markdown).map((h) => h.text)).toEqual(['标题'])
  })

  it('七个井号不是标题', () => {
    expect(parseOutline('####### 不是标题\n')).toEqual([])
  })

  it('井号后必须有空格', () => {
    expect(parseOutline('#不是标题\n')).toEqual([])
  })

  it('去掉收尾井号', () => {
    expect(parseOutline('## 标题 ##\n')[0]?.text).toBe('标题')
  })

  it('剥离行内标记，只留纯文本', () => {
    expect(parseOutline('# **粗** 与 `码` 与 [链接](https://a.com)\n')[0]?.text).toBe('粗 与 码 与 链接')
  })

  it('支持 setext 式标题', () => {
    const outline = parseOutline('一级标题\n===\n\n二级标题\n---\n')
    expect(outline.map((h) => [h.level, h.text])).toEqual([
      [1, '一级标题'],
      [2, '二级标题'],
    ])
  })

  it('空行后的分割线不会被误判为 setext 标题', () => {
    expect(parseOutline('正文\n\n---\n\n更多正文\n')).toEqual([])
  })

  it('无标题时返回空数组', () => {
    expect(parseOutline('只有正文。\n')).toEqual([])
  })
})

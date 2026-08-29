import { describe, expect, it } from 'vitest'
import { joinTitle, splitTitle } from './title'

describe('splitTitle', () => {
  it('抽出首个一级标题，正文不含它', () => {
    expect(splitTitle('# 会议纪要\n\n讨论了进度。')).toEqual({
      title: '会议纪要',
      body: '讨论了进度。',
    })
  })

  it('容忍标题前的空行', () => {
    expect(splitTitle('\n\n# 标题\n正文').title).toBe('标题')
  })

  it('去掉标题后紧随的空行，避免正文顶部积累空白', () => {
    expect(splitTitle('# 标题\n\n\n\n正文').body).toBe('正文')
  })

  it('支持 ATX 的收尾井号', () => {
    expect(splitTitle('# 标题 ##\n正文').title).toBe('标题')
  })

  it('二级标题开头的文档不算有标题', () => {
    const markdown = '## 小标题\n正文'
    expect(splitTitle(markdown)).toEqual({ title: null, body: markdown })
  })

  it('正文中间的 H1 不会被当成文档标题', () => {
    const markdown = '开头一句。\n\n# 中间的标题\n后续'
    expect(splitTitle(markdown)).toEqual({ title: null, body: markdown })
  })

  it('只有一个 # 时不当作标题——否则用户刚敲下 `# ` 正文就被吃掉', () => {
    expect(splitTitle('#\n正文').title).toBeNull()
    expect(splitTitle('#   \n正文').title).toBeNull()
  })

  it('`#` 后没有空格的不是标题', () => {
    const markdown = '#标签写法\n正文'
    expect(splitTitle(markdown)).toEqual({ title: null, body: markdown })
  })

  it('只有标题、没有正文时 body 为空', () => {
    expect(splitTitle('# 只有标题')).toEqual({ title: '只有标题', body: '' })
  })

  it('空文档', () => {
    expect(splitTitle('')).toEqual({ title: null, body: '' })
  })
})

describe('joinTitle', () => {
  it('标题写回为正文开头的 H1', () => {
    expect(joinTitle('会议纪要', '讨论了进度。')).toBe('# 会议纪要\n\n讨论了进度。')
  })

  it('没有标题时原样返回正文', () => {
    expect(joinTitle(null, '正文')).toBe('正文')
    expect(joinTitle('   ', '正文')).toBe('正文')
  })

  it('正文为空时不留多余空行', () => {
    expect(joinTitle('标题', '')).toBe('# 标题\n')
  })

  it('与 splitTitle 往返一致', () => {
    const original = '# 标题\n\n正文内容。\n'
    const { title, body } = splitTitle(original)
    expect(joinTitle(title, body)).toBe(original)
  })

  it('无标题文档的往返同样保持原样', () => {
    const original = '没有标题的正文。\n'
    const { title, body } = splitTitle(original)
    expect(joinTitle(title, body)).toBe(original)
  })
})

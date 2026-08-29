import { beforeAll, describe, expect, it } from 'vitest'
import { documentHtml, documentMarkdown } from './copy-document'

describe('documentMarkdown', () => {
  it('剥掉 frontmatter，把标题补成一级标题', () => {
    const raw = '---\ntitle: 部署手册\ntags: [运维]\n---\n\n先装依赖。'

    expect(documentMarkdown(raw, '手册.md')).toBe('# 部署手册\n\n先装依赖。')
  })

  it('正文已经以一级标题开头时不再补，避免两个标题', () => {
    const raw = '---\ntitle: 部署手册\n---\n\n# 部署手册\n\n先装依赖。'

    expect(documentMarkdown(raw, '手册.md')).toBe('# 部署手册\n\n先装依赖。')
  })

  it('没有 title 字段时用文件名', () => {
    expect(documentMarkdown('正文', '归档/周报.md')).toBe('# 周报\n\n正文')
  })

  it('不改动正文里的 Markdown 语法', () => {
    const raw = '---\ntitle: T\n---\n| a | b |\n| - | - |\n| 1 | 2 |'

    expect(documentMarkdown(raw, 'x.md')).toContain('| a | b |')
  })
})

describe('documentHtml', () => {
  // 先跑一次把 unified + katex 那条动态 import 链加载完。
  // 不这么做的话，整条管线几秒钟的冷启动会全算在第一个用例头上而超时——
  // 那是模块加载慢，不是渲染慢，让它伪装成用例失败只会误导人。
  beforeAll(async () => {
    await documentHtml('预热')
  }, 30_000)

  it('标题、列表、表格渲染成 HTML', async () => {
    const html = await documentHtml('# 标题\n\n- 甲\n- 乙')

    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<li>甲</li>')
  })

  it('GFM 表格与删除线', async () => {
    const html = await documentHtml('| a |\n| - |\n| 1 |\n\n~~删~~')

    expect(html).toContain('<table>')
    expect(html).toContain('<del>删</del>')
  })

  it('公式渲染成 KaTeX 而不是原样的美元符号', async () => {
    const html = await documentHtml('$E = mc^2$')

    expect(html).toContain('katex')
    expect(html).not.toContain('$E = mc^2$')
  })

  it('wikilink 降级成纯文本——离开 Light 后它指向的东西不存在', async () => {
    const html = await documentHtml('见 [[部署手册|手册]]')

    expect(html).toContain('手册')
    expect(html).not.toContain('href')
    expect(html).not.toContain('[[')
  })
})

describe('不可信输入（模型输出要进 v-html）', () => {
  it('剥掉 script 标签', async () => {
    const html = await documentHtml('正常文字\n\n<script>alert(1)</script>', { trusted: false })

    expect(html).not.toContain('<script')
    expect(html).toContain('正常文字')
  })

  it('剥掉事件属性', async () => {
    const html = await documentHtml('<img src="x" onerror="alert(1)">', { trusted: false })

    expect(html).not.toContain('onerror')
  })

  it('拦下 javascript: 链接', async () => {
    const html = await documentHtml('[点我](javascript:alert(1))', { trusted: false })

    expect(html).not.toContain('javascript:')
  })

  it('正常的 Markdown 结构不受影响', async () => {
    const html = await documentHtml('# 标题\n\n- 甲\n\n**粗**', { trusted: false })

    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<li>甲</li>')
    expect(html).toContain('<strong>粗</strong>')
  })

  it('公式仍然渲染——sanitize 排在 katex 之前才不会把它剥掉', async () => {
    const html = await documentHtml('$E = mc^2$', { trusted: false })

    expect(html).toContain('katex')
  })

  it('可信输入（用户自己的笔记）保留原始 HTML', async () => {
    const html = await documentHtml('<div class="custom">我写的</div>')

    expect(html).toContain('<div class="custom">')
  })
})

// @vitest-environment jsdom

import { editorViewCtx } from '@milkdown/kit/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createLightEditor } from '../create-editor'
import { sanitizePastedHtml } from './paste-sanitizer'

const editors: Array<{ destroy: () => Promise<unknown> }> = []
afterEach(async () => {
  while (editors.length) await editors.pop()?.destroy()
})

describe('sanitizePastedHtml', () => {
  it('保留可转换为 Markdown 的结构与基础属性', () => {
    const result = sanitizePastedHtml(`
      <h2>标题</h2><ol start="3"><li><strong>粗体</strong>与<em>斜体</em></li></ol>
      <table><tbody><tr><td colspan="2">单元格</td></tr></tbody></table>
    `)
    expect(result).toContain('<h2>标题</h2>')
    expect(result).toContain('<ol start="3">')
    expect(result).toContain('<strong>粗体</strong>')
    expect(result).toContain('<td colspan="2">单元格</td>')
  })

  it('把办公软件常见的内联样式转成语义标签并移除样式', () => {
    const result = sanitizePastedHtml(
      '<span class="office" style="font-weight: 700; font-style: italic; color: red">文字</span>',
    )
    expect(result).toContain('<strong><em>文字</em></strong>')
    expect(result).not.toContain('style=')
    expect(result).not.toContain('class=')
  })

  it('删除可执行内容、事件属性、注释和危险链接', () => {
    const result = sanitizePastedHtml(`
      <!-- office metadata --><script>alert(1)</script><style>body{display:none}</style>
      <p onclick="alert(2)">正文 <a href="javascript:alert(3)" target="_blank">危险</a></p>
      <iframe src="https://example.com">替代文本也不保留</iframe>
    `)
    expect(result).toContain('<p>正文 <a>危险</a></p>')
    expect(result).not.toMatch(/script|style|iframe|onclick|javascript:/i)
  })

  it('只保留安全 URL，并拒绝会失效或可执行的图片来源', () => {
    const result = sanitizePastedHtml(`
      <a href="https://example.com/a">网页</a><a href="mailto:a@example.com">邮件</a>
      <img src="https://example.com/a.png" alt="图"><img src="data:image/svg+xml,x" alt="坏图">
    `)
    expect(result).toContain('href="https://example.com/a"')
    expect(result).toContain('href="mailto:a@example.com"')
    expect(result).toContain('src="https://example.com/a.png"')
    expect(result).toContain('坏图')
    expect(result).not.toContain('data:image')
  })

  it('保留任务列表复选框但移除其它表单控件', () => {
    const result = sanitizePastedHtml(
      '<input type="checkbox" checked onclick="x()"><input type="text" value="secret"><button>提交</button>',
    )
    expect(result).toBe('<input type="checkbox" disabled="" checked="">')
  })

  it('未知容器只展开内容，不把正文一起删掉', () => {
    expect(sanitizePastedHtml('<section><custom-box>可读正文</custom-box></section>')).toBe('可读正文')
  })

  it('真实编辑器已注册粘贴清洗钩子', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const editor = await createLightEditor({ root, defaultValue: '' }).create()
    editors.push({ destroy: () => editor.destroy() })

    const transformed = editor.action((ctx) => {
      let result = ''
      ctx.get(editorViewCtx).someProp('transformPastedHTML', (transform) => {
        result = transform('<p onclick="x()">正文<script>x()</script></p>', ctx.get(editorViewCtx))
        return true
      })
      return result
    })
    expect(transformed).toBe('<p>正文</p>')
  })
})

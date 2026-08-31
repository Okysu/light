// @vitest-environment jsdom
import { editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import { $remark } from '@milkdown/kit/utils'
import remarkDirective from 'remark-directive'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLightEditor } from './create-editor'

/**
 * 往返测试：markdown → 编辑器文档 → markdown。
 *
 * 这是「Markdown 文件即真源」最关键的安全网。用户打开一篇笔记、什么都不改就保存，
 * 文件内容不能被破坏；含未知语法的笔记也必须能打开（Milkdown 默认会抛错）。
 * 用真实的编辑器实例而非模拟对象，测的就是线上跑的那套插件组合。
 */

const editors: Array<{ destroy: () => Promise<unknown> }> = []

afterEach(async () => {
  while (editors.length > 0) await editors.pop()?.destroy()
})

async function roundTrip(markdown: string): Promise<string> {
  const root = document.createElement('div')
  document.body.append(root)

  const editor = await createLightEditor({ root, defaultValue: markdown }).create()
  editors.push({ destroy: () => editor.destroy() })

  return editor.action((ctx) => {
    const serializer = ctx.get(serializerCtx)
    return serializer(ctx.get(editorViewCtx).state.doc)
  })
}

/** 检视文档结构：语法到底是被建模成了 node/mark，还是掉进了兜底节点 */
async function inspect(markdown: string): Promise<{ nodes: string[]; marks: string[] }> {
  const root = document.createElement('div')
  document.body.append(root)

  const editor = await createLightEditor({ root, defaultValue: markdown }).create()
  editors.push({ destroy: () => editor.destroy() })

  return editor.action((ctx) => {
    const nodes = new Set<string>()
    const marks = new Set<string>()
    ctx.get(editorViewCtx).state.doc.descendants((node) => {
      nodes.add(node.type.name)
      node.marks.forEach((mark) => marks.add(mark.type.name))
      return true
    })
    return { nodes: [...nodes], marks: [...marks] }
  })
}

/** 二次往返必须收敛：首次可以规范化格式，之后不能再变 */
async function expectStable(markdown: string): Promise<string> {
  const once = await roundTrip(markdown)
  const twice = await roundTrip(once)
  expect(twice).toBe(once)
  return once
}

describe('已建模语法的往返', () => {
  const cases: Array<[string, string]> = [
    ['标题', '# 一级标题\n\n## 二级标题\n'],
    ['段落与强调', '这是**粗体**与*斜体*。\n'],
    ['删除线（GFM）', '这是~~删除线~~。\n'],
    ['行内代码', '调用 `foo()` 即可。\n'],
    ['链接', '见[文档](https://example.com)。\n'],
    ['图片', '![图示](a.png)\n'],
    ['无序列表', '- 甲\n- 乙\n'],
    ['有序列表', '1. 甲\n2. 乙\n'],
    ['引用块', '> 引用内容\n'],
    ['代码块', '```js\nconst a = 1\n```\n'],
    ['分割线', '---\n'],
    ['GFM 表格', '| 列一 | 列二 |\n| ---- | ---- |\n| a | b |\n'],
    ['任务列表', '- [x] 已完成\n- [ ] 未完成\n'],
    ['中文标点', '中文内容，包含标点。\n'],
    ['块级公式', '$$\nE = mc^2\n$$\n'],
    ['行内公式', '质能方程 $E=mc^2$ 很有名。\n'],
    ['文字高亮', '这是==重点内容==。\n'],
    ['音频', '<audio controls preload="metadata" src="attachments/demo.mp3"></audio>\n'],
    ['视频', '<video controls preload="metadata" src="attachments/demo.mp4"></video>\n'],
    ['内嵌看板', '<light-embed kind="board" src="项目.board"></light-embed>\n'],
    ['内嵌画板', '<light-embed kind="canvas" src="草图.canvas"></light-embed>\n'],
  ]

  for (const [name, markdown] of cases) {
    it(name, async () => {
      const output = await expectStable(markdown)
      expect(output.trim().length).toBeGreaterThan(0)
    })
  }

  it('表格内容不丢失', async () => {
    const output = await roundTrip('| 列一 | 列二 |\n| ---- | ---- |\n| a | b |\n')
    expect(output).toContain('列一')
    expect(output).toContain('列二')
    expect(output).toContain('a')
    expect(output).toContain('b')
  })

  it('任务列表的勾选状态保留', async () => {
    const output = await roundTrip('- [x] 已完成\n- [ ] 未完成\n')
    expect(output).toContain('[x]')
    expect(output).toContain('[ ]')
  })

  it('公式往返保持标准 LaTeX 语法（其它工具也能打开）', async () => {
    expect(await roundTrip('$$\nE = mc^2\n$$\n')).toContain('E = mc^2')
    expect(await roundTrip('质能方程 $E=mc^2$ 很有名。\n')).toContain('$E=mc^2$')
  })

  it('高亮往返保持 ==text== 可移植语法', async () => {
    expect(await roundTrip('这是==重点==。\n')).toContain('==重点==')
  })

  it('音视频往返保持标准 HTML 媒体标签', async () => {
    expect(await roundTrip('<audio controls src="attachments/a.mp3"></audio>\n')).toContain('<audio')
    expect(await roundTrip('<video controls src="attachments/v.mp4"></video>\n')).toContain('<video')
  })
})

/**
 * 光有「内容不丢 + 往返收敛」是不够的：被兜底节点吞掉的加粗同样满足这两条，
 * 却完全失去了富文本编辑能力。这组测试锁的是「语法真的被建模了」。
 */
describe('常用语法必须被真正建模，而非落入兜底', () => {
  const inlineCases: Array<[string, string, string]> = [
    ['加粗', '这是**粗体**。', 'strong'],
    ['斜体', '这是*斜体*。', 'emphasis'],
    ['行内代码', '调用 `foo()`。', 'inlineCode'],
    ['链接', '见[文档](https://example.com)。', 'link'],
    ['删除线', '这是~~删除~~。', 'strike_through'],
    ['高亮', '这是==重点==。', 'highlight'],
  ]

  for (const [name, markdown, expectedMark] of inlineCases) {
    it(`${name}被建模为 mark`, async () => {
      const { nodes, marks } = await inspect(markdown)
      expect(nodes).not.toContain('rawInline')
      expect(nodes).not.toContain('rawBlock')
      expect(marks).toContain(expectedMark)
    })
  }

  const blockCases: Array<[string, string, string]> = [
    ['标题', '# 标题', 'heading'],
    ['引用', '> 引用', 'blockquote'],
    ['代码块', '```js\na\n```', 'code_block'],
    ['无序列表', '- 甲', 'bullet_list'],
    ['有序列表', '1. 甲', 'ordered_list'],
    ['图片', '![图](a.png)', 'image'],
    ['表格', '| a | b |\n| - | - |\n| 1 | 2 |', 'table'],
    // 第 4 轮起公式从兜底节点「毕业」为真实节点
    ['块级公式', '$$\nE = mc^2\n$$', 'math_block'],
    ['音频', '<audio controls src="attachments/a.mp3"></audio>', 'media'],
    ['视频', '<video controls src="attachments/v.mp4"></video>', 'media'],
    ['内嵌看板', '<light-embed kind="board" src="项目.board"></light-embed>', 'document_embed'],
    ['内嵌画板', '<light-embed kind="canvas" src="草图.canvas"></light-embed>', 'document_embed'],
  ]

  for (const [name, markdown, expectedNode] of blockCases) {
    it(`${name}被建模为 node`, async () => {
      const { nodes } = await inspect(markdown)
      expect(nodes).toContain(expectedNode)
      expect(nodes).not.toContain('rawBlock')
      expect(nodes).not.toContain('rawInline')
    })
  }

  it('行内公式被建模为 math_inline', async () => {
    const { nodes } = await inspect('质能方程 $E=mc^2$ 很有名。')
    expect(nodes).toContain('math_inline')
    expect(nodes).not.toContain('rawInline')
  })

  it('纯中文段落不触发任何兜底', async () => {
    const { nodes } = await inspect('这是一段普通的中文正文。')
    expect(nodes).not.toContain('rawBlock')
    expect(nodes).not.toContain('rawInline')
  })
})

/**
 * 兜底节点的真实覆盖。
 *
 * preset 与其 remark 插件是配套的——凡能被解析出的节点类型都有对应 schema，
 * 因此**默认配置下兜底不会触发**（HTML → html 节点、脚注 → footnote_* 节点，
 * 公式自第 4 轮起也已毕业为 math_block / math_inline）。
 *
 * 兜底真正服务的是「remark 侧已认得、schema 侧还没跟上」的过渡期。
 * 公式当初正处于这一阶段；它毕业后，这里改挂 remark-directive 继续守住该分支，
 * 否则它就会退化成一段从未被执行、也就无从信任的代码。
 */
describe('兜底节点（remark 认得但 schema 未跟上时）', () => {
  async function inspectWithDirective(markdown: string) {
    const root = document.createElement('div')
    document.body.append(root)

    const editor = await createLightEditor({ root, defaultValue: markdown })
      .use($remark('probeDirective', () => remarkDirective))
      .create()
    editors.push({ destroy: () => editor.destroy() })

    return editor.action((ctx) => {
      const nodes = new Set<string>()
      ctx.get(editorViewCtx).state.doc.descendants((node) => {
        nodes.add(node.type.name)
        return true
      })
      return {
        nodes: [...nodes],
        markdown: ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
      }
    })
  }

  it('容器指令落入 rawBlock 而非让笔记崩溃', async () => {
    const { nodes, markdown } = await inspectWithDirective(':::note\n提示内容\n:::\n')
    expect(nodes).toContain('rawBlock')
    expect(markdown).toContain('提示内容')
  })

  it('行内指令落入 rawInline，且不破坏所在段落', async () => {
    const { nodes, markdown } = await inspectWithDirective('这是 :abbr[HTML] 缩写。\n')
    expect(nodes).toContain('rawInline')
    expect(nodes).toContain('paragraph')
    expect(markdown).toContain('HTML')
    expect(markdown).toContain('缩写')
  })

  it('兜底内容往返收敛', async () => {
    const first = await inspectWithDirective(':::warning\n注意\n:::\n')
    const second = await inspectWithDirective(first.markdown)
    expect(second.markdown).toBe(first.markdown)
  })

  it('同一文档中兜底与正常语法互不干扰', async () => {
    const { nodes, markdown } = await inspectWithDirective(
      '# 标题\n\n:::tip\n提示\n:::\n\n正文**粗体**。\n',
    )
    expect(nodes).toContain('heading')
    expect(nodes).toContain('rawBlock')
    expect(markdown).toContain('# 标题')
    expect(markdown).toContain('**粗体**')
  })
})

describe('未知语法必须能打开且原样保留', () => {
  it('内嵌 HTML 不让笔记崩溃', async () => {
    const html = '<div align="center">居中内容</div>\n'
    const output = await roundTrip(html)
    expect(output).toContain('居中内容')
    expect(output).toContain('align="center"')
  })

  it('脚注不丢失', async () => {
    const output = await roundTrip('正文[^1]\n\n[^1]: 脚注内容\n')
    expect(output).toContain('脚注内容')
  })

  it('未知语法与正常内容混排时，各自都完好', async () => {
    const mixed = '# 标题\n\n<custom-tag>自定义</custom-tag>\n\n正文**粗体**。\n'
    const output = await roundTrip(mixed)
    expect(output).toContain('# 标题')
    expect(output).toContain('自定义')
    expect(output).toContain('**粗体**')
  })

  it('含未知语法的文档二次往返同样收敛', async () => {
    await expectStable('# 标题\n\n<div>块</div>\n\n正文。\n')
  })
})

describe('编辑器可用性', () => {
  it('空文档不报错', async () => {
    expect(await roundTrip('')).toBeDefined()
  })

  // Light 的 Markdown listener 内置 200ms 防抖，回调不会在 dispatch 时同步触发。
  // 这也是编辑器 store 只需再加一层短防抖的原因（见 stores/editor.ts）。
  it('变更会通过 listener 回调抛出 markdown（防抖后）', async () => {
    const root = document.createElement('div')
    document.body.append(root)

    const updates: string[] = []
    const editor = await createLightEditor({
      root,
      defaultValue: '初始',
      onMarkdownUpdated: (markdown) => updates.push(markdown),
    }).create()
    editors.push({ destroy: () => editor.destroy() })

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText('追加', 1))
    })

    await vi.waitFor(() => expect(updates.length).toBeGreaterThan(0), { timeout: 2000 })
    expect(updates.at(-1)).toContain('追加')
  })
})

// @vitest-environment jsdom
import { editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createLightEditor } from './create-editor'
import { WIKILINK } from './extensions/wikilink'

/**
 * 双向链接在编辑器里的往返与建模。
 *
 * 单独成篇而不是并进 round-trip.test.ts，是因为这里要断言的不只是「文本没变」——
 * 上一次栽在兜底节点上的教训是：字节完全一致的往返，掩盖了「语法根本没被建模」。
 * 所以每个用例都同时检查文档结构。
 */

const editors: Array<{ destroy: () => Promise<unknown> }> = []

afterEach(async () => {
  while (editors.length > 0) await editors.pop()?.destroy()
})

async function open(markdown: string) {
  const root = document.createElement('div')
  document.body.append(root)

  const editor = await createLightEditor({ root, defaultValue: markdown }).create()
  editors.push({ destroy: () => editor.destroy() })

  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)

    const nodes: string[] = []
    const wikilinks: Array<{ url: string; hash: string; value: string }> = []
    view.state.doc.descendants((node) => {
      nodes.push(node.type.name)
      if (node.type.name === WIKILINK) {
        wikilinks.push({
          url: node.attrs['url'] as string,
          hash: node.attrs['hash'] as string,
          value: node.attrs['value'] as string,
        })
      }
      return true
    })

    return { nodes, wikilinks, output: ctx.get(serializerCtx)(view.state.doc) }
  })
}

describe('wikilink 被建模成真实节点', () => {
  it('简单链接', async () => {
    const result = await open('看 [[我的笔记]] 这篇。\n')
    expect(result.wikilinks).toEqual([{ url: '我的笔记', hash: '', value: '我的笔记' }])
  })

  it('带别名', async () => {
    const result = await open('看 [[a/b|别名]]。\n')
    expect(result.wikilinks).toEqual([{ url: 'a/b', hash: '', value: '别名' }])
  })

  it('带锚点', async () => {
    const result = await open('看 [[笔记#小节]]。\n')
    expect(result.wikilinks[0]).toMatchObject({ url: '笔记', hash: '小节' })
  })

  /**
   * 关键断言：不能掉进兜底节点。
   * 掉进去的话往返照样字节一致，但链接不可点击、不进索引、图谱里也看不到——
   * 而测试会一路绿灯。
   */
  it('不落入 rawInline 兜底', async () => {
    const result = await open('看 [[我的笔记]]。\n')
    expect(result.nodes).toContain(WIKILINK)
    expect(result.nodes).not.toContain('raw_inline')
  })

  it('同一段里的多个链接各自成节点', async () => {
    const result = await open('[[甲]] 与 [[乙]] 并列。\n')
    expect(result.wikilinks.map((link) => link.url)).toEqual(['甲', '乙'])
  })
})

describe('wikilink 往返', () => {
  const cases = [
    ['简单链接', '看 [[我的笔记]] 这篇。\n'],
    ['带路径', '看 [[文件夹/笔记]]。\n'],
    ['带别名', '看 [[a/b|别名]]。\n'],
    ['带锚点', '看 [[笔记#小节]]。\n'],
    ['锚点与别名', '看 [[笔记#小节|别名]]。\n'],
    ['一行多个', '[[甲]] 与 [[乙]]。\n'],
    ['与其它语法共存', '**粗体**里的 [[链接]] 和 `代码`。\n'],
  ] as const

  it.each(cases)('%s 原样往返', async (_name, markdown) => {
    expect((await open(markdown)).output).toBe(markdown)
  })

  it('二次往返收敛', async () => {
    const once = (await open('看 [[a/b|别名]] 和 [[丙#节]]。\n')).output
    expect((await open(once)).output).toBe(once)
  })
})

describe('不该被当成链接的写法', () => {
  it('行内代码里的 [[ ]] 保持原样', async () => {
    const result = await open('用 `[[语法]]` 表示链接。\n')
    expect(result.nodes).not.toContain(WIKILINK)
    expect(result.output).toBe('用 `[[语法]]` 表示链接。\n')
  })

  it('代码块里的 [[ ]] 保持原样', async () => {
    const source = '```\n[[假链接]]\n```\n'
    const result = await open(source)
    expect(result.nodes).not.toContain(WIKILINK)
    expect(result.output).toBe(source)
  })

  it('普通 Markdown 链接不受影响', async () => {
    const result = await open('见[文档](https://example.com)。\n')
    expect(result.nodes).not.toContain(WIKILINK)
  })
})

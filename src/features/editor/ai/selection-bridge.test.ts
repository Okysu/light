// @vitest-environment jsdom
import { editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createLightEditor } from '../create-editor'
import { createSelectionBridge } from './selection-bridge'

/**
 * 选区桥用**真实的编辑器实例**测，不是模拟对象。
 *
 * 这里要验的全是 ProseMirror 的位置语义——position 与字符数不是 1:1、
 * 块边界各占一个位置、插入可能被 schema 规整。这些正是模拟对象
 * 一定会答错的地方：一个假的 view 让所有断言都通过，然后线上丢内容。
 */

const editors: Array<{ destroy: () => void }> = []

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy()
})

async function setup(markdown: string): Promise<{ ctx: Ctx; markdown: () => string }> {
  const root = document.createElement('div')
  document.body.append(root)

  const editor = await createLightEditor({ root, defaultValue: markdown }).create()
  editors.push({ destroy: () => void editor.destroy() })

  let captured: Ctx | null = null
  editor.action((ctx) => {
    captured = ctx
  })
  const ctx = captured as unknown as Ctx

  return {
    ctx,
    markdown: () => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
  }
}

/** 选中第 index 个顶层块的全部内容 */
function selectBlock(ctx: Ctx, index: number): void {
  const view = ctx.get(editorViewCtx)
  const { doc } = view.state

  let position = 0
  for (let i = 0; i < index; i += 1) position += doc.child(i).nodeSize

  const node = doc.child(index)
  const from = position + 1
  const to = position + node.nodeSize - 1
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, from, to)))
}

/** 把光标放在第 index 个块的末尾 */
function cursorAtEndOf(ctx: Ctx, index: number): void {
  const view = ctx.get(editorViewCtx)
  const { doc } = view.state

  let position = 0
  for (let i = 0; i <= index; i += 1) position += doc.child(i).nodeSize

  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, position - 1)))
}

const SOURCE = '# 标题\n\n第一段原文。\n\n第二段不该被动。\n'

describe('selection（读取选区）', () => {
  it('读到的是 Markdown 源码而不是纯文本', async () => {
    const { ctx } = await setup('# 标题\n\n带**加粗**和`代码`的段落。\n')
    selectBlock(ctx, 1)

    const bridge = createSelectionBridge(() => ctx)

    expect(bridge.selection()).toBe('带**加粗**和`代码`的段落。')
  })

  it('没有选中时返回空串', async () => {
    const { ctx } = await setup(SOURCE)
    cursorAtEndOf(ctx, 1)

    expect(createSelectionBridge(() => ctx).selection()).toBe('')
  })
})

describe('replace / insertAfter（一次性写入）', () => {
  it('替换选区，其余内容不动', async () => {
    const { ctx, markdown } = await setup(SOURCE)
    selectBlock(ctx, 1)

    createSelectionBridge(() => ctx).replace('换过的内容。')

    expect(markdown()).toContain('换过的内容。')
    expect(markdown()).not.toContain('第一段原文')
    expect(markdown()).toContain('第二段不该被动')
  })

  it('写入的 Markdown 结构会被真正解析成节点', async () => {
    const { ctx, markdown } = await setup(SOURCE)
    selectBlock(ctx, 1)

    createSelectionBridge(() => ctx).replace('## 小标题\n\n带**加粗**的段落。')

    const result = markdown()
    expect(result).toContain('## 小标题')
    expect(result).toContain('**加粗**')
  })
})

describe('beginStream（流式写入）', () => {
  /**
   * 这是本文件最重要的一条。
   *
   * 曾经的写法是 `end += text.length` 手算偏移。ProseMirror 的 position
   * 与字符数不是 1:1，偏移会越漂越远，表现是「只有第一段进了正文，
   * 后面的内容凭空消失」——而流式过程中界面看着是正常的，
   * 直到 commit 那一刻才丢。
   */
  it('多段推送后，全部内容都在，且被解析成正确的结构', async () => {
    const { ctx, markdown } = await setup(SOURCE)
    selectBlock(ctx, 1)

    const stream = createSelectionBridge(() => ctx).beginStream('replace')
    for (const part of ['## 结论\n\n', '这里有**加粗**与', '`代码`：\n\n', '- 第一点\n', '- 第二点\n']) {
      stream.push(part)
    }
    stream.commit()

    const result = markdown()
    expect(result).toContain('## 结论')
    expect(result).toContain('**加粗**')
    expect(result).toContain('`代码`')
    expect(result).toContain('第一点')
    expect(result).toContain('第二点')
  })

  it('只替换选中的那一段，前后内容不受影响', async () => {
    const { ctx, markdown } = await setup(SOURCE)
    selectBlock(ctx, 1)

    const stream = createSelectionBridge(() => ctx).beginStream('replace')
    stream.push('新的第一段。')
    stream.commit()

    const result = markdown()
    expect(result).toContain('# 标题')
    expect(result).toContain('新的第一段。')
    expect(result).not.toContain('第一段原文')
    expect(result).toContain('第二段不该被动')
  })

  it('after 模式插在选区之后，不吃掉原文', async () => {
    const { ctx, markdown } = await setup(SOURCE)
    selectBlock(ctx, 1)

    const stream = createSelectionBridge(() => ctx).beginStream('after')
    stream.push('续写的内容。')
    stream.commit()

    const result = markdown()
    expect(result).toContain('第一段原文')
    expect(result).toContain('续写的内容。')
  })

  it('commit 之前内容就已经出现在正文里——用户看得到字在长', async () => {
    const { ctx, markdown } = await setup(SOURCE)
    selectBlock(ctx, 1)

    const stream = createSelectionBridge(() => ctx).beginStream('replace')
    stream.push('已经能看到的内容')
    // 落笔按帧节流，等一帧
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))

    expect(markdown()).toContain('已经能看到的内容')
  })

  it('中途每一次刷新都是完整解析的结构，不是裸文本', async () => {
    // 追加裸文本会被编辑器就地整形成标题/列表，之后按区间替换必然踩进
    // ProseMirror 的 fitting，放不下的块被静默丢弃
    const { ctx, markdown } = await setup(SOURCE)
    selectBlock(ctx, 1)

    const stream = createSelectionBridge(() => ctx).beginStream('replace')
    stream.push('## 中途标题\n\n')
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    expect(markdown()).toContain('## 中途标题')

    stream.push('- 后来的列表项\n')
    stream.commit()

    const result = markdown()
    expect(result).toContain('## 中途标题')
    expect(result).toContain('后来的列表项')
  })

  it('cancel 撤掉全部已写入的内容，原文回来', async () => {
    const { ctx, markdown } = await setup(SOURCE)
    selectBlock(ctx, 1)

    const stream = createSelectionBridge(() => ctx).beginStream('replace')
    stream.push('写了一半')
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    stream.push('就被取消了')
    stream.cancel()

    const result = markdown()
    expect(result).not.toContain('写了一半')
    expect(result).not.toContain('就被取消了')
  })

  it('一次都没推送就 commit 不做任何改动', async () => {
    const { ctx, markdown } = await setup(SOURCE)
    const before = markdown()
    selectBlock(ctx, 1)

    const stream = createSelectionBridge(() => ctx).beginStream('replace')
    stream.commit()

    expect(markdown()).toBe(before)
  })

  it('空字符串的推送被忽略，不会打乱位置', async () => {
    const { ctx, markdown } = await setup(SOURCE)
    selectBlock(ctx, 1)

    const stream = createSelectionBridge(() => ctx).beginStream('replace')
    stream.push('')
    stream.push('有内容')
    stream.push('')
    stream.push('的推送')
    stream.commit()

    expect(markdown()).toContain('有内容的推送')
  })

  it('编辑器不可用时各方法都是空操作，不抛错', () => {
    const stream = createSelectionBridge(() => null).beginStream('replace')

    expect(() => {
      stream.push('x')
      stream.commit()
      stream.cancel()
    }).not.toThrow()
  })
})

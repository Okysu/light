import { remarkCtx } from '@milkdown/kit/core'
import type { MarkdownNode } from '@milkdown/kit/transformer'
import { $node } from '@milkdown/kit/utils'
import type { Ctx } from '@milkdown/kit/ctx'

/**
 * 未知语法兜底节点。
 *
 * Milkdown 的 parser 在找不到匹配的 schema 时会直接 `throw parserMatchError`——
 * 也就是说，一篇含有它不认识的语法（Obsidian 插件语法、自定义容器、脚注等）的笔记
 * 会**整篇打不开**。对「Markdown 文件即真源」的产品，这是不可接受的失败模式：
 * 用户的文件是别的工具也在写的，我们无权要求它只包含我们认识的语法。
 *
 * 兜底策略：把未知的 mdast 节点原样收进 `value` 属性，只读展示，序列化时逐字写回。
 * 依赖 Milkdown 的匹配顺序——parser 取 `Object.values(schema.nodes)` 中第一个 match 的 spec，
 * 因此本节点必须在 commonmark / gfm 等所有 preset **之后**注册，才能作为最后的 fallback。
 *
 * 何时真正生效：commonmark + gfm 与它们的 remark 插件是配套的，凡能解析出的节点都有 schema，
 * 所以当前配置下这里其实不会被命中。它服务的是「remark 侧已认得、schema 侧还没跟上」的
 * 过渡期——接入公式、双向链接、自定义容器时都会经历。round-trip.test.ts 里用一个
 * 临时挂载的 remark-math 精确复现了该状态，确保这条分支不是没跑过的死代码。
 */

/**
 * mdast 中的内联节点类型。未知节点若属于其中则用 rawInline（可放在段落里），
 * 否则按块级处理。判断错误的后果不对称：把块级误判为内联会破坏 schema，
 * 而把内联误判为块级只是显示位置不佳，因此默认偏向块级。
 */
const INLINE_TYPES = new Set([
  'text',
  'emphasis',
  'strong',
  'delete',
  'inlineCode',
  'break',
  'link',
  'image',
  'linkReference',
  'imageReference',
  'footnoteReference',
  'inlineMath',
  'textDirective',
  'highlight',
])

/**
 * 由 preset 以 **mark** 形式建模的内联语法，兜底节点必须显式避让。
 *
 * 原因是 Milkdown 的查找顺序：`Object.values({ ...schema.nodes, ...schema.marks })`——
 * 所有 node 永远排在所有 mark 之前。因此「注册在最后」只能让本节点避开其它 *node*，
 * 对 *mark* 无效：不加这层排除，rawInline 会抢在 strong / emphasis 之前把加粗、
 * 斜体、行内代码、链接全部吞成原始文本（内容不丢，但完全失去富文本编辑能力）。
 *
 * 新增 mark 类插件（如高亮、下划线）时，必须同步在此登记。
 * 新增 node 类插件（如 inlineMath）则不必——node 之间按注册顺序，preset 天然在前。
 */
const MODELED_AS_MARK = new Set(['emphasis', 'strong', 'delete', 'inlineCode', 'link', 'highlight'])

const RAW_BLOCK_ID = 'rawBlock'
const RAW_INLINE_ID = 'rawInline'

/** 把任意 mdast 节点还原成 Markdown 源文本 */
function toSource(ctx: Ctx, node: MarkdownNode, inline: boolean): string {
  const remark = ctx.get(remarkCtx)
  const tree = inline
    ? { type: 'root', children: [{ type: 'paragraph', children: [node] }] }
    : { type: 'root', children: [node] }
  // @ts-expect-error remark 的 Root 类型与 MarkdownNode 结构一致，此处为已知的类型缝隙
  return remark.stringify(tree).trimEnd()
}

function isInline(node: MarkdownNode): boolean {
  return INLINE_TYPES.has(node.type)
}

export const rawBlockSchema = $node(RAW_BLOCK_ID, (ctx) => ({
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,
  attrs: { value: { default: '' } },

  parseDOM: [
    {
      tag: 'div[data-raw-block]',
      getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute('data-value') ?? '' }),
    },
  ],

  toDOM: (node) => [
    'div',
    {
      'data-raw-block': '',
      'data-value': node.attrs['value'],
      class: 'light-raw-block',
      title: '此段使用了编辑器尚未支持的 Markdown 语法，保存时会原样保留',
    },
    node.attrs['value'] as string,
  ],

  parseMarkdown: {
    // 注册在所有 preset 之后，走到这里即说明无人认领
    match: (node) => !isInline(node),
    runner: (state, node, type) => {
      state.addNode(type, { value: toSource(ctx, node, false) })
    },
  },

  toMarkdown: {
    match: (node) => node.type.name === RAW_BLOCK_ID,
    runner: (state, node) => {
      // 借 mdast 的 html 节点直通输出：remark 对它原样吐字符串，
      // 不会重新解析再格式化，手写的表格对齐等排版得以字节级保留
      state.addNode('html', undefined, node.attrs['value'] as string)
    },
  },
}))

export const rawInlineSchema = $node(RAW_INLINE_ID, (ctx) => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: { value: { default: '' } },

  parseDOM: [
    {
      tag: 'span[data-raw-inline]',
      getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute('data-value') ?? '' }),
    },
  ],

  toDOM: (node) => [
    'span',
    {
      'data-raw-inline': '',
      'data-value': node.attrs['value'],
      class: 'light-raw-inline',
      title: '此处使用了编辑器尚未支持的 Markdown 语法，保存时会原样保留',
    },
    node.attrs['value'] as string,
  ],

  parseMarkdown: {
    // 只兜底「内联的、且没有任何 preset 建模」的语法
    match: (node) => isInline(node) && !MODELED_AS_MARK.has(node.type),
    runner: (state, node, type) => {
      state.addNode(type, { value: toSource(ctx, node, true) })
    },
  },

  toMarkdown: {
    match: (node) => node.type.name === RAW_INLINE_ID,
    runner: (state, node) => {
      state.addNode('html', undefined, node.attrs['value'] as string)
    },
  },
}))

/** 兜底插件集合。务必置于所有 preset 之后注册。 */
export const rawFallback = [rawBlockSchema, rawInlineSchema].flat()

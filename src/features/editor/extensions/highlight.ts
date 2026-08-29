import type { RemarkPluginRaw } from '@milkdown/kit/transformer'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { $inputRule, $markSchema, $remark } from '@milkdown/kit/utils'
import { SKIP, visit } from 'unist-util-visit'

/** Obsidian/MarkText 通用的 `==高亮==` 语法。 */
export const HIGHLIGHT = 'highlight'

interface HighlightNode {
  type: typeof HIGHLIGHT
  children: Array<{ type: 'text'; value: string }>
}

/**
 * remark 本身没有高亮扩展。只拆普通 text 节点，因此不会误伤行内代码、链接地址
 * 或 HTML；转义过的 `\==` 也保持普通文本。
 */
function splitHighlights(value: string): Array<{ type: string; value?: string; children?: HighlightNode['children'] }> | null {
  const parts: Array<{ type: string; value?: string; children?: HighlightNode['children'] }> = []
  const expression = /(^|[^\\])==(\S(?:.*?\S)?)==/g
  let cursor = 0
  let found = false
  let match: RegExpExecArray | null

  while ((match = expression.exec(value))) {
    const prefixLength = match[1]?.length ?? 0
    const start = match.index + prefixLength
    const content = match[2] ?? ''
    if (!content) continue

    if (start > cursor) parts.push({ type: 'text', value: value.slice(cursor, start) })
    parts.push({ type: HIGHLIGHT, children: [{ type: 'text', value: content }] })
    cursor = start + content.length + 4
    found = true
  }

  if (!found) return null
  if (cursor < value.length) parts.push({ type: 'text', value: value.slice(cursor) })
  return parts
}

const remarkHighlight: RemarkPluginRaw<never> = function () {
  const data = this.data()

  ;(data.toMarkdownExtensions ??= []).push({
    handlers: {
      highlight: (node: HighlightNode, _parent: unknown, state: { containerPhrasing: (node: unknown, info: unknown) => string }, info: unknown) =>
        `==${state.containerPhrasing(node, info)}==`,
    },
  } as never)

  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (index === undefined || !parent || typeof node.value !== 'string') return
      const parts = splitHighlights(node.value)
      if (!parts) return
      parent.children.splice(index, 1, ...parts as typeof parent.children)
      return [SKIP, index + parts.length]
    })
  }
}

export const remarkHighlightPlugin = $remark('remarkHighlight', () => remarkHighlight)

export const highlightSchema = $markSchema(HIGHLIGHT, () => ({
  parseDOM: [{ tag: 'mark' }, { tag: 'span[data-highlight]' }],
  toDOM: () => ['mark', { 'data-highlight': '', class: 'light-highlight' }, 0],

  parseMarkdown: {
    match: (node) => node.type === HIGHLIGHT,
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    },
  },

  toMarkdown: {
    match: (mark) => mark.type.name === HIGHLIGHT,
    runner: (state, mark) => {
      state.withMark(mark, HIGHLIGHT)
    },
  },
}))

/** 键入第二个等号时立即转成高亮，保留正则为避免行首误判而捕获的前置字符。 */
export const highlightInputRule = $inputRule((ctx) =>
  new InputRule(/(?:^|[^=])==(\S(?:.*?\S)?)==$/, (state, match, start, end) => {
    const full = match[0] ?? ''
    const content = match[1] ?? ''
    if (!content) return null
    const markerStart = start + full.length - content.length - 4
    return state.tr
      .delete(markerStart, end)
      .insertText(content, markerStart)
      .addMark(markerStart, markerStart + content.length, highlightSchema.type(ctx).create())
  }),
)

export const highlight = [remarkHighlightPlugin, highlightSchema, highlightInputRule].flat()

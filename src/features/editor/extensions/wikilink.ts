import type { RemarkPluginRaw } from '@milkdown/kit/transformer'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { $inputRule, $nodeSchema, $remark } from '@milkdown/kit/utils'
import { ofmWikilinkFromMarkdown, ofmWikilinkToMarkdown } from '@moritzrs/mdast-util-ofm-wikilink'
import { ofmWikilink } from '@moritzrs/micromark-extension-ofm-wikilink'

/**
 * 双向链接 `[[目标]]`（需求 2.3）。
 *
 * 语法与解析都用 Obsidian Flavored Markdown 的上游实现：
 * `micromark-extension-ofm-wikilink` 负责语法层，`mdast-util-ofm-wikilink` 负责
 * mdast 的读写。我们只做 mdast ↔ ProseMirror 这一段，也就是 Milkdown 本来就要求
 * 使用方提供的那部分。
 *
 * 换过一次实现：先试的 `@portaljs/remark-wiki-link` 在 micromark 4 下会直接抛
 * 「expected code to not have been consumed」——它的 tokenizer 停留在 micromark 2
 * 的契约上；而且它在包顶层 `import fs from 'fs'`，浏览器构建也不干净。
 *
 * 文件里始终是标准的 `[[...]]` 写法，Obsidian 可以直接打开同一个 Vault（需求 10.1）。
 */

export const WIKILINK = 'wikilink'

/**
 * 把三个 extension 注册进 unified —— remark 插件的标准样板。
 * 写成 function 而非箭头函数：unified 通过 `this` 把 processor 传进来。
 */
const remarkWikilink: RemarkPluginRaw<never> = function () {
  const data = this.data()

  ;(data.micromarkExtensions ??= []).push(ofmWikilink())
  ;(data.fromMarkdownExtensions ??= []).push(ofmWikilinkFromMarkdown())
  ;(data.toMarkdownExtensions ??= []).push(ofmWikilinkToMarkdown())
}

export const remarkWikilinkPlugin = $remark('remarkWikilink', () => remarkWikilink)

/**
 * 链接节点。
 *
 * `atom: true`：整个链接作为一个不可分割的单元，光标不会走进它内部。
 * 允许编辑内部文本的话，改到一半的 `[[我的笔` 会立刻变成指向别处的链接，
 * 每敲一个字都触发一次索引变化——不如整体替换来得清楚。
 */
export const wikilinkSchema = $nodeSchema(WIKILINK, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: {
    /** 链接目标，`[[ ]]` 里 `|` 之前、`#` 之前的部分 */
    url: { default: '' },
    /** 段内锚点，可为空 */
    hash: { default: '' },
    /** 显示文本：有别名用别名，否则等于 url */
    value: { default: '' },
  },

  parseDOM: [
    {
      tag: 'a[data-wikilink]',
      getAttrs: (dom) => {
        const element = dom as HTMLElement
        return {
          url: element.dataset['url'] ?? '',
          hash: element.dataset['hash'] ?? '',
          value: element.textContent ?? '',
        }
      },
    },
  ],

  toDOM: (node) => {
    const dom = document.createElement('a')
    const url = node.attrs['url'] as string
    const hash = node.attrs['hash'] as string

    dom.dataset['wikilink'] = ''
    dom.dataset['url'] = url
    if (hash) dom.dataset['hash'] = hash
    dom.className = 'light-wikilink'
    // 真正的跳转由编辑器容器上的委托处理器负责（见 MarkdownEditor.vue）：
    // NodeView 里挂 listener 会在每次重渲染时重复绑定
    dom.textContent = (node.attrs['value'] as string) || url
    dom.title = hash ? `${url} → ${hash}` : url

    return dom
  },

  parseMarkdown: {
    match: (node) => node.type === 'ofmWikilink',
    runner: (state, node, type) => {
      state.addNode(type, {
        url: (node['url'] as string) ?? '',
        hash: (node['hash'] as string) ?? '',
        value: (node['value'] as string) ?? '',
      })
    },
  },

  toMarkdown: {
    match: (node) => node.type.name === WIKILINK,
    runner: (state, node) => {
      state.addNode('ofmWikilink', undefined, undefined, {
        url: node.attrs['url'],
        hash: node.attrs['hash'],
        value: node.attrs['value'],
      })
    },
  },
}))

/**
 * 输入 `[[目标]]` 立即成为链接。
 *
 * 只在敲下第二个 `]` 时触发：过早转换会让用户还没打完就被打断，
 * 而 `[[` 本身在正常写作中也可能只是两个括号。
 */
export const wikilinkInputRule = $inputRule((ctx) => {
  return new InputRule(/\[\[([^[\]|#]+)(?:#([^[\]|]+))?(?:\|([^[\]]+))?\]\]$/, (state, match, start, end) => {
    const [, url = '', hash = '', alias = ''] = match
    if (!url.trim()) return null

    const type = wikilinkSchema.type(ctx)
    return state.tr.replaceWith(
      start,
      end,
      type.create({ url: url.trim(), hash: hash.trim(), value: (alias || url).trim() }),
    )
  })
})

export const wikilink = [remarkWikilinkPlugin, wikilinkSchema, wikilinkInputRule].flat()

import { ofmWikilinkFromMarkdown } from '@moritzrs/mdast-util-ofm-wikilink'
import { ofmWikilink } from '@moritzrs/micromark-extension-ofm-wikilink'
import type { Root } from 'mdast'
import type { Plugin } from 'unified'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { resolveSiteHref, type SiteModel, type SitePage } from './site-model'

/**
 * Markdown → HTML（需求 10.2 的静态站点导出）。
 *
 * 这一层只在**导出时**才会用到，因此整个模块由 store 动态 import——
 * unified 一整条管线加上 katex 有几百 KB，不该压在首屏上。
 *
 * 语法扩展与编辑器保持同一套（gfm / math / wikilink），否则会出现
 * 「编辑器里好好的表格，导出成站点就散了」这类只有发布后才发现的偏差。
 */

/** wikilink 在 mdast 里的形状，来自 `mdast-util-ofm-wikilink` */
interface WikilinkNode {
  type: 'ofmWikilink'
  url: string
  hash: string
  value: string
  data?: Record<string, unknown>
}

/**
 * 把 wikilink 节点改写成站内链接。
 *
 * 目标笔记不在导出范围内时降级成纯文本而不是死链——
 * 一个点了没反应的链接，比一段普通文字更让读者困惑。
 */
function rewriteWikilinks(model: SiteModel, source: string) {
  return () => (tree: Root): void => {
    visit(tree, 'ofmWikilink' as never, (node: unknown) => {
      const link = node as WikilinkNode
      const href = resolveSiteHref(link.url, source, model)
      const text = link.value || link.url

      // mdast-util-to-hast 认 data.hName/hProperties/hChildren，
      // 借它把自定义节点直接映射成想要的 HTML，不必自己写 handler
      link.data = href
        ? {
            hName: 'a',
            hProperties: { href: href + (link.hash ? `#${slugify(link.hash)}` : ''), class: 'wikilink' },
            hChildren: [{ type: 'text', value: text }],
          }
        : {
            hName: 'span',
            hProperties: { class: 'wikilink wikilink-missing', title: `尚未创建：${link.url}` },
            hChildren: [{ type: 'text', value: text }],
          }
    })
  }
}

/**
 * 让 micromark / mdast 扩展进入 unified 管线，与编辑器同一套实现。
 * 写成 function 而非箭头函数：unified 通过 `this` 把 processor 传进来。
 */
const remarkWikilink: Plugin<[], Root> = function () {
  const data = this.data()
  ;(data.micromarkExtensions ??= []).push(ofmWikilink())
  ;(data.fromMarkdownExtensions ??= []).push(ofmWikilinkFromMarkdown())
}

/** 标题锚点：与常见静态站点生成器一致的简易 slug */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
}

export async function renderPage(page: SitePage, model: SiteModel): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkWikilink)
    .use(rewriteWikilinks(model, page.source))
    // allowDangerousHtml：Markdown 里的原始 HTML 是用户自己写进笔记的内容，
    // 导出他自己的库时把它剥掉反而是意外行为
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(page.body)

  return String(file)
}

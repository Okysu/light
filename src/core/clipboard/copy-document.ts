import type { Root } from 'mdast'
import type { Plugin } from 'unified'
import { parseDocument, readString } from '../markdown/frontmatter'
import { stem } from '../path'

/**
 * 复制笔记为 Markdown 源码或富文本（需求 2.8）。
 *
 * 两种形态对应两种真实场景：
 * - **Markdown 源码**：贴进 GitHub issue、另一个 Markdown 编辑器、代码评审。
 * - **富文本**：贴进邮件、飞书、Word——那些地方不认 Markdown，
 *   贴过去的 `## 标题` 会原样显示成井号。
 *
 * 富文本走剪贴板的 `text/html`，同时**必须**附上 `text/plain` 兜底：
 * 只给 HTML 的话，粘进纯文本输入框会得到一片空白。
 */

/**
 * 取出可复制的 Markdown 正文。
 *
 * frontmatter 被剥掉，标题补成一级标题。理由：frontmatter 是 Light 与 Obsidian
 * 之间的约定，贴进聊天窗口只会是三行看不懂的 `---`；而标题存在 frontmatter 里，
 * 不补回去的话复制出来的内容会没有题目。
 */
export function documentMarkdown(raw: string, path: string): string {
  const { data, content } = parseDocument(raw)
  const body = content.trim()
  const title = readString(data, 'title') ?? stem(path)

  // 正文自己已经以一级标题开头时不再补，否则会出现两个标题
  if (!title || /^#\s/.test(body)) return body
  return `# ${title}\n\n${body}`
}

/**
 * Markdown → HTML。
 *
 * 与静态站点导出共用同一条 unified 管线（gfm / math），只在 wikilink 上不同：
 * 站点里 wikilink 是站内链接，而复制出去的内容离开了 Light，
 * 链接指向的笔记在对方那里根本不存在——降级成纯文本才是诚实的。
 *
 * 动态 import：unified + katex 有几百 KB，不该为一个偶尔用到的
 * 「复制为富文本」压在首屏上。
 */
export interface HtmlOptions {
  /**
   * 是否信任 Markdown 里的原始 HTML。
   *
   * 复制用户自己的笔记时是 true——那些 HTML 是他亲手写进去的，剥掉反而意外。
   * 渲染**模型输出**时必须是 false：那不是用户写的，可能含 `<script>` 或
   * `<img onerror>`，而结果要进 `v-html`。
   */
  trusted?: boolean
}

export async function documentHtml(markdown: string, options: HtmlOptions = {}): Promise<string> {
  const trusted = options.trusted ?? true
  const [
    { unified },
    { default: remarkParse },
    { default: remarkGfm },
    { default: remarkMath },
    { default: remarkRehype },
    { default: rehypeKatex },
    { default: rehypeStringify },
    { ofmWikilink },
    { ofmWikilinkFromMarkdown },
    { visit },
    { default: rehypeSanitize },
  ] = await Promise.all([
    import('unified'),
    import('remark-parse'),
    import('remark-gfm'),
    import('remark-math'),
    import('remark-rehype'),
    import('rehype-katex'),
    import('rehype-stringify'),
    import('@moritzrs/micromark-extension-ofm-wikilink'),
    import('@moritzrs/mdast-util-ofm-wikilink'),
    import('unist-util-visit'),
    import('rehype-sanitize'),
  ])

  // 先建管线再按需接 sanitize：`.use(...(cond ? [] : [plugin]))` 的展开
  // 在类型层面无法收敛，而 unified 的 processor 本来就是可以逐段追加的
  let processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(function () {
      const data = this.data()
      ;(data.micromarkExtensions ??= []).push(ofmWikilink())
      ;(data.fromMarkdownExtensions ??= []).push(ofmWikilinkFromMarkdown())
    })
    .use(function () {
      return (tree: Root): void => {
        visit(tree, 'ofmWikilink' as never, (node: unknown) => {
          const link = node as { url: string; value: string; data?: Record<string, unknown> }
          link.data = { hName: 'span', hChildren: [{ type: 'text', value: link.value || link.url }] }
        })
      }
    } as Plugin<[], Root>)
    .use(remarkRehype, { allowDangerousHtml: trusted })

  // 顺序要紧：sanitize 必须在 katex **之前**。反过来的话，
  // KaTeX 生成的那一大堆 <span>/<math> 会被白名单当成可疑内容剥掉，
  // 公式就变成一堆裸文本
  if (!trusted) processor = processor.use(rehypeSanitize)

  const file = await processor
    .use(rehypeKatex)
    .use(rehypeStringify, { allowDangerousHtml: trusted })
    .process(markdown)

  return String(file)
}

/**
 * 写入剪贴板。
 *
 * `ClipboardItem` 不是所有环境都有（旧浏览器、非安全上下文），
 * 因此退回 `writeText`——贴过去是 Markdown 源码，虽不是富文本，
 * 但总好过一个「复制失败」的提示。
 */
export async function writeToClipboard(text: string, html?: string): Promise<void> {
  if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      return
    } catch {
      // 权限被拒或格式不受支持时继续往下走纯文本
    }
  }

  await navigator.clipboard.writeText(text)
}

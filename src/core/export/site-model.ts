import { parseDocument } from '../markdown/frontmatter'
import { resolveWikilink } from '../links/wikilink'
import { splitTitle } from '../markdown/title'

/**
 * 静态站点的**数据模型**（需求 10.2）。
 *
 * 与渲染分开：这里只决定「有哪些页面、各自的标题与链接目标是什么、
 * 站内路径怎么排」，不碰 HTML 也不碰 unified。
 *
 * 这么切是因为这一层的规则才是容易出错的部分——路径映射要与链接解析一致，
 * 否则导出的站点里点链接会 404，而那要等站点发布出去才会被发现。
 */

export interface SitePage {
  /** 源笔记在工作区中的路径 */
  source: string
  /** 站点内的相对路径，例如 `项目/计划.html` */
  href: string
  title: string
  /** 去掉首个 H1 的正文——标题由模板渲染，留着会重复 */
  body: string
}

export interface SiteModel {
  pages: SitePage[]
  /** 源路径 → 站内路径，渲染 wikilink 时据此改写 */
  hrefBySource: Map<string, string>
}

export interface SiteSource {
  path: string
  /** 文件原始内容，含 frontmatter */
  raw: string
}

/**
 * 把笔记路径映射成站内 HTML 路径。
 *
 * 保留目录结构而不是拍平成一层：拍平会让同名笔记撞车，而且用户看到的
 * 站点结构应当和他自己的目录结构一致。
 */
export function siteHrefFor(path: string): string {
  return path.replace(/\.md$/i, '.html')
}

export function buildSiteModel(sources: readonly SiteSource[]): SiteModel {
  const pages: SitePage[] = []
  const hrefBySource = new Map<string, string>()

  for (const source of sources) {
    const { data, content } = parseDocument(source.raw)
    const { title, body } = splitTitle(content)

    const href = siteHrefFor(source.path)
    hrefBySource.set(source.path, href)

    pages.push({
      source: source.path,
      href,
      // 标题优先取正文的 H1，其次 frontmatter，最后退回文件名——
      // 三者都可能缺，而页面总得有个标题
      title: title || readTitle(data) || fileStem(source.path),
      body,
    })
  }

  return { pages, hrefBySource }
}

/**
 * 把 wikilink 的目标解析成站内链接。
 *
 * 必须复用 `resolveWikilink`：站点里的链接解析规则要和应用内**完全一致**，
 * 各写一份的话，同一个 `[[笔记]]` 在应用里跳到 A、在导出的站点里跳到 B。
 *
 * @returns 站内相对路径；目标笔记不存在时返回 null（渲染成纯文本而不是死链）
 */
export function resolveSiteHref(
  target: string,
  fromSource: string,
  model: SiteModel,
): string | null {
  const resolved = resolveWikilink(target, [...model.hrefBySource.keys()])
  if (resolved === null) return null

  const href = model.hrefBySource.get(resolved)
  if (!href) return null

  return relativeHref(siteHrefFor(fromSource), href)
}

/**
 * 算出从一个页面到另一个页面的相对路径。
 *
 * 用相对路径而不是绝对路径：导出的站点可能被放在域名的子目录下
 * （GitHub Pages 就是这样），绝对路径一到那种环境就全断。
 */
export function relativeHref(from: string, to: string): string {
  const fromParts = from.split('/').slice(0, -1)
  const toParts = to.split('/')
  const file = toParts.pop()!

  let common = 0
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common += 1
  }

  const up = Array.from({ length: fromParts.length - common }, () => '..')
  const down = toParts.slice(common)
  const segments = [...up, ...down, file]

  // 同目录下的兄弟页面会得到空前缀，补上 `./` 才是合法的相对链接
  return segments.length === 1 ? `./${segments[0]}` : segments.join('/')
}

function readTitle(data: Record<string, unknown>): string {
  const value = data['title']
  return typeof value === 'string' ? value : ''
}

function fileStem(path: string): string {
  const at = path.lastIndexOf('/')
  return (at === -1 ? path : path.slice(at + 1)).replace(/\.md$/i, '')
}

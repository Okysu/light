/**
 * 文档标题与正文的分离。
 *
 * 编辑器界面上标题是独立的一层（标题 → 属性 → 正文），但文件里它仍然是
 * 正文开头的那个 `# 一级标题`——这样文件依旧是标准 Markdown，
 * 在 Obsidian、GitHub 里打开都是正常的一篇文章，不会因为 Light 的界面分层
 * 而变成只有 Light 认得的格式。
 *
 * 因此分离只发生在「读入编辑器」与「写回磁盘」两个边界上。
 */

export interface SplitDocument {
  /** 首个一级标题的文本；文档没有以 H1 开头时为 null */
  title: string | null
  /** 去掉首个 H1 后的正文 */
  body: string
}

/** 只认 ATX 形式的一级标题，且必须是文档的第一个非空块 */
const LEADING_H1 = /^[\s\n]*#[ \t]+(.*?)[ \t]*#*[ \t]*(?:\r?\n|$)/

export function splitTitle(markdown: string): SplitDocument {
  const match = LEADING_H1.exec(markdown)
  if (!match) return { title: null, body: markdown }

  const title = (match[1] ?? '').trim()
  // 标题为空（只有一个 `#`）时不当作标题，否则用户敲下 `# ` 的瞬间正文就被吃掉
  if (!title) return { title: null, body: markdown }

  // 去掉标题行以及紧随其后的空行，避免正文顶部积累空白
  const body = markdown.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, '')
  return { title, body }
}

/** 写回文件：标题重新变成正文开头的 H1 */
export function joinTitle(title: string | null, body: string): string {
  const trimmed = title?.trim()
  if (!trimmed) return body

  const separator = body.trim() ? '\n\n' : '\n'
  return `# ${trimmed}${separator}${body}`
}

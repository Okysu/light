import { isInternalAttachment, resolveAttachmentPath } from './attachment'

/**
 * 附件的引用关系（需求 7.1 的「标注引用来源」与 7.2 的孤立检测）。
 *
 * 与链接图同一条原则：**永远由磁盘内容推导**，不落盘、不作为第二真相。
 * 附件的引用关系一旦缓存起来，就会出现「索引说没人用了，其实还有一篇在引用」——
 * 而那意味着按提示删掉附件会让某篇笔记的图裂掉。
 */

export interface AttachmentUsage {
  /** 附件在工作区中的路径 */
  path: string
  /** 引用它的笔记路径 */
  usedBy: string[]
}

export interface AttachmentIndex {
  /** 全部附件及其引用者，按路径排序 */
  items: AttachmentUsage[]
  /** 没有任何笔记引用的附件（7.2） */
  orphans: string[]
}

/** 围栏代码块，与 outline / wikilink 保持同一套判定 */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
/** Markdown 图片与链接：`![alt](src)` 与 `[text](src)` */
const MD_LINK = /!?\[[^\]]*\]\(\s*([^)\s]+)/g
/** 原始 HTML 的 src 属性 */
const HTML_SRC = /<(?:img|video|audio|source)[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi

/**
 * 从 Markdown 中提取指向工作区内部的资源引用。
 *
 * 同时认 Markdown 语法与原始 HTML：用户从别处粘贴过来的内容常常是后者，
 * 只认前者的话，那些图片会被误判成「没人引用」而进入待清理列表——
 * 按提示删掉之后笔记里就是一片裂图。
 */
export function extractAssetRefs(markdown: string): string[] {
  const refs: string[] = []
  const lines = markdown.split('\n')

  let fence: string | null = null

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]!
      if (fence === null) fence = marker[0] ?? null
      else if (marker[0] === fence) fence = null
      continue
    }
    if (fence !== null) continue

    for (const pattern of [MD_LINK, HTML_SRC]) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(line)) !== null) {
        const src = match[1]
        if (src && isInternalAttachment(src)) refs.push(src)
      }
    }
  }

  return refs
}

export interface IndexSource {
  path: string
  content: string
}

export function buildAttachmentIndex(
  sources: readonly IndexSource[],
  attachments: readonly string[],
): AttachmentIndex {
  const usedBy = new Map<string, Set<string>>()

  for (const source of sources) {
    for (const ref of extractAssetRefs(source.content)) {
      const resolved = resolveAttachmentPath(ref, source.path)
      const set = usedBy.get(resolved) ?? new Set<string>()
      set.add(source.path)
      usedBy.set(resolved, set)
    }
  }

  const items = [...attachments]
    .sort()
    .map((path) => ({ path, usedBy: [...(usedBy.get(path) ?? [])].sort() }))

  return {
    items,
    orphans: items.filter((item) => item.usedBy.length === 0).map((item) => item.path),
  }
}

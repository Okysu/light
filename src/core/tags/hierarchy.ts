/**
 * 标签层级使用 `/` 编码在标准 frontmatter 字符串中。
 *
 * 例如 `工作/Light/同步` 同时属于 `工作` 与 `工作/Light` 两个父分组。
 * 不维护额外标签数据库：层级完全可以从笔记里的 tags 重建，外部 Markdown
 * 工具也能无损读写。
 */

export interface FlatTagEntry {
  tag: string
  paths: string[]
}

export interface TagTreeNode {
  /** 完整标签路径，用于筛选和稳定 key */
  tag: string
  /** 当前层显示的名称 */
  label: string
  /** 直接使用这个精确标签的笔记 */
  directPaths: string[]
  /** 直接或任一后代标签命中的笔记，已经去重 */
  paths: string[]
  children: TagTreeNode[]
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

/** 清理首尾空白、空层级与层级两侧空白。 */
export function normalizeTagPath(value: string): string {
  return value
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
}

/** 供输入控件把 `父/子/孙` 明确渲染成面包屑，而不是一个含斜杠的普通标签。 */
export function tagPathSegments(value: string): string[] {
  const normalized = normalizeTagPath(value)
  return normalized ? normalized.split('/') : []
}

/** 从根到自身的全部标签路径。 */
export function tagPathPrefixes(value: string): string[] {
  const normalized = normalizeTagPath(value)
  if (!normalized) return []

  const parts = tagPathSegments(normalized)
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
}

/** 精确标签或其后代都属于父分组；相似前缀（如 work 与 worker）不算。 */
export function tagBelongsTo(tag: string, parent: string): boolean {
  const normalizedTag = normalizeTagPath(tag)
  const normalizedParent = normalizeTagPath(parent)
  return Boolean(
    normalizedTag &&
    normalizedParent &&
    (normalizedTag === normalizedParent || normalizedTag.startsWith(`${normalizedParent}/`)),
  )
}

interface MutableNode {
  tag: string
  label: string
  directPaths: Set<string>
  paths: Set<string>
  children: Map<string, MutableNode>
}

/**
 * 将磁盘聚合出的平面标签变成树。只有后代、没有直接笔记的父节点也会生成，
 * 因此用户可以只写 `工作/项目`，不必再冗余写一个 `工作`。
 */
export function buildTagTree(entries: readonly FlatTagEntry[]): TagTreeNode[] {
  const roots = new Map<string, MutableNode>()

  for (const entry of entries) {
    const prefixes = tagPathPrefixes(entry.tag)
    if (prefixes.length === 0) continue

    let siblings = roots
    for (let index = 0; index < prefixes.length; index += 1) {
      const tag = prefixes[index]!
      const label = tag.split('/').at(-1)!
      let node = siblings.get(label)
      if (!node) {
        node = { tag, label, directPaths: new Set(), paths: new Set(), children: new Map() }
        siblings.set(label, node)
      }

      for (const path of entry.paths) node.paths.add(path)
      if (index === prefixes.length - 1) {
        for (const path of entry.paths) node.directPaths.add(path)
      }
      siblings = node.children
    }
  }

  return finalize(roots)
}

function finalize(nodes: Map<string, MutableNode>): TagTreeNode[] {
  return [...nodes.values()]
    .map((node) => ({
      tag: node.tag,
      label: node.label,
      directPaths: [...node.directPaths],
      paths: [...node.paths],
      children: finalize(node.children),
    }))
    .sort((left, right) =>
      right.paths.length - left.paths.length || collator.compare(left.label, right.label),
    )
}

export function findTagNode(nodes: readonly TagTreeNode[], tag: string): TagTreeNode | null {
  for (const node of nodes) {
    if (node.tag === tag) return node
    const child = findTagNode(node.children, tag)
    if (child) return child
  }
  return null
}

import { extractWikilinks, resolveWikilink, type WikilinkRef } from './wikilink'

/**
 * 全库链接图：谁指向谁。
 *
 * 反向链接面板（11.2 的前置）与知识图谱读的是同一份数据。分开算两遍必然会漂移，
 * 而「A 的反向链接里有 B，可 B 的正向链接里没有 A」这种不一致，用户看到只会困惑。
 *
 * 与索引一样，这份图**永远由磁盘内容推导**，不落盘、不作为第二真相。
 * 文件才是真源——这条线一让步，就会出现「图里有但文件里没有」的幽灵链接。
 *
 * 自引用**照常记录**。曾经在这里把它过滤掉，理由是「自环在图谱里没意义」——
 * 那是拿展示层的需要去改数据层的事实，结果是用户在笔记里写了 `[[本篇]]`，
 * 反向链接面板却回他一句「还没有笔记链接到这篇」。
 * 数据层只管如实记录，要不要画自环由图谱视图自己决定。
 */

export interface LinkEdge {
  /** 发出链接的笔记路径 */
  from: string
  /** 被指向的笔记路径 */
  to: string
  /** 链接在原文里的写法与显示文本，反向链接面板要用它展示上下文 */
  ref: WikilinkRef
}

export interface LinkGraph {
  /** path → 它指向的笔记路径（去重、已解析） */
  outgoing: Map<string, string[]>
  /** path → 指向它的笔记路径（去重） */
  incoming: Map<string, string[]>
  /** 全部边，保留原始 ref 供展示 */
  edges: LinkEdge[]
  /**
   * 指向了不存在笔记的链接：目标原文 → 提到它的笔记路径。
   * 这不是错误——先写链接、后建笔记是常见写法，界面上应引导创建而不是报警。
   */
  unresolved: Map<string, string[]>
}

export interface LinkSource {
  path: string
  content: string
}

export function buildLinkGraph(sources: readonly LinkSource[]): LinkGraph {
  const paths = sources.map((source) => source.path)

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  const unresolved = new Map<string, string[]>()
  const edges: LinkEdge[] = []

  for (const source of sources) {
    for (const ref of extractWikilinks(source.content)) {
      // 纯锚点 `[[#小节]]` 指向本篇内部，不构成笔记之间的边
      if (ref.target === '') continue

      const to = resolveWikilink(ref.target, paths)
      if (to === null) {
        push(unresolved, ref.target, source.path)
        continue
      }
      push(outgoing, source.path, to)
      push(incoming, to, source.path)
      edges.push({ from: source.path, to, ref })
    }
  }

  return { outgoing, incoming, edges, unresolved }
}

/** 追加到 Map<string, string[]>，同时去重 */
function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key)
  if (!list) {
    map.set(key, [value])
    return
  }
  if (!list.includes(value)) list.push(value)
}

/** 指向该笔记的笔记；没有则空数组 */
export function backlinksOf(graph: LinkGraph, path: string): string[] {
  return graph.incoming.get(path) ?? []
}

/** 该笔记指向的笔记；没有则空数组 */
export function forwardLinksOf(graph: LinkGraph, path: string): string[] {
  return graph.outgoing.get(path) ?? []
}

/**
 * 某条反向链接的具体出处：A 在哪几处提到了 B。
 * 面板要展示的是「在什么语境下被引用」，只给路径列表信息量不够。
 */
export function edgesBetween(graph: LinkGraph, from: string, to: string): LinkEdge[] {
  return graph.edges.filter((edge) => edge.from === from && edge.to === to)
}

import type { LinkGraph } from './link-graph'

/**
 * 把链接图转成图谱视图所需的节点与边（需求 11.2）。
 *
 * 与渲染库无关：这里只产出「哪些点、哪些线、各自多重要」，
 * 具体画成什么样交给视图层。这样布局引擎将来换掉也不必动这段逻辑，
 * 而这些规则（孤立点算不算、未创建的笔记要不要显示、度数怎么算）
 * 恰恰是需要被测住的部分。
 */

export interface GraphNode {
  /** 笔记路径；未创建的笔记用 `?目标` 作标识，避免与真实路径撞车 */
  id: string
  label: string
  /** 连接数，视图据此决定节点大小 */
  degree: number
  /** 尚未创建的笔记：有人链接它，但文件不存在 */
  missing: boolean
}

export interface GraphEdge {
  id: string
  source: string
  target: string
}

export interface GraphView {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /**
   * 被滤掉的自环数量。
   *
   * 必须报出来：一个只有自引用的工作区会得到「N 篇 · 0 条链接」，
   * 用户明明写了链接，看到 0 只会以为图谱坏了——这个困惑真实发生过。
   * 图谱不画自环是对的，但不能一声不吭地把它变没。
   */
  selfLinks: number
}

export interface GraphViewOptions {
  /** 工作区里全部笔记，决定孤立笔记是否成点 */
  paths: readonly string[]
  /** 显示没有任何链接的笔记。关掉后图里只剩「有关系的部分」 */
  includeOrphans?: boolean
  /** 把「尚未创建」的链接目标也画成节点，提示哪些笔记该建了 */
  includeMissing?: boolean
  /** 有值时只显示该笔记附近的关系；链接方向不影响邻接范围。 */
  center?: string
  /** 局部图谱向外展开的最大跳数，界面目前提供 1–3 跳。 */
  depth?: number
}

/** 未创建笔记的节点 id 前缀。真实路径不会以它开头，因此不会撞车 */
const MISSING_PREFIX = '?'

export function buildGraphView(graph: LinkGraph, options: GraphViewOptions): GraphView {
  const { paths, includeOrphans = true, includeMissing = false, center } = options

  const degrees = new Map<string, number>()
  const bump = (id: string): void => {
    degrees.set(id, (degrees.get(id) ?? 0) + 1)
  }

  const edges: GraphEdge[] = []
  const seenEdges = new Set<string>()
  const selfLinked = new Set<string>()

  for (const edge of graph.edges) {
    // 自环在图谱上是个绕回自己的小圈，既占位置又不提供任何关系信息。
    // 数据层如实记录了它（反向链接面板要用），到这里才按图谱的需要滤掉，
    // 但要计数——见 GraphView.selfLinks
    if (edge.from === edge.to) {
      selfLinked.add(edge.from)
      continue
    }

    // 同一对笔记之间可能有多条引用，图上只画一条线——
    // 画多条既看不出区别，还会把布局挤开
    const id = `${edge.from}->${edge.to}`
    if (seenEdges.has(id)) continue

    seenEdges.add(id)
    edges.push({ id, source: edge.from, target: edge.to })
    bump(edge.from)
    bump(edge.to)
  }

  if (includeMissing) {
    for (const [target, sources] of graph.unresolved) {
      const id = MISSING_PREFIX + target
      for (const source of sources) {
        const edgeId = `${source}->${id}`
        if (seenEdges.has(edgeId)) continue

        seenEdges.add(edgeId)
        edges.push({ id: edgeId, source, target: id })
        bump(source)
        bump(id)
      }
    }
  }

  const nodes: GraphNode[] = []
  const seenNodes = new Set<string>()

  for (const path of paths) {
    const degree = degrees.get(path) ?? 0
    if (degree === 0 && !includeOrphans) continue

    seenNodes.add(path)
    nodes.push({ id: path, label: titleOf(path), degree, missing: false })
  }

  if (includeMissing) {
    for (const target of graph.unresolved.keys()) {
      const id = MISSING_PREFIX + target
      if (seenNodes.has(id)) continue

      seenNodes.add(id)
      nodes.push({ id, label: target, degree: degrees.get(id) ?? 0, missing: true })
    }
  }

  // 边可能指向被过滤掉的节点（例如关掉孤立点后仍有边连过去），一并剔除，
  // 否则渲染库会为这些悬空的边凭空补出节点来
  const visibleEdges = edges.filter((edge) => seenNodes.has(edge.source) && seenNodes.has(edge.target))
  if (!center) {
    return {
      nodes,
      edges: visibleEdges,
      // 只数那些确实出现在图里的笔记，被过滤掉的节点不该影响这个提示
      selfLinks: [...selfLinked].filter((id) => seenNodes.has(id)).length,
    }
  }

  const localIds = neighborhood(nodes, visibleEdges, center, options.depth ?? 1)
  const localEdges = visibleEdges.filter((edge) => localIds.has(edge.source) && localIds.has(edge.target))
  const localDegrees = new Map<string, number>()
  for (const edge of localEdges) {
    localDegrees.set(edge.source, (localDegrees.get(edge.source) ?? 0) + 1)
    localDegrees.set(edge.target, (localDegrees.get(edge.target) ?? 0) + 1)
  }

  return {
    nodes: nodes
      .filter((node) => localIds.has(node.id))
      .map((node) => ({ ...node, degree: localDegrees.get(node.id) ?? 0 })),
    edges: localEdges,
    selfLinks: [...selfLinked].filter((id) => localIds.has(id)).length,
  }
}

/**
 * 按无向邻接做 BFS：知识图谱里的“附近”既包括我引用的，也包括引用我的。
 * 链接方向仍保留在线的箭头上，只是不拿方向限制探索范围。
 */
function neighborhood(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  center: string,
  requestedDepth: number,
): Set<string> {
  if (!nodes.some((node) => node.id === center)) return new Set()

  const adjacency = new Map<string, Set<string>>()
  const connect = (from: string, to: string): void => {
    const neighbors = adjacency.get(from) ?? new Set<string>()
    neighbors.add(to)
    adjacency.set(from, neighbors)
  }
  for (const edge of edges) {
    connect(edge.source, edge.target)
    connect(edge.target, edge.source)
  }

  const maxDepth = Math.max(1, Math.floor(Number.isFinite(requestedDepth) ? requestedDepth : 1))
  const distance = new Map<string, number>([[center, 0]])
  const queue = [center]
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!
    const currentDepth = distance.get(current)!
    if (currentDepth >= maxDepth) continue

    for (const next of adjacency.get(current) ?? []) {
      if (distance.has(next)) continue
      distance.set(next, currentDepth + 1)
      queue.push(next)
    }
  }
  return new Set(distance.keys())
}

/** 图谱节点是否代表一篇真实存在的笔记 */
export function isMissingNode(id: string): boolean {
  return id.startsWith(MISSING_PREFIX)
}

function titleOf(path: string): string {
  const at = path.lastIndexOf('/')
  return (at === -1 ? path : path.slice(at + 1)).replace(/\.md$/i, '')
}

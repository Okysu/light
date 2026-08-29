import { dirname, normalizePath } from '../path'
import type { StorageAdapter } from '../storage'
import type { TreeNode } from './types'

export const SIDEBAR_ORDER_PATH = '.light/sidebar.json'

export interface SidebarOrderDocument {
  version: 1
  /** 父目录路径 → 子节点完整路径顺序；根目录使用空字符串。 */
  parents: Record<string, string[]>
}

const EMPTY_ORDER: SidebarOrderDocument = { version: 1, parents: {} }

/** 文件树由磁盘扫描产生；本服务只在扫描结果上叠加可丢弃的显示顺序。 */
export class SidebarOrderService {
  private document: SidebarOrderDocument = structuredClone(EMPTY_ORDER)

  constructor(private readonly storage: StorageAdapter) {}

  async load(): Promise<void> {
    try {
      this.document = parseSidebarOrder(JSON.parse(await this.storage.readText(SIDEBAR_ORDER_PATH)))
    } catch {
      // 排序损坏不能阻断数据目录打开。
      this.document = structuredClone(EMPTY_ORDER)
    }
  }

  apply(nodes: readonly TreeNode[], parent = ''): TreeNode[] {
    const explicit = this.document.parents[parent] ?? []
    const rank = new Map(explicit.map((path, index) => [path, index]))

    return [...nodes]
      .sort((left, right) => {
        const leftRank = rank.get(left.path)
        const rightRank = rank.get(right.path)
        if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank
        if (leftRank !== undefined) return -1
        if (rightRank !== undefined) return 1
        return 0
      })
      .map((node) => node.kind === 'folder'
        ? { ...node, children: this.apply(node.children ?? [], node.path) }
        : node)
  }

  async reorder(
    nodes: readonly TreeNode[],
    sourcePath: string,
    targetPath: string,
    position: 'before' | 'after',
  ): Promise<void> {
    const source = normalizePath(sourcePath)
    const target = normalizePath(targetPath)
    const parent = dirname(target)
    if (!source || !target || source === target || dirname(source) !== parent) {
      throw new Error('只能调整同一目录中的不同条目')
    }

    const siblings = childrenOf(nodes, parent).map((node) => node.path)
    if (!siblings.includes(source) || !siblings.includes(target)) throw new Error('排序目标已经不存在')
    const order = siblings.filter((path) => path !== source)
    const targetIndex = order.indexOf(target)
    order.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, source)
    this.document.parents[parent] = order
    this.prune(nodes)
    await this.save()
  }

  /** 外部删除/移动后清掉失效项；失败只影响偏好清理，不影响树本身。 */
  async reconcile(nodes: readonly TreeNode[]): Promise<void> {
    if (this.prune(nodes)) await this.save()
  }

  /** 改名后保留原位置；目录改名时一并改写子树的父键与路径。 */
  async remap(fromPath: string, toPath: string): Promise<void> {
    const from = normalizePath(fromPath)
    const to = normalizePath(toPath)
    const entries = Object.entries(this.document.parents)
    let changed = false

    for (const [parent, paths] of entries) {
      const nextParent = parent === from || parent.startsWith(`${from}/`)
        ? `${to}${parent.slice(from.length)}`
        : parent
      const nextPaths = paths.map((path) =>
        path === from || path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path,
      )
      if (nextParent !== parent || nextPaths.some((path, index) => path !== paths[index])) changed = true
      if (nextParent !== parent) delete this.document.parents[parent]
      this.document.parents[nextParent] = nextPaths
    }

    if (changed) await this.save()
  }

  private prune(nodes: readonly TreeNode[]): boolean {
    const before = JSON.stringify(this.document.parents)
    const knownByParent = new Map<string, Set<string>>()
    collectKnown(nodes, '', knownByParent)
    for (const [parent, paths] of Object.entries(this.document.parents)) {
      const known = knownByParent.get(parent)
      if (!known) delete this.document.parents[parent]
      else this.document.parents[parent] = [...new Set(paths.filter((path) => known.has(path)))]
    }
    return JSON.stringify(this.document.parents) !== before
  }

  private async save(): Promise<void> {
    await this.storage.writeText(SIDEBAR_ORDER_PATH, JSON.stringify(this.document, null, 2))
  }
}

export function parseSidebarOrder(source: unknown): SidebarOrderDocument {
  if (!source || typeof source !== 'object') throw new Error('侧边栏排序配置不是对象')
  const value = source as Record<string, unknown>
  if (value.version !== 1 || !value.parents || typeof value.parents !== 'object' || Array.isArray(value.parents)) {
    throw new Error('侧边栏排序配置版本或结构无效')
  }

  const parents: Record<string, string[]> = {}
  for (const [rawParent, rawPaths] of Object.entries(value.parents as Record<string, unknown>)) {
    if (!Array.isArray(rawPaths)) throw new Error('侧边栏排序条目不是数组')
    const parent = normalizePath(rawParent)
    const paths = rawPaths
      .filter((path): path is string => typeof path === 'string')
      .map(normalizePath)
      .filter((path) => path && dirname(path) === parent)
    parents[parent] = [...new Set(paths)]
  }
  return { version: 1, parents }
}

function childrenOf(nodes: readonly TreeNode[], parent: string): readonly TreeNode[] {
  if (!parent) return nodes
  for (const node of nodes) {
    if (node.kind !== 'folder') continue
    if (node.path === parent) return node.children ?? []
    const nested = childrenOf(node.children ?? [], parent)
    if (nested.length > 0) return nested
  }
  return []
}

function collectKnown(nodes: readonly TreeNode[], parent: string, result: Map<string, Set<string>>): void {
  result.set(parent, new Set(nodes.map((node) => node.path)))
  for (const node of nodes) {
    if (node.kind === 'folder') collectKnown(node.children ?? [], node.path, result)
  }
}

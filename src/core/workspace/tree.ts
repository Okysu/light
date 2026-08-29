import { extname, stem } from '../path'
import type { StorageAdapter } from '../storage'
import { normalizePath } from '../path'
import { BOARD_EXT, CANVAS_EXT, LIGHT_DIR, NOTE_EXT, type NodeKind, type TreeNode } from './types'

/** 不展示给用户的目录：Light 自有数据，以及其它工具的元数据目录 */
const HIDDEN_DIRS = new Set([LIGHT_DIR, '.git', '.obsidian', '.trash', 'node_modules'])

/** 文件类节点（目录不由扩展名判定） */
export type FileKind = Exclude<NodeKind, 'folder'>

/** 扩展名 → 节点类型；未识别的扩展名不进入笔记树（附件走独立面板） */
const EXT_TO_KIND = new Map<string, FileKind>([
  [NOTE_EXT, 'note'],
  [BOARD_EXT, 'board'],
  [CANVAS_EXT, 'canvas'],
])

export function kindOf(path: string): FileKind | null {
  return EXT_TO_KIND.get(extname(path).toLowerCase()) ?? null
}

export function extensionFor(kind: FileKind): string {
  return kind === 'note' ? NOTE_EXT : kind === 'board' ? BOARD_EXT : CANVAS_EXT
}

/** 显示名：文件去扩展名，目录用原名 */
export function displayName(path: string, kind: NodeKind): string {
  return kind === 'folder' ? (path.split('/').pop() ?? path) : stem(path)
}

export interface ScanOptions {
  /** 防御异常深度的目录结构，避免符号链接环导致的无限递归 */
  maxDepth?: number
  /**
   * 额外排除的目录，相对根的 POSIX 路径。
   *
   * 附件目录走这条路而不是加进 `HIDDEN_DIRS`：排除项也用于测试和其它
   * 可选的展示过滤。而排除附件的理由是这棵树是**文档**树——
   * 附件有自己的管理面板（7.1），在这里列一个永远打不开的空文件夹
   * 只是噪音。文件本身仍原样躺在磁盘上，用系统的文件管理器随时能看到，
   * 「文件即真源」并没有因此打折。
   */
  exclude?: readonly string[]
}

/**
 * 扫描工作区，构建笔记树。
 *
 * 这是「文件为真源」的落地点：树完全由磁盘现状推导，不读任何数据库。
 * 用户在 Finder / 资源管理器里手动放进来的 .md 文件下次打开即出现，
 * 无需导入步骤，也不存在数据库与磁盘不一致的状态。
 */
export async function scanTree(
  storage: StorageAdapter,
  root = '',
  options: ScanOptions = {},
): Promise<TreeNode[]> {
  const maxDepth = options.maxDepth ?? 32
  // 空串会命中每一个目录，把整棵树排干净——过滤掉它
  const exclude = new Set((options.exclude ?? []).map(normalizePath).filter(Boolean))
  return scanDir(storage, root, maxDepth, exclude)
}

async function scanDir(
  storage: StorageAdapter,
  dir: string,
  depthLeft: number,
  exclude: ReadonlySet<string>,
): Promise<TreeNode[]> {
  if (depthLeft <= 0) return []

  const entries = await storage.list(dir)
  const nodes: TreeNode[] = []

  for (const entry of entries) {
    if (entry.isDirectory) {
      if (HIDDEN_DIRS.has(entry.name) || exclude.has(entry.path)) continue
      nodes.push({
        path: entry.path,
        name: entry.name,
        kind: 'folder',
        children: await scanDir(storage, entry.path, depthLeft - 1, exclude),
      })
      continue
    }

    const kind = kindOf(entry.name)
    if (!kind) continue
    nodes.push({ path: entry.path, name: displayName(entry.path, kind), kind })
  }

  return sortNodes(nodes)
}

/** 目录在前，同类按名称本地化排序（中文按拼音，数字按自然序） */
export function sortNodes(nodes: TreeNode[]): TreeNode[] {
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) {
      if (a.kind === 'folder') return -1
      if (b.kind === 'folder') return 1
    }
    return collator.compare(a.name, b.name)
  })
}

/** 深度优先查找节点 */
export function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    const hit = node.children && findNode(node.children, path)
    if (hit) return hit
  }
  return null
}

/** 扁平化为列表，供搜索、命令面板等按线性结构消费 */
export function flattenTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => (node.children ? [node, ...flattenTree(node.children)] : [node]))
}

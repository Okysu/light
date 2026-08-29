import { parseDocument, readBoolean, readString, readStringArray } from '../markdown/frontmatter'
import { stem } from '../path'
import type { StorageAdapter } from '../storage'
import { normalizeTagPath } from '../tags/hierarchy'
import { flattenTree, scanTree } from './tree'
import { readProtectedText } from '../security/local-vault'

/**
 * 侧边栏的派生视图：收藏夹（需求 1.3）、标签聚合（1.6）与最近编辑（1.7）。
 *
 * 两者都由磁盘现状推导，不维护额外的状态文件——这与「文件即真源」一致：
 * 用户在别处改了标签或内容，重新扫描即得最新结果，不存在需要同步的第二份数据。
 *
 * 「最近访问」不在此处：它是本机的浏览行为，不属于工作区内容，
 * 不应写进 Vault 里跟着同步（见 stores/recent.ts）。
 */

export interface TagEntry {
  tag: string
  /** 使用了该标签的笔记路径 */
  paths: string[]
}

export interface RecentNote {
  path: string
  title: string
  /** 优先取 frontmatter.updated，缺失时回落到文件系统修改时间 */
  updatedAt: number
}

export interface FavoriteNote {
  path: string
  title: string
}

interface NoteMeta {
  path: string
  title: string
  tags: string[]
  favorite: boolean
  updatedAt: number
}

/** 读取全部笔记的元信息。两个视图共用一次扫描，避免重复遍历磁盘。 */
async function readAllMeta(storage: StorageAdapter): Promise<NoteMeta[]> {
  const nodes = flattenTree(await scanTree(storage)).filter((node) => node.kind === 'note')
  const metas: NoteMeta[] = []

  for (const node of nodes) {
    try {
      const { data } = parseDocument(await readProtectedText(await storage.readText(node.path)))
      const updated = readString(data, 'updated')
      const parsed = updated ? Date.parse(updated) : Number.NaN

      metas.push({
        path: node.path,
        title: readString(data, 'title') ?? stem(node.path),
        tags: readStringArray(data, 'tags'),
        favorite: readBoolean(data, 'favorite') ?? false,
        // frontmatter 的时间跨设备一致，比文件系统时间更可信
        updatedAt: Number.isNaN(parsed) ? ((await storage.stat(node.path)).modifiedAt ?? 0) : parsed,
      })
    } catch {
      // 单篇读失败不应让整个视图空掉
      continue
    }
  }

  return metas
}

/**
 * 聚合全库标签。
 *
 * @returns 按「使用数量降序、同数量按名称」排序的标签列表
 */
export async function collectTags(storage: StorageAdapter): Promise<TagEntry[]> {
  const metas = await readAllMeta(storage)
  const index = new Map<string, string[]>()

  for (const meta of metas) {
    for (const tag of meta.tags) {
      const normalized = normalizeTagPath(tag)
      if (!normalized) continue

      const paths = index.get(normalized) ?? []
      // 同一篇笔记重复写了同一个标签时只记一次
      if (!paths.includes(meta.path)) paths.push(meta.path)
      index.set(normalized, paths)
    }
  }

  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
  return [...index.entries()]
    .map(([tag, paths]) => ({ tag, paths }))
    .sort((a, b) => b.paths.length - a.paths.length || collator.compare(a.tag, b.tag))
}

/**
 * 收藏夹（需求 1.3）。
 *
 * 收藏状态就是 frontmatter 里的 `favorite: true`，不额外维护一份收藏清单——
 * 清单会与文件真实状态脱节，且在别的工具里改动后无从察觉。
 * 收藏夹因此是「由内容推导的视图」，而不是一个真实存在的目录，
 * 这也是它不能被删除、不能被重命名的原因。
 */
export async function collectFavorites(storage: StorageAdapter): Promise<FavoriteNote[]> {
  const metas = await readAllMeta(storage)
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

  return metas
    .filter((meta) => meta.favorite)
    .map(({ path, title }) => ({ path, title }))
    .sort((a, b) => collator.compare(a.title, b.title))
}

/** 按更新时间倒序取最近编辑的笔记 */
export async function collectRecentlyEdited(storage: StorageAdapter, limit = 20): Promise<RecentNote[]> {
  const metas = await readAllMeta(storage)

  return metas
    .map(({ path, title, updatedAt }) => ({ path, title, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

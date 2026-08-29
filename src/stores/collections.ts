import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { buildTagTree, findTagNode } from '@/core/tags/hierarchy'
import {
  collectFavorites,
  collectRecentlyEdited,
  collectTags,
  type FavoriteNote,
  type RecentNote,
  type TagEntry,
} from '@/core/workspace/collections'
import { flattenTree } from '@/core/workspace/tree'
import { useWorkspaceStore } from './workspace'

/** 最近访问保留多少条 */
const RECENT_LIMIT = 15

/**
 * 侧边栏的派生视图：收藏夹（1.3）、标签（1.6）、最近编辑与最近访问（1.7）。
 *
 * 「最近编辑」由磁盘推导，与工作区内容一致；
 * 「最近访问」是本机的浏览行为，存 localStorage 而**不写进 Vault**——
 * 它不属于笔记内容，不该跟着同步到别的设备。
 */
export const useCollectionsStore = defineStore('collections', () => {
  const workspace = useWorkspaceStore()

  const favorites = ref<FavoriteNote[]>([])
  const tags = ref<TagEntry[]>([])
  const recentlyEdited = ref<RecentNote[]>([])
  const loading = ref(false)

  /** 最近访问的路径，最新的在前 */
  const visited = useLocalStorage<string[]>('light:recent-visited', [])

  /** 当前选中的标签筛选；null 表示不筛选 */
  const activeTag = ref<string | null>(null)

  /** 斜杠标签形成的树；父分组完全从笔记 frontmatter 推导。 */
  const tagTree = computed(() => buildTagTree(tags.value))

  /** 被选中标签命中的笔记路径集合，供文件树过滤 */
  const filteredPaths = computed<Set<string> | null>(() => {
    if (!activeTag.value) return null
    const entry = findTagNode(tagTree.value, activeTag.value)
    return new Set(entry?.paths ?? [])
  })

  /** 最近访问：过滤掉已不存在的路径，避免点开是空的 */
  const recentlyVisited = computed(() => {
    const known = new Set(
      flattenTree(workspace.tree).filter((node) => node.kind === 'note').map((node) => node.path),
    )
    return visited.value.filter((path) => known.has(path)).slice(0, RECENT_LIMIT)
  })

  async function refresh(): Promise<void> {
    if (!workspace.storage) return

    loading.value = true
    try {
      favorites.value = await collectFavorites(workspace.storage)
      tags.value = await collectTags(workspace.storage)
      if (activeTag.value && !findTagNode(buildTagTree(tags.value), activeTag.value)) {
        activeTag.value = null
      }
      recentlyEdited.value = await collectRecentlyEdited(workspace.storage, RECENT_LIMIT)
      const known = new Set(
        flattenTree(workspace.tree).filter((node) => node.kind === 'note').map((node) => node.path),
      )
      visited.value = visited.value.filter((path) => known.has(path))
    } finally {
      loading.value = false
    }
  }

  /** 打开笔记时记一笔；同一篇重复打开只提到最前，不产生重复项 */
  function markVisited(path: string): void {
    visited.value = [path, ...visited.value.filter((item) => item !== path)].slice(0, RECENT_LIMIT)
  }

  /** 删除或切换目录后立刻移除已经无法访问的最近记录。 */
  function forget(path: string): void {
    visited.value = visited.value.filter(
      (item) => item !== path && !item.startsWith(`${path}/`),
    )
  }

  /** 某篇是否已收藏 */
  function isFavorite(path: string): boolean {
    return favorites.value.some((note) => note.path === path)
  }

  /**
   * 加入 / 移出收藏夹。
   * 直接改 frontmatter 而不是维护一份清单——收藏夹是由内容推导的视图，
   * 清单会与文件真实状态脱节，别的工具改了也无从察觉。
   */
  async function toggleFavorite(path: string): Promise<void> {
    if (!workspace.notes) return

    const next = !isFavorite(path)
    await workspace.notes.write(path, { properties: { favorite: next || undefined } })
    await refresh()
  }

  function toggleTag(tag: string): void {
    activeTag.value = activeTag.value === tag ? null : tag
  }

  function clearFilter(): void {
    activeTag.value = null
  }

  /** 切换工作区后所有派生数据失效 */
  function invalidate(): void {
    favorites.value = []
    tags.value = []
    recentlyEdited.value = []
    activeTag.value = null
  }

  return {
    favorites,
    tags,
    tagTree,
    recentlyEdited,
    recentlyVisited,
    visited,
    activeTag,
    filteredPaths,
    loading,
    refresh,
    isFavorite,
    toggleFavorite,
    markVisited,
    forget,
    toggleTag,
    clearFilter,
    invalidate,
  }
})

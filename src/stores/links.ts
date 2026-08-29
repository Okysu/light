import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { backlinksOf, buildLinkGraph, edgesBetween, forwardLinksOf, type LinkEdge, type LinkGraph } from '@/core/links/link-graph'
import { LinkService } from '@/core/links/link-service'
import { resolveWikilink, wikilinkTargetFor } from '@/core/links/wikilink'
import { flattenTree } from '@/core/workspace/tree'
import { useWorkspaceStore } from './workspace'

/**
 * 双向链接图（需求 2.3，支撑 11.2）。
 *
 * 与搜索索引一样懒构建：打开一篇笔记时才需要知道谁引用了它，
 * 启动阶段就扫全库只会拖慢首屏。图可随时丢弃重建，不是第二份真相。
 */
export const useLinksStore = defineStore('links', () => {
  const workspace = useWorkspaceStore()

  const service = shallowRef<LinkService | null>(null)
  /** 图本身不需要深层响应式，用计数器驱动重算 */
  const version = ref(0)
  const building = ref(false)

  const indexedCount = computed(() => {
    void version.value
    return service.value?.size ?? 0
  })

  /** 工作区里全部笔记路径，供链接目标解析用 */
  const notePaths = computed(() =>
    flattenTree(workspace.tree)
      .filter((node) => node.kind === 'note')
      .map((node) => node.path),
  )

  async function ensureGraph(force = false): Promise<void> {
    if (!workspace.storage) return
    if (service.value?.isReady && !force) return

    building.value = true
    try {
      const instance = service.value ?? new LinkService(workspace.storage)
      await instance.build()
      service.value = instance
      version.value += 1
    } finally {
      building.value = false
    }
  }

  /** 保存笔记后调用：改动会影响它指向的所有笔记的反向链接 */
  async function touch(path: string): Promise<void> {
    await service.value?.update(path)
    version.value += 1
  }

  function forget(path: string): void {
    service.value?.remove(path)
    version.value += 1
  }

  /** 指向该笔记的笔记路径 */
  function backlinks(path: string): string[] {
    void version.value
    return service.value ? backlinksOf(service.value.current, path) : []
  }

  /** 该笔记指向的笔记路径 */
  function forwardLinks(path: string): string[] {
    void version.value
    return service.value ? forwardLinksOf(service.value.current, path) : []
  }

  /** A 在哪几处提到了 B——面板要展示引用语境，只给路径信息量不够 */
  function edges(from: string, to: string): LinkEdge[] {
    void version.value
    return service.value ? edgesBetween(service.value.current, from, to) : []
  }

  /** 空图，供尚未构建时使用——让调用方不必到处判空 */
  const EMPTY_GRAPH = buildLinkGraph([])

  /** 整张链接图，供知识图谱视图使用 */
  const graph = computed<LinkGraph>(() => {
    void version.value
    return service.value?.current ?? EMPTY_GRAPH
  })

  /** 指向尚不存在笔记的链接：目标原文 → 提到它的笔记 */
  const unresolved = computed(() => {
    void version.value
    return service.value ? [...service.value.current.unresolved] : []
  })

  /** 把链接目标解析成实际路径；返回 null 表示这篇笔记还没建 */
  function resolve(target: string): string | null {
    return resolveWikilink(target, notePaths.value)
  }

  /** 为某篇笔记生成插入用的链接目标（重名时自动带上路径） */
  function targetFor(path: string): string {
    return wikilinkTargetFor(path, notePaths.value)
  }

  /** 切换工作区后整张图作废 */
  function invalidate(): void {
    service.value = null
    version.value += 1
  }

  return {
    building,
    graph,
    indexedCount,
    notePaths,
    unresolved,
    ensureGraph,
    touch,
    forget,
    backlinks,
    forwardLinks,
    edges,
    resolve,
    targetFor,
    invalidate,
  }
})

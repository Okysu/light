import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { SearchService, type SearchHit } from '@/core/search/search-service'
import { useWorkspaceStore } from './workspace'

/**
 * 全文搜索状态。
 *
 * 索引**懒构建**：打开搜索面板时才扫描全部笔记。启动阶段就建索引会拖慢首屏，
 * 而多数会话根本不会用到搜索。索引本身可随时丢弃重建，不是第二份真相。
 */
export const useSearchStore = defineStore('search', () => {
  const workspace = useWorkspaceStore()

  // 服务实例不需要深层响应式
  const service = shallowRef<SearchService | null>(null)

  const query = ref('')
  const regex = ref(false)
  const caseSensitive = ref(false)
  /** 限定搜索目录；空表示整个工作区 */
  const scope = ref('')
  const results = ref<SearchHit[]>([])
  const indexing = ref(false)
  const error = ref<string | null>(null)

  const indexedCount = computed(() => service.value?.size ?? 0)

  /** 确保索引可用；已建好则直接返回 */
  async function ensureIndex(force = false): Promise<void> {
    if (!workspace.storage) return
    if (service.value && service.value.isReady && !force) return

    indexing.value = true
    error.value = null
    try {
      const instance = service.value ?? new SearchService(workspace.storage)
      await instance.build()
      service.value = instance
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      indexing.value = false
    }
  }

  function run(): void {
    if (!service.value) {
      results.value = []
      return
    }

    error.value = null
    try {
      results.value = service.value.search(query.value, {
        regex: regex.value,
        caseSensitive: caseSensitive.value,
        scope: scope.value || undefined,
      })
    } catch (cause) {
      // 正则边打边搜必然出现非法态，服务内部已兜底，这里只防意外
      error.value = cause instanceof Error ? cause.message : String(cause)
      results.value = []
    }
  }

  /** 文档（笔记 / 看板 / 画板）保存后增量更新，避免为一次编辑重建整个索引 */
  async function touch(path: string): Promise<void> {
    await service.value?.update(path)
  }

  function forget(path: string): void {
    service.value?.remove(path)
  }

  function reset(): void {
    query.value = ''
    results.value = []
    error.value = null
  }

  /** 切换工作区后旧索引完全失效 */
  function invalidate(): void {
    service.value = null
    results.value = []
  }

  return {
    query,
    regex,
    caseSensitive,
    scope,
    results,
    indexing,
    error,
    indexedCount,
    ensureIndex,
    run,
    touch,
    forget,
    reset,
    invalidate,
  }
})

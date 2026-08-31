import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import {
  BUILTIN_PROPERTIES,
  PropertiesService,
  visibleProperties,
  type PropertyDefinition,
  type PropertyType,
} from '@/core/workspace/properties'
import type { StorageAdapter } from '@/core/storage/types'
import { useI18nStore } from './i18n'
import { useWorkspaceStore } from './workspace'

/**
 * 文档属性定义。
 *
 * 定义随工作区配置同步，值写在各篇笔记的 frontmatter 里（见 core/workspace/properties.ts）。
 * 「发现的字段」单独一份：笔记里出现过但尚未登记的键也要能编辑，
 * 否则第三方工具写入的字段在 Light 里就成了看不见、改不了的黑箱。
 */
export const usePropertiesStore = defineStore('properties', () => {
  const workspace = useWorkspaceStore()

  const service = shallowRef<PropertiesService | null>(null)
  // 定义未就绪时仍保留内置语义，不能把时间戳降级成用户可编辑的 ad-hoc 字段。
  const definitions = ref<PropertyDefinition[]>(BUILTIN_PROPERTIES.map((item) => ({ ...item })))
  /** 笔记中出现过但未登记的字段 */
  const discovered = ref<Map<string, PropertyType>>(new Map())
  const loading = ref(false)
  const error = ref<string | null>(null)
  let owner: StorageAdapter | null = null
  let loaded = false
  let generation = 0
  let pending: Promise<void> | null = null

  async function ensureLoaded(force = false): Promise<void> {
    const storage = workspace.storage
    if (!storage) return
    if (owner !== storage) {
      invalidate()
      owner = storage
    }
    if (pending && !force) return pending
    if (loaded && !force) return
    const instance = service.value ?? new PropertiesService(storage)
    service.value = instance
    const request = ++generation
    const isCurrent = () => request === generation && workspace.storage === storage && owner === storage
    loading.value = true
    error.value = null
    pending = (async () => {
      try {
        const nextDefinitions = await instance.load()
        if (!isCurrent()) return
        const nextDiscovered = await instance.discover()
        if (!isCurrent()) return
        // 同一 Vault 的后台刷新保持旧映射，完整加载后原子替换，避免表单闪回原始字段。
        definitions.value = nextDefinitions
        discovered.value = nextDiscovered
        loaded = true
      } catch (cause) {
        if (isCurrent()) {
          loaded = false
          error.value = useI18nStore().t('properties.loadFailed', {
            error: cause instanceof Error ? cause.message : String(cause),
          })
        }
      } finally {
        // 已过时的请求不能把新请求的 loading 清掉或重新填回旧 Vault 的定义。
        if (isCurrent()) {
          loading.value = false
          pending = null
        }
      }
    })()
    return pending
  }

  /** 某篇笔记该显示哪些属性。规则在 core 层（可单测），这里只做转发 */
  function definitionsFor(frontmatter: Record<string, unknown>): PropertyDefinition[] {
    return visibleProperties(definitions.value, frontmatter, discovered.value)
  }

  /** 新增一个自定义属性；key 直接用标签，便于在文件里读懂 */
  async function addDefinition(label: string, type: PropertyType = 'text'): Promise<void> {
    const instance = await mutationService()
    if (!instance) return
    const key = label.trim()
    if (!key) return

    commitMutation(instance, await instance.add({ key, label: key, type }))
  }

  /**
   * 修改属性定义（类型、候选项、是否隐藏）。
   *
   * 只按 key 定位、按补丁合并，不接受整表覆盖——设置面板里一次只改一项，
   * 传整表会把并发的其它改动一起写回去。
   */
  async function updateDefinition(key: string, patch: Partial<PropertyDefinition>): Promise<void> {
    const instance = await mutationService()
    if (!instance) return

    const next = definitions.value.map((definition) =>
      definition.key === key ? { ...definition, ...patch, key: definition.key } : definition,
    )
    await instance.save(next)
    commitMutation(instance, next)
  }

  /**
   * 把笔记里出现过、但尚未登记的字段正式登记下来。
   * 类型沿用发现时推断的结果，用户随后可在同一处改。
   */
  async function registerDiscovered(key: string): Promise<void> {
    await addDefinition(key, discovered.value.get(key) ?? 'text')
  }

  /** 上移 / 下移一位。属性的排列顺序就是笔记里表单的顺序 */
  async function moveDefinition(key: string, delta: number): Promise<void> {
    const instance = await mutationService()
    if (!instance) return
    commitMutation(instance, await instance.move(key, delta))
  }

  async function removeDefinition(key: string): Promise<void> {
    const instance = await mutationService()
    if (!instance) return
    commitMutation(instance, await instance.remove(key))
  }

  async function mutationService(): Promise<PropertiesService | null> {
    const storage = workspace.storage
    await ensureLoaded()
    // 用户在旧目录点下的操作，不能在等待定义期间换目录后作用于新 Vault。
    return loaded && owner === storage && workspace.storage === storage ? service.value : null
  }

  function commitMutation(instance: PropertiesService, next: PropertyDefinition[]): void {
    if (service.value !== instance || workspace.storage !== owner) return
    generation += 1
    pending = null
    loading.value = false
    loaded = true
    definitions.value = next
  }

  /** 切换工作区后定义与发现结果都失效 */
  function invalidate(): void {
    generation += 1
    pending = null
    owner = null
    loaded = false
    loading.value = false
    error.value = null
    service.value = null
    definitions.value = BUILTIN_PROPERTIES.map((item) => ({ ...item }))
    discovered.value = new Map()
  }

  return {
    definitions,
    discovered,
    loading,
    error,
    ensureLoaded,
    definitionsFor,
    addDefinition,
    updateDefinition,
    moveDefinition,
    registerDiscovered,
    removeDefinition,
    invalidate,
  }
})

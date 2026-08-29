import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import {
  PropertiesService,
  visibleProperties,
  type PropertyDefinition,
  type PropertyType,
} from '@/core/workspace/properties'
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
  const definitions = ref<PropertyDefinition[]>([])
  /** 笔记中出现过但未登记的字段 */
  const discovered = ref<Map<string, PropertyType>>(new Map())
  const loading = ref(false)

  async function ensureLoaded(force = false): Promise<void> {
    if (!workspace.storage) return
    if (definitions.value.length > 0 && !force) return

    loading.value = true
    try {
      const instance = service.value ?? new PropertiesService(workspace.storage)
      service.value = instance
      definitions.value = await instance.load()
      discovered.value = await instance.discover()
    } finally {
      loading.value = false
    }
  }

  /** 某篇笔记该显示哪些属性。规则在 core 层（可单测），这里只做转发 */
  function definitionsFor(frontmatter: Record<string, unknown>): PropertyDefinition[] {
    return visibleProperties(definitions.value, frontmatter, discovered.value)
  }

  /** 新增一个自定义属性；key 直接用标签，便于在文件里读懂 */
  async function addDefinition(label: string, type: PropertyType = 'text'): Promise<void> {
    if (!service.value) return
    const key = label.trim()
    if (!key) return

    definitions.value = await service.value.add({ key, label: key, type })
  }

  /**
   * 修改属性定义（类型、候选项、是否隐藏）。
   *
   * 只按 key 定位、按补丁合并，不接受整表覆盖——设置面板里一次只改一项，
   * 传整表会把并发的其它改动一起写回去。
   */
  async function updateDefinition(key: string, patch: Partial<PropertyDefinition>): Promise<void> {
    if (!service.value) return

    const next = definitions.value.map((definition) =>
      definition.key === key ? { ...definition, ...patch, key: definition.key } : definition,
    )
    await service.value.save(next)
    definitions.value = next
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
    if (!service.value) return
    definitions.value = await service.value.move(key, delta)
  }

  async function removeDefinition(key: string): Promise<void> {
    if (!service.value) return
    definitions.value = await service.value.remove(key)
  }

  /** 切换工作区后定义与发现结果都失效 */
  function invalidate(): void {
    service.value = null
    definitions.value = []
    discovered.value = new Map()
  }

  return {
    definitions,
    discovered,
    loading,
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

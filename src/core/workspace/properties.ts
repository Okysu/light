import { parseDocument } from '../markdown/frontmatter'
import type { StorageAdapter } from '../storage'
import { LIGHT_DIR } from './types'
import { flattenTree, scanTree } from './tree'

/**
 * 文档属性（需求 S9 / 1.6）。
 *
 * **定义**存在 `.light/properties.json`，**值**仍写在每篇笔记的 frontmatter 里。
 * 这样分工的理由：
 * - 值留在 frontmatter，文件依旧是标准 Markdown，Obsidian 等工具照样读得懂；
 * - 定义（类型、候选项、顺序）无处安放于单篇笔记，放进工作区配置后随同步扩散，
 *   多设备能看到同一套属性，也支持「预置尚未被任何笔记使用的属性」。
 *
 * 未登记的字段不会被丢弃：`discover` 会扫出笔记里实际出现的键，
 * 表单据此显示它们，用户可以就地把它们提升为正式属性。
 */

export const PROPERTIES_CONFIG_PATH = `${LIGHT_DIR}/properties.json`

export type PropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'select' | 'multiSelect'

export interface PropertyDefinition {
  /** frontmatter 中的字段名 */
  key: string
  label: string
  type: PropertyType
  /** select / multiSelect 的候选值 */
  options?: string[]
  /** 内置属性不可删除，但可隐藏 */
  builtin?: boolean
  /** 由系统维护，表单中只读 */
  readonly?: boolean
  hidden?: boolean
}

/**
 * 内置属性。
 *
 * `id` 不在其中——它是双向链接的锚点，属于实现细节，暴露给用户编辑只会带来
 * 「改了 id 导致引用断裂」的风险。
 *
 * `favorite` 也不在其中：收藏是一个动作，入口在右键菜单与收藏夹视图里，
 * 放进属性表单会让「收藏」既像动作又像字段，两个入口反而更难理解。
 */
export const BUILTIN_PROPERTIES: PropertyDefinition[] = [
  { key: 'tags', label: '标签', type: 'multiSelect', builtin: true },
  { key: 'created', label: '创建时间', type: 'date', builtin: true, readonly: true },
  { key: 'updated', label: '更新时间', type: 'date', builtin: true, readonly: true },
]

/**
 * 不在属性表单中展示的字段：由别处管理，或属于内部实现。
 *
 * 必须导出。此前 store 里另写了一份「排除 id 与 title」的判断，两份规则一漂移，
 * `favorite` 就漏了过去——它带着英文键名出现在属性表单里，而收藏的真正入口
 * 在右键菜单。判断只留这一处。
 */
export const EXCLUDED_PROPERTY_KEYS = new Set(['id', 'title', 'favorite'])

/** 该字段是否属于「不展示给用户编辑」的一类 */
export function isExcludedProperty(key: string): boolean {
  return EXCLUDED_PROPERTY_KEYS.has(key)
}

interface PropertiesConfig {
  version: 1
  definitions: PropertyDefinition[]
  /**
   * 显示顺序（key 列表）。
   *
   * 单独记而不是靠 `definitions` 的数组顺序：未改动的内置属性不写进配置
   * （见 `isPristineBuiltin`），它们的位置就无处可依。有了这份清单，
   * 配置文件保持精简的同时，顺序仍然是权威的。
   */
  order?: string[]
}

/**
 * 按记录的顺序排列定义。
 *
 * 不在清单里的排在后面并保持相对顺序——新增的属性、或用户手工改过配置文件后
 * 多出来的项，都属于这种情况，不该因为「没登记过位置」就消失或乱序。
 */
export function sortByOrder(
  definitions: readonly PropertyDefinition[],
  order: readonly string[] | undefined,
): PropertyDefinition[] {
  if (!order || order.length === 0) return [...definitions]

  const rank = new Map(order.map((key, index) => [key, index]))
  return [...definitions].sort((a, b) => {
    const left = rank.get(a.key) ?? Number.MAX_SAFE_INTEGER
    const right = rank.get(b.key) ?? Number.MAX_SAFE_INTEGER
    return left - right
  })
}

/**
 * 把某个属性上移或下移一位。
 * @returns 调整后的新数组；已在边界则原样返回
 */
export function moveDefinition(
  definitions: readonly PropertyDefinition[],
  key: string,
  delta: number,
): PropertyDefinition[] {
  const from = definitions.findIndex((definition) => definition.key === key)
  const to = from + delta
  if (from === -1 || to < 0 || to >= definitions.length) return [...definitions]

  const next = [...definitions]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

/** 从已有值推断类型，供「发现的字段」提供合理的默认编辑方式 */
export function inferType(value: unknown): PropertyType {
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  if (Array.isArray(value)) return 'multiSelect'
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}/.test(value)) {
    return 'date'
  }
  return 'text'
}

export class PropertiesService {
  constructor(private readonly storage: StorageAdapter) {}

  /** 内置属性 + 用户定义，按用户调整过的顺序返回 */
  async load(): Promise<PropertyDefinition[]> {
    const config = await this.readConfig()
    const customKeys = new Set(config.definitions.map((definition) => definition.key))

    // 用户可以覆盖内置属性的 label/隐藏状态，因此同 key 时以用户配置为准
    const builtin = BUILTIN_PROPERTIES.filter((definition) => !customKeys.has(definition.key))
    return sortByOrder([...builtin, ...config.definitions], config.order)
  }

  async save(definitions: PropertyDefinition[]): Promise<void> {
    const config: PropertiesConfig = {
      version: 1,
      // 内置属性无需落盘，除非用户改过它（改过就会带上非默认字段）
      definitions: definitions.filter((definition) => !isPristineBuiltin(definition)),
      // 顺序要记全部的 key，否则未落盘的内置属性一重载就跳回默认位置
      order: definitions.map((definition) => definition.key),
    }
    await this.storage.writeText(PROPERTIES_CONFIG_PATH, JSON.stringify(config, null, 2))
  }

  /** 上移 / 下移一位并落盘 */
  async move(key: string, delta: number): Promise<PropertyDefinition[]> {
    const next = moveDefinition(await this.load(), key, delta)
    await this.save(next)
    return next
  }

  async add(definition: PropertyDefinition): Promise<PropertyDefinition[]> {
    const existing = await this.load()
    if (existing.some((item) => item.key === definition.key)) return existing

    const next = [...existing, definition]
    await this.save(next)
    return next
  }

  async remove(key: string): Promise<PropertyDefinition[]> {
    const existing = await this.load()
    // 内置属性只允许隐藏，不允许删除——删了之后 frontmatter 里的值会失去编辑入口
    const next = existing.filter((item) => item.key !== key || item.builtin)
    await this.save(next)
    return next
  }

  /**
   * 扫描全部笔记，找出实际出现过但尚未登记的 frontmatter 字段。
   * @returns 字段名到推断类型的映射
   */
  async discover(): Promise<Map<string, PropertyType>> {
    const known = new Set((await this.load()).map((definition) => definition.key))
    const found = new Map<string, PropertyType>()

    const notes = flattenTree(await scanTree(this.storage)).filter((node) => node.kind === 'note')

    for (const note of notes) {
      let data: Record<string, unknown>
      try {
        data = parseDocument(await this.storage.readText(note.path)).data
      } catch {
        continue
      }

      for (const [key, value] of Object.entries(data)) {
        if (known.has(key) || isExcludedProperty(key) || found.has(key)) continue
        found.set(key, inferType(value))
      }
    }

    return found
  }

  /** 收集某个属性在全库出现过的取值，用作 select 的候选来源（标签即典型场景） */
  async collectValues(key: string): Promise<string[]> {
    const values = new Set<string>()
    const notes = flattenTree(await scanTree(this.storage)).filter((node) => node.kind === 'note')

    for (const note of notes) {
      let data: Record<string, unknown>
      try {
        data = parseDocument(await this.storage.readText(note.path)).data
      } catch {
        continue
      }

      const value = data[key]
      if (Array.isArray(value)) {
        value.forEach((item) => typeof item === 'string' && values.add(item))
      } else if (typeof value === 'string' && value) {
        values.add(value)
      }
    }

    return [...values].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }

  private async readConfig(): Promise<{ definitions: PropertyDefinition[]; order?: string[] }> {
    try {
      const parsed = JSON.parse(await this.storage.readText(PROPERTIES_CONFIG_PATH)) as Partial<PropertiesConfig>
      if (!Array.isArray(parsed.definitions)) return { definitions: [] }

      return {
        definitions: parsed.definitions.filter(isValidDefinition),
        // order 是后加的字段，老配置文件没有它；也可能被手工改坏
        ...(Array.isArray(parsed.order) ? { order: parsed.order.filter((key) => typeof key === 'string') } : {}),
      }
    } catch {
      // 配置缺失或损坏时退回纯内置属性，不能让整个表单打不开
      return { definitions: [] }
    }
  }
}

function isValidDefinition(value: unknown): value is PropertyDefinition {
  const definition = value as Partial<PropertyDefinition>
  return typeof definition?.key === 'string' && typeof definition.label === 'string' && !!definition.type
}

/** 与内置定义完全一致的项无需写入配置文件 */
function isPristineBuiltin(definition: PropertyDefinition): boolean {
  const builtin = BUILTIN_PROPERTIES.find((item) => item.key === definition.key)
  if (!builtin) return false
  return JSON.stringify(builtin) === JSON.stringify(definition)
}

/**
 * 某篇笔记该显示哪些属性：已登记且未隐藏的 + 它自己带的未登记字段。
 *
 * 关键在 `known` 必须包含**全部**定义、含已隐藏的那些。
 * 曾经这里只拿未隐藏的去建集合，于是隐藏一个属性之后，它落到了「未登记字段」
 * 那一支里被重新捡回来——隐藏功能完全失效，而且因为 ad-hoc 字段的 label
 * 直接取原始 key，界面上还会从「创建时间」倒退成英文的 `created`。
 */
export function visibleProperties(
  definitions: readonly PropertyDefinition[],
  frontmatter: Record<string, unknown>,
  discovered: ReadonlyMap<string, PropertyType> = new Map(),
): PropertyDefinition[] {
  const known = new Set(definitions.map((definition) => definition.key))
  const registered = definitions.filter((definition) => !definition.hidden)

  const adHoc: PropertyDefinition[] = Object.keys(frontmatter)
    .filter((key) => !known.has(key) && !isExcludedProperty(key))
    .map((key) => ({
      key,
      label: key,
      type: discovered.get(key) ?? inferType(frontmatter[key]),
    }))

  return [...registered, ...adHoc]
}

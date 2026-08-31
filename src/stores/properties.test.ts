// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryAdapter } from '@/core/storage/memory-adapter'
import { BUILTIN_PROPERTIES, PropertiesService, type PropertyDefinition } from '@/core/workspace/properties'
import { usePropertiesStore } from './properties'
import { useWorkspaceStore } from './workspace'

const frontmatter = { created: '2026-08-31', updated: '2026-08-31', tags: ['Light'] }
const definitions = (label: string): PropertyDefinition[] => [
  ...BUILTIN_PROPERTIES.map((entry) => ({ ...entry })),
  { key: 'status', label, type: 'select', options: ['draft', 'done'] },
]
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useWorkspaceStore().storage = new MemoryAdapter()
})
afterEach(() => vi.restoreAllMocks())

describe('属性定义缓存生命周期', () => {
  it('同步完成入口主动刷新定义，不清空后等待同路径的表单重新挂载', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.vue'), 'utf8')
    const callback = app.match(/function invalidateSyncedCaches\(\): void \{([\s\S]*?)\n\}/)?.[1]
    expect(callback).toContain('properties.ensureLoaded(true)')
    expect(callback).not.toContain('properties.invalidate()')
  })

  it('首次加载前和缓存作废后，内置字段不退化为原始输入框', async () => {
    const properties = usePropertiesStore()
    const assertBuiltins = () => {
      const visible = properties.definitionsFor(frontmatter)
      expect(visible.find((item) => item.key === 'created')).toMatchObject({ label: '创建时间', type: 'date', readonly: true })
      expect(visible.find((item) => item.key === 'updated')).toMatchObject({ label: '更新时间', type: 'date', readonly: true })
      expect(visible.find((item) => item.key === 'tags')).toMatchObject({ label: '标签', type: 'multiSelect' })
    }
    assertBuiltins()
    await properties.ensureLoaded()
    properties.invalidate()
    assertBuiltins()
  })

  it('内置兜底不冒充已加载缓存，作废后仍读取用户定义', async () => {
    const load = vi.spyOn(PropertiesService.prototype, 'load').mockResolvedValue(definitions('自定义状态'))
    vi.spyOn(PropertiesService.prototype, 'discover').mockResolvedValue(new Map())
    const properties = usePropertiesStore()
    await properties.ensureLoaded()
    properties.invalidate()
    await properties.ensureLoaded()
    expect(load).toHaveBeenCalledTimes(2)
    expect(properties.definitions.at(-1)?.label).toBe('自定义状态')
  })

  it('停留同篇笔记，强制刷新期间保留自定义表单，完成后更新映射和隐藏状态', async () => {
    const pending = deferred<PropertyDefinition[]>()
    vi.spyOn(PropertiesService.prototype, 'load').mockResolvedValueOnce(definitions('原状态')).mockReturnValueOnce(pending.promise)
    vi.spyOn(PropertiesService.prototype, 'discover').mockResolvedValue(new Map())
    const properties = usePropertiesStore()
    await properties.ensureLoaded()
    const refresh = properties.ensureLoaded(true)
    expect(properties.definitions.at(-1)).toMatchObject({ label: '原状态', type: 'select' })
    expect(properties.loading).toBe(true)
    pending.resolve(definitions('同步后的状态').map((item) => item.key === 'created' ? { ...item, hidden: true } : item))
    await refresh
    expect(properties.definitions.at(-1)?.label).toBe('同步后的状态')
    expect(properties.definitionsFor(frontmatter).some((item) => item.key === 'created')).toBe(false)
  })

  it('重复加载合并，避免表单与设置页同时触发重复扫描', async () => {
    const pending = deferred<PropertyDefinition[]>()
    const load = vi.spyOn(PropertiesService.prototype, 'load').mockReturnValue(pending.promise)
    const discover = vi.spyOn(PropertiesService.prototype, 'discover').mockResolvedValue(new Map())
    const properties = usePropertiesStore()
    const a = properties.ensureLoaded()
    const b = properties.ensureLoaded()
    expect(load).toHaveBeenCalledOnce()
    pending.resolve(definitions('状态'))
    await Promise.all([a, b])
    expect(discover).toHaveBeenCalledOnce()
  })

  it('旧目录迟到的加载结果不能覆盖新目录，或清除新请求的 loading', async () => {
    const old = deferred<PropertyDefinition[]>()
    const next = deferred<PropertyDefinition[]>()
    vi.spyOn(PropertiesService.prototype, 'load').mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    vi.spyOn(PropertiesService.prototype, 'discover').mockResolvedValue(new Map())
    const properties = usePropertiesStore()
    const previous = properties.ensureLoaded()
    useWorkspaceStore().storage = new MemoryAdapter()
    properties.invalidate()
    const current = properties.ensureLoaded()
    old.resolve(definitions('旧目录'))
    await previous
    expect(properties.loading).toBe(true)
    expect(properties.definitions.some((item) => item.label === '旧目录')).toBe(false)
    next.resolve(definitions('新目录'))
    await current
    expect(properties.definitions.at(-1)?.label).toBe('新目录')
    expect(properties.loading).toBe(false)
  })

  it('连续刷新乱序结束时，只接受最后一轮结果', async () => {
    const old = deferred<PropertyDefinition[]>()
    const next = deferred<PropertyDefinition[]>()
    vi.spyOn(PropertiesService.prototype, 'load').mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    vi.spyOn(PropertiesService.prototype, 'discover').mockResolvedValue(new Map())
    const properties = usePropertiesStore()
    const previous = properties.ensureLoaded()
    const current = properties.ensureLoaded(true)
    next.resolve(definitions('最新'))
    await current
    old.resolve(definitions('过时'))
    await previous
    expect(properties.definitions.at(-1)?.label).toBe('最新')
  })

  it('刷新失败保留旧映射并提示，之后可重试而不是把失败结果当缓存', async () => {
    const load = vi.spyOn(PropertiesService.prototype, 'load').mockResolvedValue(definitions('原状态'))
    const discover = vi.spyOn(PropertiesService.prototype, 'discover').mockResolvedValue(new Map())
    const properties = usePropertiesStore()
    await properties.ensureLoaded()
    load.mockResolvedValue(definitions('新状态'))
    discover.mockRejectedValueOnce(new Error('temporary read failure'))
    await expect(properties.ensureLoaded(true)).resolves.toBeUndefined()
    expect(properties.definitions.at(-1)?.label).toBe('原状态')
    expect(properties.error).toContain('temporary read failure')
    expect(properties.loading).toBe(false)
    await properties.ensureLoaded()
    expect(properties.definitions.at(-1)?.label).toBe('新状态')
    expect(properties.error).toBeNull()
  })

  it('初始化未完成时修改属性先等完整定义，不能只把内置兜底写回配置', async () => {
    const pending = deferred<PropertyDefinition[]>()
    vi.spyOn(PropertiesService.prototype, 'load').mockReturnValue(pending.promise)
    vi.spyOn(PropertiesService.prototype, 'discover').mockResolvedValue(new Map())
    const save = vi.spyOn(PropertiesService.prototype, 'save').mockResolvedValue()
    const properties = usePropertiesStore()
    const update = properties.updateDefinition('tags', { hidden: true })
    expect(save).not.toHaveBeenCalled()
    pending.resolve(definitions('自定义状态'))
    await update
    expect(save).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'status', label: '自定义状态' }),
      expect.objectContaining({ key: 'tags', hidden: true }),
    ]))
  })

  it('旧目录属性修改的迟到结果同样不能回填到新目录', async () => {
    const load = vi.spyOn(PropertiesService.prototype, 'load').mockResolvedValue(definitions('旧目录'))
    vi.spyOn(PropertiesService.prototype, 'discover').mockResolvedValue(new Map())
    const save = deferred<void>()
    vi.spyOn(PropertiesService.prototype, 'save').mockReturnValue(save.promise)
    const properties = usePropertiesStore()
    await properties.ensureLoaded()
    const update = properties.updateDefinition('status', { label: '旧目录的修改' })
    await vi.waitFor(() => expect(PropertiesService.prototype.save).toHaveBeenCalledOnce())
    useWorkspaceStore().storage = new MemoryAdapter()
    properties.invalidate()
    load.mockResolvedValue(definitions('新目录'))
    await properties.ensureLoaded()
    save.resolve()
    await update
    expect(properties.definitions.at(-1)?.label).toBe('新目录')
  })

  it('等待初始化期间切换目录，旧表单操作不能修改新目录的同名属性', async () => {
    const old = deferred<PropertyDefinition[]>()
    vi.spyOn(PropertiesService.prototype, 'load').mockReturnValueOnce(old.promise).mockResolvedValue(definitions('新目录'))
    vi.spyOn(PropertiesService.prototype, 'discover').mockResolvedValue(new Map())
    const save = vi.spyOn(PropertiesService.prototype, 'save').mockResolvedValue()
    const properties = usePropertiesStore()
    const update = properties.updateDefinition('status', { label: '旧表单操作' })
    useWorkspaceStore().storage = new MemoryAdapter()
    properties.invalidate()
    await properties.ensureLoaded()
    old.resolve(definitions('旧目录'))
    await update
    expect(save).not.toHaveBeenCalled()
    expect(properties.definitions.at(-1)?.label).toBe('新目录')
  })
})

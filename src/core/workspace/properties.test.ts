import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { NoteRepository } from './note-repository'
import {
  BUILTIN_PROPERTIES,
  PROPERTIES_CONFIG_PATH,
  PropertiesService,
  inferType,
  isExcludedProperty,
  moveDefinition,
  sortByOrder,
  visibleProperties,
  type PropertyDefinition,
  type PropertyType,
} from './properties'

describe('inferType', () => {
  it('按值推断编辑方式', () => {
    expect(inferType(true)).toBe('checkbox')
    expect(inferType(42)).toBe('number')
    expect(inferType(['a', 'b'])).toBe('multiSelect')
    expect(inferType('2026-08-29')).toBe('date')
    expect(inferType('随便一句话')).toBe('text')
  })

  it('像日期但不是日期格式的字符串仍按文本处理', () => {
    expect(inferType('2026年8月')).toBe('text')
  })
})

describe('PropertiesService', () => {
  let fs: MemoryAdapter
  let service: PropertiesService

  beforeEach(async () => {
    fs = new MemoryAdapter()
    service = new PropertiesService(fs)
  })

  describe('load', () => {
    it('没有配置文件时返回内置属性', async () => {
      const definitions = await service.load()
      expect(definitions.map((d) => d.key)).toEqual(BUILTIN_PROPERTIES.map((d) => d.key))
    })

    it('配置损坏时退回内置属性，不让表单打不开', async () => {
      await fs.writeText(PROPERTIES_CONFIG_PATH, '{ 这不是 JSON')
      expect((await service.load()).length).toBe(BUILTIN_PROPERTIES.length)
    })

    it('用户定义追加在内置之后', async () => {
      await service.add({ key: 'status', label: '状态', type: 'select', options: ['待办', '完成'] })
      const keys = (await service.load()).map((d) => d.key)
      expect(keys.at(-1)).toBe('status')
      expect(keys).toContain('tags')
    })
  })

  describe('add / remove', () => {
    it('重复 key 不会重复添加', async () => {
      await service.add({ key: 'status', label: '状态', type: 'text' })
      const after = await service.add({ key: 'status', label: '另一个状态', type: 'text' })
      expect(after.filter((d) => d.key === 'status')).toHaveLength(1)
    })

    it('可删除自定义属性', async () => {
      await service.add({ key: 'status', label: '状态', type: 'text' })
      const after = await service.remove('status')
      expect(after.map((d) => d.key)).not.toContain('status')
    })

    it('内置属性不可删除——删掉后 frontmatter 里的值会失去编辑入口', async () => {
      const after = await service.remove('tags')
      expect(after.map((d) => d.key)).toContain('tags')
    })

    it('未改动的内置属性不写入配置文件，保持配置精简', async () => {
      await service.add({ key: 'status', label: '状态', type: 'text' })
      const saved = JSON.parse(await fs.readText(PROPERTIES_CONFIG_PATH))
      expect(saved.definitions.map((d: { key: string }) => d.key)).toEqual(['status'])
    })
  })

  describe('discover', () => {
    it('找出笔记里出现过但未登记的字段并推断类型', async () => {
      const repo = new NoteRepository(fs)
      const path = await repo.create('', '笔记')
      await repo.write(path, { properties: { 作者: '张三', 阅读进度: 42, 已归档: true } })

      const found = await service.discover()
      expect(found.get('作者')).toBe('text')
      expect(found.get('阅读进度')).toBe('number')
      expect(found.get('已归档')).toBe('checkbox')
    })

    it('已登记的字段不再出现在发现结果中', async () => {
      const repo = new NoteRepository(fs)
      const path = await repo.create('', '笔记')
      await repo.write(path, { properties: { 作者: '张三' } })

      await service.add({ key: '作者', label: '作者', type: 'text' })
      expect((await service.discover()).has('作者')).toBe(false)
    })

    it('id 与 title 属于内部字段，不作为可编辑属性暴露', async () => {
      const repo = new NoteRepository(fs)
      await repo.create('', '笔记')

      const found = await service.discover()
      expect(found.has('id')).toBe(false)
      expect(found.has('title')).toBe(false)
    })

    /**
     * 收藏是一个动作，入口在右键菜单与收藏夹视图。
     * 曾经漏过：store 里另写了一份「排除 id 与 title」的判断，两份规则一漂移，
     * `favorite` 就带着英文键名出现在了属性表单里。
     */
    it('favorite 不作为属性暴露——收藏是动作，不是字段', async () => {
      const repo = new NoteRepository(fs)
      const path = await repo.create('', '笔记')
      await repo.write(path, { properties: { favorite: true } })

      expect((await service.discover()).has('favorite')).toBe(false)
    })
  })

  describe('isExcludedProperty', () => {
    it('内部字段与由别处管理的字段一律排除', () => {
      for (const key of ['id', 'title', 'favorite']) {
        expect(isExcludedProperty(key)).toBe(true)
      }
    })

    it('普通字段不受影响', () => {
      expect(isExcludedProperty('作者')).toBe(false)
      expect(isExcludedProperty('tags')).toBe(false)
    })
  })

  describe('collectValues', () => {
    it('汇总全库出现过的取值，供候选项使用', async () => {
      const repo = new NoteRepository(fs)
      const a = await repo.create('', '甲')
      const b = await repo.create('', '乙')
      await repo.write(a, { tags: ['工作', '会议'] })
      await repo.write(b, { tags: ['工作', '生活'] })

      // 只断言集合内容与去重：具体顺序取决于运行环境的 ICU 排序数据，
      // 对它做强断言会让测试在不同 Node / 浏览器上飘
      const values = await service.collectValues('tags')
      expect([...values].sort()).toEqual(['会议', '工作', '生活'].sort())
      expect(values).toHaveLength(3)
    })

    it('无该属性时返回空', async () => {
      expect(await service.collectValues('不存在')).toEqual([])
    })
  })
})

describe('NoteRepository 的任意属性写入', () => {
  let fs: MemoryAdapter
  let repo: NoteRepository

  beforeEach(() => {
    fs = new MemoryAdapter()
    repo = new NoteRepository(fs)
  })

  it('写入自定义属性并保留已有字段', async () => {
    const path = await repo.create('', '笔记')
    await repo.write(path, { properties: { 作者: '张三' } })

    const note = await repo.read(path)
    expect(note.frontmatter['作者']).toBe('张三')
    expect(note.frontmatter['id']).toBeTruthy()
  })

  it('值为 undefined 时删除该字段，而不是留下空值', async () => {
    const path = await repo.create('', '笔记')
    await repo.write(path, { properties: { 作者: '张三' } })
    await repo.write(path, { properties: { 作者: undefined } })

    expect((await repo.read(path)).frontmatter).not.toHaveProperty('作者')
  })

  it('通过 properties 改标签同样生效', async () => {
    const path = await repo.create('', '笔记')
    const note = await repo.write(path, { properties: { tags: ['工作'] } })
    expect(note.tags).toEqual(['工作'])
  })
})

describe('visibleProperties', () => {
  const BUILTIN: PropertyDefinition[] = [
    { key: 'tags', label: '标签', type: 'multiSelect', builtin: true },
    { key: 'created', label: '创建时间', type: 'date', builtin: true, readonly: true },
  ]

  it('列出未隐藏的已登记属性', () => {
    const result = visibleProperties(BUILTIN, { tags: [], created: '2026-08-29' })
    expect(result.map((d) => d.key)).toEqual(['tags', 'created'])
  })

  /**
   * 这条锁的是一个真实缺陷：曾经 `known` 只由**未隐藏**的定义构成，
   * 于是隐藏一个属性后它落进「未登记字段」那一支被重新捡回来——
   * 隐藏彻底失效，而且 ad-hoc 字段的 label 取原始 key，
   * 界面上还会从「创建时间」倒退成英文的 `created`。
   */
  it('隐藏的属性不会作为未登记字段重新出现', () => {
    const definitions = BUILTIN.map((d) => (d.key === 'created' ? { ...d, hidden: true } : d))
    const result = visibleProperties(definitions, { tags: [], created: '2026-08-29' })

    expect(result.map((d) => d.key)).toEqual(['tags'])
    expect(result.some((d) => d.label === 'created')).toBe(false)
  })

  it('笔记自带的未登记字段仍会出现，并推断类型', () => {
    const result = visibleProperties(BUILTIN, { 作者: '张三', 页数: 42 })
    expect(result.find((d) => d.key === '作者')?.type).toBe('text')
    expect(result.find((d) => d.key === '页数')?.type).toBe('number')
  })

  it('已发现的类型优先于按值推断', () => {
    const discovered = new Map<string, PropertyType>([['状态', 'select']])
    const result = visibleProperties(BUILTIN, { 状态: '待办' }, discovered)
    expect(result.find((d) => d.key === '状态')?.type).toBe('select')
  })

  it('内部字段不出现', () => {
    const result = visibleProperties(BUILTIN, { id: 'x', title: 'y', favorite: true })
    expect(result.map((d) => d.key)).toEqual(['tags', 'created'])
  })

  it('已登记但笔记里没有该字段时，仍然显示以便填写', () => {
    expect(visibleProperties(BUILTIN, {}).map((d) => d.key)).toEqual(['tags', 'created'])
  })
})

describe('moveDefinition', () => {
  const items: PropertyDefinition[] = [
    { key: 'a', label: 'A', type: 'text' },
    { key: 'b', label: 'B', type: 'text' },
    { key: 'c', label: 'C', type: 'text' },
  ]

  const keys = (list: PropertyDefinition[]): string[] => list.map((d) => d.key)

  it('下移一位', () => {
    expect(keys(moveDefinition(items, 'a', 1))).toEqual(['b', 'a', 'c'])
  })

  it('上移一位', () => {
    expect(keys(moveDefinition(items, 'c', -1))).toEqual(['a', 'c', 'b'])
  })

  it('已在顶部时上移不动', () => {
    expect(keys(moveDefinition(items, 'a', -1))).toEqual(['a', 'b', 'c'])
  })

  it('已在底部时下移不动', () => {
    expect(keys(moveDefinition(items, 'c', 1))).toEqual(['a', 'b', 'c'])
  })

  it('key 不存在时原样返回', () => {
    expect(keys(moveDefinition(items, '不存在', 1))).toEqual(['a', 'b', 'c'])
  })

  it('不修改传入的数组', () => {
    moveDefinition(items, 'a', 1)
    expect(keys(items)).toEqual(['a', 'b', 'c'])
  })
})

describe('sortByOrder', () => {
  const items: PropertyDefinition[] = [
    { key: 'a', label: 'A', type: 'text' },
    { key: 'b', label: 'B', type: 'text' },
    { key: 'c', label: 'C', type: 'text' },
  ]

  it('按清单排列', () => {
    expect(sortByOrder(items, ['c', 'a', 'b']).map((d) => d.key)).toEqual(['c', 'a', 'b'])
  })

  it('没有清单时保持原顺序', () => {
    expect(sortByOrder(items, undefined).map((d) => d.key)).toEqual(['a', 'b', 'c'])
  })

  /** 新增的属性还没进过清单，不该因此消失或乱序 */
  it('不在清单里的排在后面并保持相对顺序', () => {
    expect(sortByOrder(items, ['c']).map((d) => d.key)).toEqual(['c', 'a', 'b'])
  })

  it('清单里的陈旧 key 不影响结果', () => {
    expect(sortByOrder(items, ['已删除', 'b', 'a', 'c']).map((d) => d.key)).toEqual(['b', 'a', 'c'])
  })
})

describe('顺序的持久化', () => {
  let fs: MemoryAdapter
  let service: PropertiesService

  beforeEach(() => {
    fs = new MemoryAdapter()
    service = new PropertiesService(fs)
  })

  /**
   * 未改动的内置属性不落盘（见 isPristineBuiltin），因此顺序必须单独记，
   * 否则调整完一重载就跳回默认位置。
   */
  it('调整内置属性的顺序后，重新加载仍保持', async () => {
    const before = (await service.load()).map((d) => d.key)
    expect(before).toEqual(['tags', 'created', 'updated'])

    await service.move('updated', -1)
    expect((await service.load()).map((d) => d.key)).toEqual(['tags', 'updated', 'created'])
  })

  it('新增的属性排在末尾，且不打乱已有顺序', async () => {
    await service.move('updated', -2)
    await service.add({ key: 'status', label: '状态', type: 'text' })

    expect((await service.load()).map((d) => d.key)).toEqual(['updated', 'tags', 'created', 'status'])
  })

  it('老配置文件没有 order 字段时不报错', async () => {
    await fs.writeText(
      PROPERTIES_CONFIG_PATH,
      JSON.stringify({ version: 1, definitions: [{ key: 'x', label: 'X', type: 'text' }] }),
    )
    expect((await service.load()).map((d) => d.key)).toContain('x')
  })
})

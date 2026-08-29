import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { flattenTree, scanTree } from './tree'
import { parseSidebarOrder, SIDEBAR_ORDER_PATH, SidebarOrderService } from './sidebar-order'

describe('SidebarOrderService', () => {
  let fs: MemoryAdapter

  beforeEach(async () => {
    fs = new MemoryAdapter()
    await fs.writeText('a.md', '')
    await fs.writeText('b.md', '')
    await fs.writeText('c.md', '')
    await fs.writeText('目录/x.md', '')
    await fs.writeText('目录/y.md', '')
  })

  it('没有配置时保留磁盘默认顺序', async () => {
    const service = new SidebarOrderService(fs)
    await service.load()
    expect(service.apply(await scanTree(fs)).map((node) => node.path)).toEqual(['目录', 'a.md', 'b.md', 'c.md'])
  })

  it('持久化根目录与子目录的独立顺序', async () => {
    const service = new SidebarOrderService(fs)
    await service.load()
    let tree = service.apply(await scanTree(fs))
    await service.reorder(tree, 'c.md', 'a.md', 'before')
    tree = service.apply(tree)
    await service.reorder(tree, '目录/y.md', '目录/x.md', 'before')
    const restored = new SidebarOrderService(fs)
    await restored.load()
    const ordered = restored.apply(await scanTree(fs))
    expect(ordered.map((node) => node.path)).toEqual(['目录', 'c.md', 'a.md', 'b.md'])
    expect(ordered[0]?.children?.map((node) => node.path)).toEqual(['目录/y.md', '目录/x.md'])
  })

  it('外部新增条目追加在显式顺序之后且不会消失', async () => {
    const service = new SidebarOrderService(fs)
    await service.load()
    await service.reorder(await scanTree(fs), 'b.md', 'a.md', 'before')
    await fs.writeText('d.md', '')
    expect(service.apply(await scanTree(fs)).map((node) => node.path)).toEqual([
      '目录', 'b.md', 'a.md', 'c.md', 'd.md',
    ])
  })

  it('目录改名后保留根位置和子树顺序', async () => {
    const service = new SidebarOrderService(fs)
    await service.load()
    let tree = await scanTree(fs)
    await service.reorder(tree, 'c.md', '目录', 'before')
    await service.reorder(tree, '目录/y.md', '目录/x.md', 'before')
    await fs.move('目录', '项目')
    await service.remap('目录', '项目')
    tree = service.apply(await scanTree(fs))
    expect(tree.map((node) => node.path)).toEqual(['c.md', '项目', 'a.md', 'b.md'])
    expect(flattenTree(tree).map((node) => node.path)).toContain('项目/y.md')
    expect(tree[1]?.children?.map((node) => node.path)).toEqual(['项目/y.md', '项目/x.md'])
  })

  it('损坏配置不阻断加载，下一次排序用 V1 覆盖', async () => {
    await fs.writeText(SIDEBAR_ORDER_PATH, '{坏 JSON')
    const service = new SidebarOrderService(fs)
    await service.load()
    const tree = service.apply(await scanTree(fs))
    await service.reorder(tree, 'b.md', 'a.md', 'before')
    expect(JSON.parse(await fs.readText(SIDEBAR_ORDER_PATH))).toMatchObject({ version: 1 })
  })
})

describe('parseSidebarOrder', () => {
  it('拒绝非 V1，并清理跨父目录与重复条目', () => {
    expect(() => parseSidebarOrder({ version: 2, parents: {} })).toThrow()
    expect(parseSidebarOrder({ version: 1, parents: { notes: ['notes/a.md', 'other/b.md', 'notes/a.md'] } }))
      .toEqual({ version: 1, parents: { notes: ['notes/a.md'] } })
  })
})

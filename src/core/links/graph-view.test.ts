import { describe, expect, it } from 'vitest'
import { buildGraphView, isMissingNode } from './graph-view'
import { buildLinkGraph } from './link-graph'

const VAULT = [
  { path: '甲.md', content: '甲提到 [[乙]] 和 [[丙]]。' },
  { path: '乙.md', content: '乙提到 [[丙]]，还提到 [[还没写的]]。' },
  { path: '丙.md', content: '丙谁也不提。' },
  { path: '孤岛.md', content: '和谁都没关系。' },
]

const PATHS = VAULT.map((note) => note.path)

function view(options: Parameters<typeof buildGraphView>[1] = { paths: PATHS }) {
  return buildGraphView(buildLinkGraph(VAULT), options)
}

describe('buildGraphView', () => {
  it('每篇笔记一个节点', () => {
    expect(view().nodes.map((node) => node.id).sort()).toEqual([...PATHS].sort())
  })

  it('标签去掉目录与扩展名', () => {
    const graph = buildLinkGraph([{ path: '归档/长长的笔记.md', content: '' }])
    const nodes = buildGraphView(graph, { paths: ['归档/长长的笔记.md'] }).nodes
    expect(nodes[0]?.label).toBe('长长的笔记')
  })

  it('边按链接方向连接', () => {
    const edges = view().edges.map((edge) => `${edge.source}->${edge.target}`)
    expect(edges.sort()).toEqual(['甲.md->丙.md', '甲.md->乙.md', '乙.md->丙.md'].sort())
  })

  /** 同一对笔记之间多次引用，画多条线既看不出区别，还会把布局挤开 */
  it('同一对笔记之间只画一条边', () => {
    const graph = buildLinkGraph([
      { path: 'a.md', content: '[[b]] 又 [[b|另一种说法]] 再 [[b]]' },
      { path: 'b.md', content: '' },
    ])
    expect(buildGraphView(graph, { paths: ['a.md', 'b.md'] }).edges).toHaveLength(1)
  })

  it('度数统计进出两个方向', () => {
    const nodes = new Map(view().nodes.map((node) => [node.id, node.degree]))
    expect(nodes.get('甲.md')).toBe(2) // 出 2
    expect(nodes.get('丙.md')).toBe(2) // 入 2
    expect(nodes.get('乙.md')).toBe(2) // 入 1 出 1
    expect(nodes.get('孤岛.md')).toBe(0)
  })

  it('默认显示孤立笔记——否则用户看不到全貌', () => {
    expect(view().nodes.map((node) => node.id)).toContain('孤岛.md')
  })

  it('关掉孤立笔记后图里只剩有关系的部分', () => {
    const nodes = view({ paths: PATHS, includeOrphans: false }).nodes.map((node) => node.id)
    expect(nodes).not.toContain('孤岛.md')
    expect(nodes).toContain('甲.md')
  })

  it('默认不画尚未创建的笔记', () => {
    expect(view().nodes.some((node) => node.missing)).toBe(false)
  })

  it('开启后尚未创建的笔记成为独立节点', () => {
    const result = view({ paths: PATHS, includeMissing: true })
    const missing = result.nodes.filter((node) => node.missing)

    expect(missing).toHaveLength(1)
    expect(missing[0]?.label).toBe('还没写的')
    expect(result.edges.some((edge) => edge.source === '乙.md' && edge.target === missing[0]!.id)).toBe(true)
  })

  it('未创建节点的 id 不会与真实路径撞车', () => {
    const result = view({ paths: PATHS, includeMissing: true })
    for (const node of result.nodes) {
      expect(isMissingNode(node.id)).toBe(node.missing)
    }
  })

  /**
   * 边指向被过滤掉的节点时必须一并剔除，
   * 否则渲染库会为这些悬空的边凭空补出节点——图上会冒出没有标签的圆点。
   */
  it('每条边的两端都必须在节点集合里', () => {
    for (const options of [
      { paths: PATHS },
      { paths: PATHS, includeOrphans: false },
      { paths: PATHS, includeMissing: true },
      { paths: PATHS, includeOrphans: false, includeMissing: true },
    ]) {
      const result = view(options)
      const ids = new Set(result.nodes.map((node) => node.id))
      for (const edge of result.edges) {
        expect(ids.has(edge.source)).toBe(true)
        expect(ids.has(edge.target)).toBe(true)
      }
    }
  })

  /** 自环绕回自己，占位置又不提供关系信息；数据层记录它是为了反向链接面板 */
  it('自环不画进图谱', () => {
    const graph = buildLinkGraph([{ path: '自恋.md', content: '引用 [[自恋]] 自己。' }])
    const result = buildGraphView(graph, { paths: ['自恋.md'] })

    expect(result.edges).toEqual([])
    expect(result.nodes.map((node) => node.id)).toEqual(['自恋.md'])
    expect(result.nodes[0]?.degree).toBe(0)
  })

  it('空工作区产出空图而不是报错', () => {
    const result = buildGraphView(buildLinkGraph([]), { paths: [] })
    expect(result).toEqual({ nodes: [], edges: [], selfLinks: 0 })
  })
})

describe('selfLinks 计数', () => {
  /**
   * 只有自引用的工作区会得到「N 篇 · 0 条链接」。
   * 用户明明写了链接，看到 0 只会以为图谱坏了——这个困惑真实发生过两次，
   * 因此不画自环可以，一声不吭地把它变没不行。
   */
  it('报出被滤掉的自环篇数', () => {
    const graph = buildLinkGraph([
      { path: '自恋.md', content: '引用 [[自恋]] 自己。' },
      { path: '另一篇.md', content: '也引用 [[另一篇]] 自己。' },
    ])
    const result = buildGraphView(graph, { paths: ['自恋.md', '另一篇.md'] })

    expect(result.edges).toEqual([])
    expect(result.selfLinks).toBe(2)
  })

  it('同一篇里多次自引用只算一篇', () => {
    const graph = buildLinkGraph([{ path: 'a.md', content: '[[a]] 与 [[a|又一次]]' }])
    expect(buildGraphView(graph, { paths: ['a.md'] }).selfLinks).toBe(1)
  })

  it('没有自引用时为 0', () => {
    expect(view().selfLinks).toBe(0)
  })

  /** 节点都被过滤掉了，就不该再提示「有自环被隐藏」——用户根本看不到那篇 */
  it('自引用的笔记被孤立点过滤掉后不计入', () => {
    const graph = buildLinkGraph([{ path: '自恋.md', content: '引用 [[自恋]] 自己。' }])
    const result = buildGraphView(graph, { paths: ['自恋.md'], includeOrphans: false })

    expect(result.nodes).toEqual([])
    expect(result.selfLinks).toBe(0)
  })
})

describe('局部知识图谱', () => {
  const chain = [
    { path: '甲.md', content: '[[乙]]' },
    { path: '乙.md', content: '[[丙]]' },
    { path: '丙.md', content: '[[丁]]' },
    { path: '丁.md', content: '' },
    { path: '来访者.md', content: '[[甲]]' },
    { path: '孤岛.md', content: '' },
  ]
  const paths = chain.map((note) => note.path)
  const graph = buildLinkGraph(chain)

  it('1 跳同时包含当前笔记的正向与反向邻居', () => {
    const result = buildGraphView(graph, { paths, center: '甲.md', depth: 1 })
    expect(result.nodes.map((node) => node.id).sort()).toEqual(['乙.md', '来访者.md', '甲.md'].sort())
    expect(result.edges.map((edge) => edge.id).sort()).toEqual(['来访者.md->甲.md', '甲.md->乙.md'].sort())
  })

  it('2–3 跳按最短距离逐层展开', () => {
    expect(buildGraphView(graph, { paths, center: '甲.md', depth: 2 }).nodes.map((node) => node.id).sort())
      .toEqual(['丙.md', '乙.md', '来访者.md', '甲.md'].sort())
    expect(buildGraphView(graph, { paths, center: '甲.md', depth: 3 }).nodes.map((node) => node.id).sort())
      .toEqual(['丁.md', '丙.md', '乙.md', '来访者.md', '甲.md'].sort())
  })

  it('孤立的中心笔记仍会显示，但不会带入其它孤岛', () => {
    const result = buildGraphView(graph, { paths, center: '孤岛.md', depth: 3 })
    expect(result.nodes.map((node) => node.id)).toEqual(['孤岛.md'])
    expect(result.edges).toEqual([])
  })

  it('局部节点大小只反映当前可见范围内的连接数', () => {
    const result = buildGraphView(graph, { paths, center: '甲.md', depth: 1 })
    const degrees = new Map(result.nodes.map((node) => [node.id, node.degree]))
    expect(degrees.get('甲.md')).toBe(2)
    expect(degrees.get('乙.md')).toBe(1)
    expect(degrees.get('来访者.md')).toBe(1)
  })

  it('开启尚未创建节点后，它也遵守跳数边界', () => {
    const missingGraph = buildLinkGraph([
      { path: '甲.md', content: '[[乙]]' },
      { path: '乙.md', content: '[[还没写]]' },
    ])
    const one = buildGraphView(missingGraph, {
      paths: ['甲.md', '乙.md'], center: '甲.md', depth: 1, includeMissing: true,
    })
    const two = buildGraphView(missingGraph, {
      paths: ['甲.md', '乙.md'], center: '甲.md', depth: 2, includeMissing: true,
    })
    expect(one.nodes.some((node) => node.missing)).toBe(false)
    expect(two.nodes.some((node) => node.missing)).toBe(true)
  })

  it('中心路径不存在时返回空视图', () => {
    expect(buildGraphView(graph, { paths, center: '不存在.md', depth: 1 }))
      .toEqual({ nodes: [], edges: [], selfLinks: 0 })
  })
})

import { describe, expect, it } from 'vitest'
import { backlinksOf, buildLinkGraph, edgesBetween, forwardLinksOf } from './link-graph'

const VAULT = [
  { path: '甲.md', content: '甲提到 [[乙]] 和 [[丙]]。' },
  { path: '乙.md', content: '乙也提到 [[丙]]，还提到 [[还没写的]]。' },
  { path: '丙.md', content: '丙谁也不提。' },
]

describe('buildLinkGraph', () => {
  it('正向链接', () => {
    const graph = buildLinkGraph(VAULT)
    expect(forwardLinksOf(graph, '甲.md')).toEqual(['乙.md', '丙.md'])
    expect(forwardLinksOf(graph, '丙.md')).toEqual([])
  })

  it('反向链接', () => {
    const graph = buildLinkGraph(VAULT)
    expect(backlinksOf(graph, '丙.md')).toEqual(['甲.md', '乙.md'])
    expect(backlinksOf(graph, '甲.md')).toEqual([])
  })

  /** 正反两向必须互为镜像，否则面板与图谱会各说各话 */
  it('正反向严格互为镜像', () => {
    const graph = buildLinkGraph(VAULT)
    for (const [from, tos] of graph.outgoing) {
      for (const to of tos) {
        expect(backlinksOf(graph, to)).toContain(from)
      }
    }
    for (const [to, froms] of graph.incoming) {
      for (const from of froms) {
        expect(forwardLinksOf(graph, from)).toContain(to)
      }
    }
  })

  it('指向不存在的笔记进入 unresolved，而不是被丢掉', () => {
    const graph = buildLinkGraph(VAULT)
    expect(graph.unresolved.get('还没写的')).toEqual(['乙.md'])
    // 也不该混进正常的边里
    expect(graph.edges.some((edge) => edge.to.includes('还没写的'))).toBe(false)
  })

  it('同一篇里重复链接同一目标只算一条边关系，但保留每处出处', () => {
    const graph = buildLinkGraph([
      { path: 'a.md', content: '开头 [[b]]，中间 [[b|另一种说法]]，结尾 [[b]]。' },
      { path: 'b.md', content: '' },
    ])
    expect(forwardLinksOf(graph, 'a.md')).toEqual(['b.md'])
    expect(backlinksOf(graph, 'b.md')).toEqual(['a.md'])
    expect(edgesBetween(graph, 'a.md', 'b.md')).toHaveLength(3)
    expect(edgesBetween(graph, 'a.md', 'b.md')[1]?.ref.label).toBe('另一种说法')
  })

  /**
   * 自引用如实记录。
   * 曾经在这里过滤掉它，理由是「自环在图谱里没意义」——那是拿展示层的需要
   * 去改数据层的事实：用户在笔记里写了 `[[本篇]]`，面板却回他
   * 「还没有笔记链接到这篇」。要不要画自环是 buildGraphView 的事。
   */
  it('自引用照常入图——过滤是展示层的决定', () => {
    const graph = buildLinkGraph([{ path: '自恋.md', content: '我引用 [[自恋]] 自己。' }])
    expect(forwardLinksOf(graph, '自恋.md')).toEqual(['自恋.md'])
    expect(backlinksOf(graph, '自恋.md')).toEqual(['自恋.md'])
    expect(graph.edges).toHaveLength(1)
  })

  it('纯锚点链接是篇内跳转，不构成笔记之间的边', () => {
    const graph = buildLinkGraph([{ path: 'a.md', content: '见 [[#结论]] 一节。' }])
    expect(graph.edges).toHaveLength(0)
    expect(graph.unresolved.size).toBe(0)
  })

  it('代码块里的链接不入图', () => {
    const graph = buildLinkGraph([
      { path: 'a.md', content: ['真的 [[b]]', '```', '假的 [[c]]', '```'].join('\n') },
      { path: 'b.md', content: '' },
      { path: 'c.md', content: '' },
    ])
    expect(forwardLinksOf(graph, 'a.md')).toEqual(['b.md'])
    expect(backlinksOf(graph, 'c.md')).toEqual([])
  })

  it('带锚点的链接仍然指向该笔记', () => {
    const graph = buildLinkGraph([
      { path: 'a.md', content: '见 [[b#某节]]。' },
      { path: 'b.md', content: '' },
    ])
    expect(forwardLinksOf(graph, 'a.md')).toEqual(['b.md'])
    expect(edgesBetween(graph, 'a.md', 'b.md')[0]?.ref.hash).toBe('某节')
  })

  it('空工作区不报错', () => {
    const graph = buildLinkGraph([])
    expect(graph.edges).toEqual([])
    expect(backlinksOf(graph, '任意.md')).toEqual([])
  })
})

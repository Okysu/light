import { describe, expect, it } from 'vitest'
import {
  buildTagTree,
  findTagNode,
  normalizeTagPath,
  tagBelongsTo,
  tagPathPrefixes,
} from './hierarchy'

describe('标签路径', () => {
  it('规范化空层级和层级两侧空白', () => {
    expect(normalizeTagPath(' / 工作 / / Light / 同步 / ')).toBe('工作/Light/同步')
    expect(normalizeTagPath('///')).toBe('')
  })

  it('列出从根到自身的完整前缀', () => {
    expect(tagPathPrefixes('工作/Light/同步')).toEqual(['工作', '工作/Light', '工作/Light/同步'])
  })

  it('父分组匹配自身与后代，但不匹配相似前缀', () => {
    expect(tagBelongsTo('工作/Light', '工作')).toBe(true)
    expect(tagBelongsTo('工作', '工作')).toBe(true)
    expect(tagBelongsTo('工作台', '工作')).toBe(false)
  })
})

describe('buildTagTree', () => {
  const tree = buildTagTree([
    { tag: '工作/Light/同步', paths: ['sync.md', 'shared.md'] },
    { tag: '工作/Light/编辑器', paths: ['editor.md', 'shared.md'] },
    { tag: '工作', paths: ['root.md'] },
    { tag: '生活/旅行', paths: ['travel.md'] },
  ])

  it('生成缺失的父分组并保留完整路径', () => {
    expect(tree.map((node) => node.tag)).toEqual(['工作', '生活'])
    expect(findTagNode(tree, '工作/Light')?.children.map((node) => node.label)).toEqual(['编辑器', '同步'])
  })

  it('父分组聚合全部后代路径且去重', () => {
    expect(findTagNode(tree, '工作')?.paths.sort()).toEqual([
      'editor.md',
      'root.md',
      'shared.md',
      'sync.md',
    ])
    expect(findTagNode(tree, '工作')?.directPaths).toEqual(['root.md'])
  })

  it('按聚合数量降序、同数量按中文名称排序', () => {
    expect(findTagNode(tree, '工作/Light')?.children.map((node) => node.label)).toEqual(['编辑器', '同步'])
  })
})

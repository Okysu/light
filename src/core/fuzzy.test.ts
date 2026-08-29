import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from './fuzzy'

describe('fuzzyScore', () => {
  it('完全不匹配返回 null', () => {
    expect(fuzzyScore('会议纪要', 'xyz')).toBeNull()
  })

  it('空查询得分为 0（视为全部匹配）', () => {
    expect(fuzzyScore('任意', '')).toBe(0)
  })

  it('直接包含的得分高于跳跃匹配', () => {
    const direct = fuzzyScore('project notes', 'notes')!
    const scattered = fuzzyScore('nifty octopus tessellation', 'notes')!
    expect(direct).toBeGreaterThan(scattered)
  })

  it('越靠前命中得分越高', () => {
    expect(fuzzyScore('notes about x', 'notes')!).toBeGreaterThan(fuzzyScore('x about notes', 'notes')!)
  })

  it('大小写不敏感', () => {
    expect(fuzzyScore('README', 'readme')).not.toBeNull()
  })

  it('支持中文子串', () => {
    expect(fuzzyScore('周一会议纪要', '会议')).not.toBeNull()
    expect(fuzzyScore('周一会议纪要', '纪周')).toBeNull()
  })

  it('按序跳跃匹配可命中，乱序不可', () => {
    expect(fuzzyScore('project-alpha-notes', 'pan')).not.toBeNull()
    expect(fuzzyScore('project-alpha-notes', 'npa')).toBeNull()
  })

  it('同样命中时较短文本得分更高', () => {
    expect(fuzzyScore('notes', 'notes')!).toBeGreaterThan(fuzzyScore('notes of the whole year', 'notes')!)
  })
})

describe('fuzzyFilter', () => {
  const items = ['会议纪要', '项目计划', '读书笔记', 'project-notes']

  it('空查询返回全部且保持原顺序', () => {
    expect(fuzzyFilter(items, '  ', (x) => x)).toEqual(items)
  })

  it('过滤掉不匹配项', () => {
    expect(fuzzyFilter(items, '会议', (x) => x)).toEqual(['会议纪要'])
  })

  it('按相关度排序', () => {
    const result = fuzzyFilter(['my notes archive', 'notes'], 'notes', (x) => x)
    expect(result[0]).toBe('notes')
  })

  it('用 toText 取字段', () => {
    const objects = [{ title: '甲' }, { title: '乙' }]
    expect(fuzzyFilter(objects, '乙', (x) => x.title)).toEqual([{ title: '乙' }])
  })
})

import { describe, expect, it } from 'vitest'
import { parseDocument, readStringArray, stringifyDocument } from './frontmatter'

describe('parseDocument', () => {
  it('拆分 frontmatter 与正文', () => {
    const { data, content } = parseDocument('---\ntitle: 周报\ntags: [work]\n---\n# 正文\n')
    expect(data).toEqual({ title: '周报', tags: ['work'] })
    expect(content).toBe('# 正文\n')
  })

  it('无 frontmatter 时整篇都是正文', () => {
    const { data, content } = parseDocument('# 只有正文')
    expect(data).toEqual({})
    expect(content).toBe('# 只有正文')
  })

  it('YAML 非法时降级为纯正文，不让笔记打不开', () => {
    const raw = '---\ntitle: [未闭合\n---\n正文'
    expect(parseDocument(raw)).toEqual({ data: {}, content: raw })
  })

  it('文件中间出现的 --- 不会被误认为 frontmatter', () => {
    const raw = '正文开头\n---\ntitle: 假的\n---\n'
    expect(parseDocument(raw).data).toEqual({})
  })

  it('兼容 CRLF 换行的文件', () => {
    expect(parseDocument('---\r\ntitle: 周报\r\n---\r\n正文').data).toEqual({ title: '周报' })
  })
})

describe('stringifyDocument', () => {
  it('往返后未知字段原样保留（可迁移性保障）', () => {
    const raw = '---\ntitle: 周报\nobsidian-custom: 保留我\n---\n正文\n'
    const parsed = parseDocument(raw)
    const output = parseDocument(stringifyDocument(parsed))
    expect(output.data['obsidian-custom']).toBe('保留我')
    expect(output.content).toBe('正文\n')
  })

  it('空 frontmatter 不写出多余的 --- 头', () => {
    expect(stringifyDocument({ data: {}, content: '正文' })).toBe('正文')
  })
})

describe('readStringArray', () => {
  it('兼容 Obsidian 的字符串简写与数组写法', () => {
    expect(readStringArray({ tags: 'a b,c' }, 'tags')).toEqual(['a', 'b', 'c'])
    expect(readStringArray({ tags: ['a', 1, 'b'] }, 'tags')).toEqual(['a', 'b'])
    expect(readStringArray({}, 'tags')).toEqual([])
  })
})

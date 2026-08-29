import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { SearchService, locateQuery, locateRegex, locateTerms, mergeRanges } from './search-service'
import { tokenize } from './tokenizer'

describe('tokenize', () => {
  it('中文按词切分，而不是整句当一个词', () => {
    const tokens = tokenize('周一会议纪要')
    expect(tokens.length).toBeGreaterThan(1)
  })

  it('长中文词补出二元组，保证子串也能命中', () => {
    // 「时钟同步」若被切成一个词，搜「同步」必须仍能匹配
    expect(tokenize('时钟同步')).toContain('同步')
  })

  it('单个汉字保留，单个西文字母丢弃', () => {
    expect(tokenize('猫')).toEqual(['猫'])
    expect(tokenize('a')).toEqual([])
  })

  it('西文按词切分并转小写', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world'])
  })

  it('空输入返回空数组', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('mergeRanges', () => {
  it('合并重叠区间，避免高亮嵌套', () => {
    expect(mergeRanges([{ start: 0, end: 5 }, { start: 3, end: 8 }])).toEqual([{ start: 0, end: 8 }])
  })

  it('相邻但不重叠的区间保持独立', () => {
    const ranges = [{ start: 0, end: 2 }, { start: 5, end: 7 }]
    expect(mergeRanges(ranges)).toEqual(ranges)
  })
})

describe('locateTerms', () => {
  it('定位全部出现位置，大小写不敏感', () => {
    expect(locateTerms('Cat and cat', ['cat'])).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ])
  })

  it('中文定位', () => {
    expect(locateTerms('会议纪要与会议记录', ['会议'])).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ])
  })
})

describe('locateRegex', () => {
  it('零宽匹配不会造成死循环', () => {
    expect(locateRegex('abc', /x*/g)).toEqual([])
  })

  it('定位正则命中', () => {
    expect(locateRegex('a1b22c', /\d+/g)).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 5 },
    ])
  })
})

describe('SearchService', () => {
  let fs: MemoryAdapter
  let search: SearchService

  beforeEach(async () => {
    fs = new MemoryAdapter()
    await fs.writeText(
      'notes/会议.md',
      '---\ntitle: 周一会议纪要\ntags: [工作]\n---\n讨论了时钟同步方案，决定采用 Chrony。',
    )
    await fs.writeText(
      'notes/项目/计划.md',
      '---\ntitle: 项目计划\ntags: [工作, 计划]\n---\n本季度重点是数据采集与同步。',
    )
    await fs.writeText('随笔.md', '---\ntitle: 随笔\n---\n今天天气不错，读了一本书。')

    search = new SearchService(fs)
    await search.build()
  })

  it('索引覆盖全部笔记', () => {
    expect(search.isReady).toBe(true)
    expect(search.size).toBe(3)
  })

  it('搜索正文而不只是标题', () => {
    const hits = search.search('Chrony')
    expect(hits.map((hit) => hit.path)).toEqual(['notes/会议.md'])
  })

  it('中文正文可被子串命中', () => {
    const hits = search.search('同步')
    expect(hits.map((hit) => hit.path).sort()).toEqual(['notes/会议.md', 'notes/项目/计划.md'])
  })

  it('标题命中排在正文命中之前', () => {
    const hits = search.search('计划')
    expect(hits[0]?.path).toBe('notes/项目/计划.md')
  })

  it('按标签检索', () => {
    expect(search.search('工作').length).toBeGreaterThan(0)
  })

  it('返回可高亮的片段与区间', () => {
    const hit = search.search('Chrony')[0]!
    expect(hit.snippet).toContain('Chrony')
    expect(hit.ranges.length).toBeGreaterThan(0)

    // 区间必须落在片段内，且切出来的正是命中词
    const range = hit.ranges[0]!
    expect(hit.snippet.slice(range.start, range.end).toLowerCase()).toContain('chrony')
  })

  it('限定目录范围', () => {
    const hits = search.search('同步', { scope: 'notes/项目' })
    expect(hits.map((hit) => hit.path)).toEqual(['notes/项目/计划.md'])
  })

  it('无匹配时返回空', () => {
    expect(search.search('不存在的词汇xyz')).toEqual([])
  })

  it('空查询返回空', () => {
    expect(search.search('   ')).toEqual([])
  })

  describe('正则搜索', () => {
    it('按正则匹配正文', () => {
      const hits = search.search('时钟\\w*', { regex: true })
      expect(hits.map((hit) => hit.path)).toEqual(['notes/会议.md'])
    })

    it('默认忽略大小写，可显式区分', () => {
      expect(search.search('chrony', { regex: true }).length).toBe(1)
      expect(search.search('chrony', { regex: true, caseSensitive: true }).length).toBe(0)
    })

    it('非法正则返回空而不是抛错（用户边打边搜时必然出现）', () => {
      expect(() => search.search('[unclosed', { regex: true })).not.toThrow()
      expect(search.search('[unclosed', { regex: true })).toEqual([])
    })

    it('正则命中同样给出高亮区间', () => {
      const hit = search.search('Chr\\w+', { regex: true })[0]!
      expect(hit.ranges.length).toBeGreaterThan(0)
      expect(hit.snippet.slice(hit.ranges[0]!.start, hit.ranges[0]!.end)).toBe('Chrony')
    })
  })

  describe('增量更新', () => {
    it('改动后可搜到新内容、搜不到旧内容', async () => {
      await fs.writeText('notes/会议.md', '---\ntitle: 周一会议纪要\n---\n改为使用 NTP 方案。')
      await search.update('notes/会议.md')

      expect(search.search('Chrony')).toEqual([])
      expect(search.search('NTP').map((hit) => hit.path)).toEqual(['notes/会议.md'])
    })

    it('删除后不再出现在结果中', () => {
      search.remove('notes/会议.md')
      expect(search.search('Chrony')).toEqual([])
      expect(search.size).toBe(2)
    })

    it('重复删除不抛错', () => {
      search.remove('notes/会议.md')
      expect(() => search.remove('notes/会议.md')).not.toThrow()
    })
  })
})

describe('locateQuery', () => {
  it('完整查询串存在时只定位它，不被短词元带偏', () => {
    // 「化」在前面偶然出现，但完整串在后面——必须定位到完整串
    const text = '虚拟化环境说明。后面才是启动持久化服务的部分。'
    const ranges = locateQuery(text, '启动持久化')

    expect(ranges).toHaveLength(1)
    expect(text.slice(ranges[0]!.start, ranges[0]!.end)).toBe('启动持久化')
  })

  it('完整串不存在时退到分词词元', () => {
    const text = '本文讨论时钟同步与数据采集。'
    const ranges = locateQuery(text, '时钟 采集')
    expect(ranges.length).toBeGreaterThan(0)
  })

  it('退化时丢弃单字词元，避免命中无关位置', () => {
    // 「化」单独出现多次，但查询的完整串不在文中，且无 ≥2 字词元可用
    expect(locateQuery('虚拟化、数字化、现代化', '化x')).toEqual([])
  })

  it('查询本身是单字时仍可定位', () => {
    expect(locateQuery('一只猫', '猫')).toEqual([{ start: 2, end: 3 }])
  })

  it('空查询返回空', () => {
    expect(locateQuery('任意文本', '  ')).toEqual([])
  })
})

describe('片段定位', () => {
  it('选匹配最密集处，而不是正文里偶然出现的第一处', async () => {
    const fs = new MemoryAdapter()
    // 「化」在开头偶然出现，真正相关的段落在后面
    await fs.writeText(
      'a.md',
      '---\ntitle: 部署\n---\n本文介绍虚拟化环境的准备工作。\n' +
        '中间还有很多无关内容需要跳过，占位占位占位占位占位。\n' +
        '启动持久化服务：执行 systemctl enable 即可完成启动持久化配置。',
    )

    const service = new SearchService(fs)
    await service.build()

    const hit = service.search('启动持久化')[0]!
    expect(hit.snippet).toContain('启动持久化')
    expect(hit.ranges.length).toBeGreaterThan(0)
    expect(hit.snippet.slice(hit.ranges[0]!.start, hit.ranges[0]!.end)).toBe('启动持久化')
  })
})

describe('看板与画板进索引（11.1）', () => {
  it('搜得到看板卡片的标题，命中的是那个 .board 文件', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText(
      '规划.board',
      JSON.stringify({
        version: 1,
        kind: 'board',
        columns: [
          { id: 'a', title: '进行中', cards: [{ id: 'c1', title: '修复导出乱码', tags: ['紧急'] }] },
        ],
      }),
    )

    const service = new SearchService(fs)
    await service.build()

    const hit = service.search('导出乱码')[0]
    expect(hit?.path).toBe('规划.board')
    expect(hit?.kind).toBe('board')
    expect(hit?.tags).toContain('紧急')
  })

  it('搜得到画板便利贴上的字', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText(
      '草图.canvas',
      JSON.stringify({
        version: 1,
        kind: 'canvas',
        shapes: [
          { id: 's1', kind: 'note', x: 0, y: 0, width: 100, height: 60, text: '记得补索引测试' },
        ],
      }),
    )

    const service = new SearchService(fs)
    await service.build()

    const hit = service.search('补索引')[0]
    expect(hit?.path).toBe('草图.canvas')
    expect(hit?.kind).toBe('canvas')
  })

  it('JSON 的结构字段不会成为可搜内容', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText(
      '空板.board',
      JSON.stringify({ version: 1, kind: 'board', columns: [{ id: 'strokeWidth', title: '列', cards: [] }] }),
    )

    const service = new SearchService(fs)
    await service.build()

    // 搜 JSON 里的字段名不该命中，否则片段里显示的是谁也读不懂的东西
    expect(service.search('strokeWidth')).toEqual([])
  })

  it('坏掉的看板文件不会让整个索引建不起来', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText('坏的.board', '{ 这不是 JSON')
    await fs.writeText('好的.md', '---\ntitle: 正常\n---\n内容照旧')

    const service = new SearchService(fs)
    await service.build()

    expect(service.search('内容照旧')[0]?.path).toBe('好的.md')
  })
})

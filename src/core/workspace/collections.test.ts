import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { collectFavorites, collectRecentlyEdited, collectTags } from './collections'

describe('collectTags', () => {
  let fs: MemoryAdapter

  beforeEach(async () => {
    fs = new MemoryAdapter()
    await fs.writeText('a.md', '---\ntitle: 甲\ntags: [工作, 会议]\n---\n正文')
    await fs.writeText('notes/b.md', '---\ntitle: 乙\ntags: [工作]\n---\n正文')
    await fs.writeText('notes/c.md', '---\ntitle: 丙\ntags: [生活]\n---\n正文')
    await fs.writeText('d.md', '---\ntitle: 丁\n---\n没有标签')
  })

  it('聚合标签及其笔记路径', async () => {
    const tags = await collectTags(fs)
    const work = tags.find((entry) => entry.tag === '工作')

    expect(work?.paths.sort()).toEqual(['a.md', 'notes/b.md'])
  })

  it('按使用数量降序排列', async () => {
    const tags = await collectTags(fs)
    expect(tags[0]?.tag).toBe('工作')
    expect(tags[0]?.paths).toHaveLength(2)
  })

  it('无标签的笔记不产生条目', async () => {
    const tags = await collectTags(fs)
    expect(tags.flatMap((entry) => entry.paths)).not.toContain('d.md')
  })

  it('同一篇里重复写的标签只记一次', async () => {
    await fs.writeText('e.md', '---\ntitle: 戊\ntags: [重复, 重复]\n---\n正文')
    const entry = (await collectTags(fs)).find((item) => item.tag === '重复')
    expect(entry?.paths).toHaveLength(1)
  })

  it('忽略空白标签', async () => {
    await fs.writeText('f.md', '---\ntitle: 己\ntags: ["  ", 有效]\n---\n正文')
    const tags = (await collectTags(fs)).map((entry) => entry.tag)
    expect(tags).toContain('有效')
    expect(tags.some((tag) => tag.trim() === '')).toBe(false)
  })

  it('规范化斜杠层级并合并等价标签', async () => {
    await fs.writeText('e.md', '---\ntitle: 戊\ntags: [" 工作 / Light / 同步 "]\n---\n正文')
    await fs.writeText('f.md', '---\ntitle: 己\ntags: [工作/Light/同步]\n---\n正文')

    const entry = (await collectTags(fs)).find((item) => item.tag === '工作/Light/同步')
    expect(entry?.paths.sort()).toEqual(['e.md', 'f.md'])
  })

  it('空工作区返回空列表', async () => {
    expect(await collectTags(new MemoryAdapter())).toEqual([])
  })
})

describe('collectRecentlyEdited', () => {
  it('按 frontmatter.updated 倒序', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText('old.md', '---\ntitle: 旧\nupdated: 2026-01-01T00:00:00.000Z\n---\n')
    await fs.writeText('new.md', '---\ntitle: 新\nupdated: 2026-08-01T00:00:00.000Z\n---\n')
    await fs.writeText('mid.md', '---\ntitle: 中\nupdated: 2026-05-01T00:00:00.000Z\n---\n')

    expect((await collectRecentlyEdited(fs)).map((note) => note.title)).toEqual(['新', '中', '旧'])
  })

  it('缺少 updated 时回落到文件系统修改时间', async () => {
    let clock = 1_000
    const fs = new MemoryAdapter(() => clock)
    await fs.writeText('first.md', '---\ntitle: 先写的\n---\n')
    clock = 2_000
    await fs.writeText('second.md', '---\ntitle: 后写的\n---\n')

    expect((await collectRecentlyEdited(fs)).map((note) => note.title)).toEqual(['后写的', '先写的'])
  })

  it('遵守数量上限', async () => {
    const fs = new MemoryAdapter()
    for (let i = 0; i < 10; i += 1) {
      await fs.writeText(`n${i}.md`, `---\ntitle: 第${i}篇\nupdated: 2026-0${(i % 9) + 1}-01T00:00:00.000Z\n---\n`)
    }
    expect(await collectRecentlyEdited(fs, 3)).toHaveLength(3)
  })

  it('标题缺失时回落到文件名', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText('无标题笔记.md', '正文，没有 frontmatter')
    expect((await collectRecentlyEdited(fs))[0]?.title).toBe('无标题笔记')
  })
})

describe('collectFavorites', () => {
  it('只收录 favorite 为 true 的笔记', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText('a.md', '---\ntitle: 甲\nfavorite: true\n---\n')
    await fs.writeText('b.md', '---\ntitle: 乙\nfavorite: false\n---\n')
    await fs.writeText('c.md', '---\ntitle: 丙\n---\n')

    expect((await collectFavorites(fs)).map((note) => note.title)).toEqual(['甲'])
  })

  it('收藏状态就是 frontmatter，不依赖额外清单', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText('a.md', '---\ntitle: 甲\nfavorite: true\n---\n')
    expect(await collectFavorites(fs)).toHaveLength(1)

    // 直接改文件（模拟其它工具的改动），视图应随之变化
    await fs.writeText('a.md', '---\ntitle: 甲\nfavorite: false\n---\n')
    expect(await collectFavorites(fs)).toEqual([])
  })

  it('没有收藏时返回空', async () => {
    expect(await collectFavorites(new MemoryAdapter())).toEqual([])
  })
})

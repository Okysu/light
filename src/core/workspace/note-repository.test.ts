import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseDocument } from '../markdown/frontmatter'
import { MemoryAdapter } from '../storage/memory-adapter'
import { NoteRepository } from './note-repository'
import { deriveAppKey, encryptProtectedText, isProtectedText, setActiveLocalVaultKey } from '../security/local-vault'

afterEach(() => setActiveLocalVaultKey(null))

describe('NoteRepository', () => {
  let fs: MemoryAdapter
  let repo: NoteRepository
  let idCounter: number

  beforeEach(() => {
    idCounter = 0
    fs = new MemoryAdapter(() => 1_700_000_000_000)
    repo = new NoteRepository(fs, () => 1_700_000_000_000, () => `id-${++idCounter}`)
  })

  describe('create', () => {
    it('新建笔记写入完整 frontmatter', async () => {
      const path = await repo.create('notes', '周报')
      expect(path).toBe('notes/周报.md')

      const note = await repo.read(path)
      expect(note.id).toBe('id-1')
      expect(note.title).toBe('周报')
      expect(note.tags).toEqual([])
    })

    it('同名时追加序号而非覆盖已有文件', async () => {
      await repo.create('notes', '周报')
      const second = await repo.create('notes', '周报')
      expect(second).toBe('notes/周报 (2).md')
      expect(await fs.exists('notes/周报.md')).toBe(true)
    })

    it('标题中的非法字符被清洗', async () => {
      expect(await repo.create('', 'a/b:c')).toBe('a_b_c.md')
    })

    it('看板与画板按各自扩展名落盘', async () => {
      expect(await repo.create('', '任务', 'board')).toBe('任务.board')
      expect(await repo.create('', '脑图', 'canvas')).toBe('脑图.canvas')
    })

    /**
     * 界面上的标题栏读的是正文首个 H1（core/markdown/title.ts），
     * 只写 frontmatter.title 的话，新建的笔记会出现「文件名有了、标题栏却空着」。
     */
    it('正文以 H1 标题开头，标题栏才有内容', async () => {
      const path = await repo.create('notes', '周报')
      expect(await fs.readText(path)).toContain('# 周报')
    })

    it('重名追加序号后，H1 与文件名保持一致', async () => {
      await repo.create('', '周报')
      const second = await repo.create('', '周报')
      expect(await fs.readText(second)).toContain('# 周报 (2)')
    })

    it('无标题时不写 H1——否则「未命名」会从占位符变成真实内容', async () => {
      const path = await repo.create('', '')
      expect(await fs.readText(path)).not.toContain('#')
    })

    it('初始正文接在标题之后（速记就是这么写入的）', async () => {
      const path = await repo.create('', '速记', 'note', '随手记的一句话')
      const raw = await fs.readText(path)
      expect(raw.indexOf('# 速记')).toBeLessThan(raw.indexOf('随手记的一句话'))
    })
  })

  describe('read', () => {
    it('缺少 frontmatter 时用文件名兜底标题', async () => {
      await fs.writeText('裸文件.md', '# 内容')
      const note = await repo.read('裸文件.md')
      expect(note.title).toBe('裸文件')
      expect(note.content).toBe('# 内容')
      expect(note.updatedAt).toBe(1_700_000_000_000)
    })
  })

  describe('write', () => {
    it('只覆盖 patch 中的字段，未知字段原样保留', async () => {
      const path = await repo.create('', '笔记')
      const raw = await fs.readText(path)
      await fs.writeText(path, raw.replace('tags: []', 'tags: []\ncustom: 外部工具写的'))

      await repo.write(path, { content: '新正文' })

      const { data, content } = parseDocument(await fs.readText(path))
      expect(data['custom']).toBe('外部工具写的')
      expect(data['id']).toBe('id-1')
      expect(content).toBe('新正文')
    })

    it('为缺 id 的历史文件补发稳定 id', async () => {
      await fs.writeText('旧.md', '---\ntitle: 旧\n---\n正文')
      const note = await repo.write('旧.md', { content: '正文' })
      expect(note.id).toBe('id-1')
    })

    it('敏感笔记保存后仍是密文，磁盘不出现新正文', async () => {
      const path = await repo.create('', '秘密')
      const { key } = await deriveAppKey('test-password', new Uint8Array(16).fill(7), 1)
      setActiveLocalVaultKey(key)
      await fs.writeText(path, await encryptProtectedText(await fs.readText(path)))
      await repo.write(path, { content: '绝密正文' })
      const raw = await fs.readText(path)
      expect(isProtectedText(raw)).toBe(true)
      expect(raw).not.toContain('绝密正文')
      expect((await repo.read(path)).content).toBe('绝密正文')
    })
  })

  describe('rename', () => {
    it('文件名与 frontmatter.title 同步更新', async () => {
      const path = await repo.create('notes', '旧名')
      const renamed = await repo.rename(path, '新名')

      expect(renamed).toBe('notes/新名.md')
      expect(await fs.exists(path)).toBe(false)
      expect((await repo.read(renamed)).title).toBe('新名')
    })

    it('目标已存在时自动避让，不覆盖', async () => {
      await repo.create('', '占位')
      const path = await repo.create('', '待改')
      expect(await repo.rename(path, '占位')).toBe('占位 (2).md')
    })
  })

  describe('move', () => {
    it('保持文件名，迁到新目录', async () => {
      const path = await repo.create('a', '笔记')
      expect(await repo.move(path, 'b/c')).toBe('b/c/笔记.md')
      expect(await fs.exists('b/c/笔记.md')).toBe(true)
    })
  })

  describe('duplicate', () => {
    it('副本换发新 id，避免双向链接指向两个文件', async () => {
      const path = await repo.create('', '原件')
      const copy = await repo.duplicate(path)

      expect(copy).toBe('原件 副本.md')
      expect((await repo.read(copy)).id).toBe('id-2')
      expect((await repo.read(path)).id).toBe('id-1')
    })

    it('复制敏感笔记不会生成明文副本', async () => {
      const path = await repo.create('', '秘密')
      const { key } = await deriveAppKey('test-password', new Uint8Array(16).fill(5), 1)
      setActiveLocalVaultKey(key)
      await fs.writeText(path, await encryptProtectedText(await fs.readText(path)))
      const copy = await repo.duplicate(path)
      expect(isProtectedText(await fs.readText(copy))).toBe(true)
      expect((await repo.read(copy)).id).not.toBe((await repo.read(path)).id)
    })
  })
})

describe('看板 / 画板的初始文件', () => {
  let fs: MemoryAdapter
  let repo: NoteRepository

  beforeEach(() => {
    fs = new MemoryAdapter()
    repo = new NoteRepository(fs)
  })

  /**
   * 曾经写死一个 `{ version, kind, items: [] }` 的「最小骨架」，
   * 而 `items` 这个字段名看板与画板都不认。读取时的归一化能兜住它，
   * 但用户在文件管理器里看到的、用别的工具打开的，就是那份错的。
   */
  it('调用方给了初始内容时原样落盘', async () => {
    const skeleton = JSON.stringify({ version: 1, kind: 'board', columns: [] })
    const path = await repo.create('', '看板', 'board', skeleton)

    expect(JSON.parse(await fs.readText(path))).toEqual({ version: 1, kind: 'board', columns: [] })
  })

  it('没给初始内容时也不写出别的模块不认的字段', async () => {
    const path = await repo.create('', '画板', 'canvas')
    const parsed = JSON.parse(await fs.readText(path))

    expect(parsed).toMatchObject({ version: 1, kind: 'canvas' })
    expect(parsed).not.toHaveProperty('items')
  })
})

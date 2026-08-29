import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { NoteRepository } from '../workspace/note-repository'
import { LinkRewriter } from './link-rewriter'

describe('LinkRewriter', () => {
  let fs: MemoryAdapter
  let notes: NoteRepository
  let rewriter: LinkRewriter

  beforeEach(() => {
    fs = new MemoryAdapter()
    notes = new NoteRepository(fs)
    rewriter = new LinkRewriter(notes)
  })

  /** 直接写文件，绕开 create 的标题处理，让用例聚焦在链接上 */
  async function seed(path: string, body: string): Promise<void> {
    await fs.writeText(path, `---\nid: ${path}\ntitle: ${path}\n---\n${body}`)
  }

  it('改写指向被改名笔记的链接', async () => {
    await seed('甲.md', '看 [[旧名]] 这篇')
    await seed('旧名.md', '内容')

    const changed = await rewriter.retarget({
      sources: ['甲.md'],
      from: '旧名.md',
      to: '新名.md',
      pathsBefore: ['甲.md', '旧名.md'],
      pathsAfter: ['甲.md', '新名.md'],
    })

    expect(changed).toEqual(['甲.md'])
    expect((await notes.read('甲.md')).content).toContain('[[新名]]')
  })

  it('别名与锚点在改写后仍然保留', async () => {
    await seed('甲.md', '见 [[旧名#结论|讲得更细]]')

    await rewriter.retarget({
      sources: ['甲.md'],
      from: '旧名.md',
      to: '新名.md',
      pathsBefore: ['甲.md', '旧名.md'],
      pathsAfter: ['甲.md', '新名.md'],
    })

    expect((await notes.read('甲.md')).content).toContain('[[新名#结论|讲得更细]]')
  })

  /**
   * `[[笔记]]` 在有同名文件时可能指向另一篇。
   * 不做这层判断的话，改名会误伤那些其实指向别处的链接。
   */
  it('只改真正指向该篇的链接', async () => {
    await seed('甲.md', '这条指向根目录的 [[笔记]]')

    const changed = await rewriter.retarget({
      sources: ['甲.md'],
      // 被改名的是归档里那篇，而 [[笔记]] 解析到的是根目录那篇
      from: '归档/笔记.md',
      to: '归档/新名.md',
      pathsBefore: ['甲.md', '笔记.md', '归档/笔记.md'],
      pathsAfter: ['甲.md', '笔记.md', '归档/新名.md'],
    })

    expect(changed).toEqual([])
    expect((await notes.read('甲.md')).content).toContain('[[笔记]]')
  })

  it('改名后与别处重名时，新目标带上路径', async () => {
    await seed('甲.md', '看 [[旧名]]')

    await rewriter.retarget({
      sources: ['甲.md'],
      from: '旧名.md',
      to: '归档/笔记.md',
      pathsBefore: ['甲.md', '旧名.md', '笔记.md'],
      // 改完之后有两个「笔记」，链接必须带路径才指向明确
      pathsAfter: ['甲.md', '笔记.md', '归档/笔记.md'],
    })

    expect((await notes.read('甲.md')).content).toContain('[[归档/笔记]]')
  })

  it('多篇引用一并改写，只返回真正改动过的', async () => {
    await seed('甲.md', '看 [[旧名]]')
    await seed('乙.md', '不提任何人')
    await seed('丙.md', '也看 [[旧名]] 两次 [[旧名]]')

    const changed = await rewriter.retarget({
      sources: ['甲.md', '乙.md', '丙.md'],
      from: '旧名.md',
      to: '新名.md',
      pathsBefore: ['甲.md', '乙.md', '丙.md', '旧名.md'],
      pathsAfter: ['甲.md', '乙.md', '丙.md', '新名.md'],
    })

    expect(changed).toEqual(['甲.md', '丙.md'])
    expect((await notes.read('丙.md')).content).toBe('也看 [[新名]] 两次 [[新名]]')
  })

  it('代码块里的同名写法不受影响', async () => {
    await seed('甲.md', ['真的 [[旧名]]', '```', '示例 [[旧名]]', '```'].join('\n'))

    await rewriter.retarget({
      sources: ['甲.md'],
      from: '旧名.md',
      to: '新名.md',
      pathsBefore: ['甲.md', '旧名.md'],
      pathsAfter: ['甲.md', '新名.md'],
    })

    const content = (await notes.read('甲.md')).content
    expect(content).toContain('真的 [[新名]]')
    expect(content).toContain('示例 [[旧名]]')
  })

  it('frontmatter 不被这次改写破坏', async () => {
    await seed('甲.md', '看 [[旧名]]')
    await notes.write('甲.md', { properties: { 作者: '张三' } })

    await rewriter.retarget({
      sources: ['甲.md'],
      from: '旧名.md',
      to: '新名.md',
      pathsBefore: ['甲.md', '旧名.md'],
      pathsAfter: ['甲.md', '新名.md'],
    })

    const note = await notes.read('甲.md')
    expect(note.frontmatter['作者']).toBe('张三')
    expect(note.content).toContain('[[新名]]')
  })

  it('单篇读写失败不中断其余改写', async () => {
    await seed('甲.md', '看 [[旧名]]')

    const changed = await rewriter.retarget({
      sources: ['不存在.md', '甲.md'],
      from: '旧名.md',
      to: '新名.md',
      pathsBefore: ['甲.md', '旧名.md'],
      pathsAfter: ['甲.md', '新名.md'],
    })

    expect(changed).toEqual(['甲.md'])
  })

  it('路径没变时什么也不做', async () => {
    await seed('甲.md', '看 [[旧名]]')

    const changed = await rewriter.retarget({
      sources: ['甲.md'],
      from: '旧名.md',
      to: '旧名.md',
      pathsBefore: ['甲.md', '旧名.md'],
      pathsAfter: ['甲.md', '旧名.md'],
    })

    expect(changed).toEqual([])
  })
})

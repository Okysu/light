// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OpfsAdapter } from './opfs-adapter'
import { installMockOpfs } from './opfs-mock'
import { StorageError } from './types'

/**
 * OPFS 适配器测试。
 *
 * 之所以值得为它单独造一套 mock：这一层是所有数据操作的地基，
 * 而它此前完全没有测试——「文件夹无法删除」的缺陷就是从这个盲区漏到用户面前的。
 */
describe('OpfsAdapter', () => {
  let uninstall: () => void
  let fs: OpfsAdapter
  let clock: number

  beforeEach(async () => {
    clock = 1_000
    uninstall = installMockOpfs(() => clock).uninstall
    fs = await OpfsAdapter.create('workspace')
  })

  afterEach(() => uninstall())

  describe('stat', () => {
    it('识别文件并返回大小与修改时间', async () => {
      await fs.writeText('a.md', 'hello')
      const stat = await fs.stat('a.md')
      expect(stat).toMatchObject({ isDirectory: false, size: 5, modifiedAt: 1_000 })
    })

    // 回归测试：真实 OPFS 对目录调用 getFileHandle 抛的是 TypeMismatchError，
    // 适配器一度只放行 NotFoundError，导致目录的 stat 直接失败、文件夹删不掉
    it('对目录返回 isDirectory 而不是抛 NOT_A_DIRECTORY', async () => {
      await fs.mkdir('folder')
      const stat = await fs.stat('folder')
      expect(stat.isDirectory).toBe(true)
    })

    it('工作区根目录本身可 stat', async () => {
      expect((await fs.stat('')).isDirectory).toBe(true)
    })

    it('路径不存在时抛 NOT_FOUND', async () => {
      await expect(fs.stat('missing.md')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('OPFS 不记录创建时间，createdAt 恒为 null', async () => {
      await fs.writeText('a.md', 'x')
      expect((await fs.stat('a.md')).createdAt).toBeNull()
    })
  })

  describe('exists', () => {
    it('对文件与目录都返回 true', async () => {
      await fs.writeText('a.md', 'x')
      await fs.mkdir('folder')
      expect(await fs.exists('a.md')).toBe(true)
      expect(await fs.exists('folder')).toBe(true)
    })

    it('不存在时返回 false 而不是抛错', async () => {
      expect(await fs.exists('nope.md')).toBe(false)
    })

    it('根目录恒存在', async () => {
      expect(await fs.exists('')).toBe(true)
    })
  })

  describe('读写', () => {
    it('写文件自动补齐父目录', async () => {
      await fs.writeText('a/b/c.md', 'deep')
      expect(await fs.readText('a/b/c.md')).toBe('deep')
      expect((await fs.stat('a/b')).isDirectory).toBe(true)
    })

    it('二进制往返', async () => {
      const bytes = new Uint8Array([1, 2, 3, 250])
      await fs.writeBinary('bin.dat', bytes)
      expect([...(await fs.readBinary('bin.dat'))]).toEqual([1, 2, 3, 250])
    })

    it('覆盖写入不残留旧内容', async () => {
      await fs.writeText('a.md', '很长的原始内容')
      await fs.writeText('a.md', '短')
      expect(await fs.readText('a.md')).toBe('短')
    })

    it('读取不存在的文件抛 NOT_FOUND', async () => {
      await expect(fs.readText('missing.md')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })
  })

  describe('list', () => {
    it('区分文件与目录，且只列直接子项', async () => {
      await fs.writeText('dir/nested/deep.md', '')
      await fs.writeText('dir/top.md', '')

      const entries = (await fs.list('dir')).map((e) => `${e.name}:${e.isDirectory}`).sort()
      expect(entries).toEqual(['nested:true', 'top.md:false'])
    })

    it('列出的 path 是相对工作区根的完整路径', async () => {
      await fs.writeText('dir/a.md', '')
      expect((await fs.list('dir'))[0]?.path).toBe('dir/a.md')
    })
  })

  describe('remove', () => {
    it('删除文件', async () => {
      await fs.writeText('a.md', '')
      await fs.remove('a.md')
      expect(await fs.exists('a.md')).toBe(false)
    })

    it('删除非空目录需显式 recursive', async () => {
      await fs.writeText('dir/a.md', '')
      await expect(fs.remove('dir')).rejects.toThrow(StorageError)
      await fs.remove('dir', { recursive: true })
      expect(await fs.exists('dir')).toBe(false)
    })

    it('拒绝删除工作区根目录', async () => {
      await expect(fs.remove('')).rejects.toThrow(StorageError)
    })
  })

  describe('move', () => {
    it('移动文件并保留内容', async () => {
      await fs.writeText('a.md', '内容')
      await fs.move('a.md', 'sub/b.md')
      expect(await fs.readText('sub/b.md')).toBe('内容')
      expect(await fs.exists('a.md')).toBe(false)
    })

    it('递归移动目录（OPFS 无原生递归移动）', async () => {
      await fs.writeText('src/nested/x.md', 'x')
      await fs.writeText('src/y.md', 'y')

      await fs.move('src', 'dst')

      expect(await fs.readText('dst/nested/x.md')).toBe('x')
      expect(await fs.readText('dst/y.md')).toBe('y')
      expect(await fs.exists('src')).toBe(false)
    })

    it('目标已存在时拒绝，交由上层决定避让', async () => {
      await fs.writeText('a.md', '')
      await fs.writeText('b.md', '')
      await expect(fs.move('a.md', 'b.md')).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
    })

    it('移动到已存在的目录名同样被拒绝', async () => {
      await fs.writeText('a.md', '')
      await fs.mkdir('folder')
      await expect(fs.move('a.md', 'folder')).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
    })
  })

  describe('与领域服务协作', () => {
    // 用户报告的场景：右键文件夹 → 移入回收站
    it('目录可被移入回收站（stat → move 全链路）', async () => {
      const { TrashService } = await import('../workspace/trash-service')
      await fs.writeText('测试目录/inner.md', '内容')

      const trash = new TrashService(fs, () => 2_000)
      const item = await trash.trash('测试目录')

      expect(item.kind).toBe('folder')
      expect(await fs.exists('测试目录')).toBe(false)
      expect(await fs.readText(`.light/trash/${item.archivedPath}/inner.md`)).toBe('内容')

      await trash.restore(item.archivedPath)
      expect(await fs.readText('测试目录/inner.md')).toBe('内容')
    })
  })
})

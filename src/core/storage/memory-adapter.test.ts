import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from './memory-adapter'
import { StorageError } from './types'

describe('MemoryAdapter', () => {
  let fs: MemoryAdapter

  beforeEach(() => {
    fs = new MemoryAdapter(() => 1_000)
  })

  it('写文件时自动补齐父目录', async () => {
    await fs.writeText('a/b/c.md', 'hi')
    expect(await fs.exists('a/b')).toBe(true)
    expect(await fs.readText('a/b/c.md')).toBe('hi')
  })

  it('list 只返回直接子项，深层文件收敛为中间目录', async () => {
    await fs.writeText('a/b/c.md', '')
    await fs.writeText('a/top.md', '')
    const names = (await fs.list('a')).map((entry) => `${entry.name}:${entry.isDirectory}`).sort()
    expect(names).toEqual(['b:true', 'top.md:false'])
  })

  it('删除非空目录需显式 recursive', async () => {
    await fs.writeText('a/b.md', '')
    await expect(fs.remove('a')).rejects.toThrow(StorageError)
    await fs.remove('a', { recursive: true })
    expect(await fs.exists('a')).toBe(false)
  })

  it('move 递归搬运目录下所有内容', async () => {
    await fs.writeText('src/nested/x.md', 'x')
    await fs.move('src', 'dst')
    expect(await fs.readText('dst/nested/x.md')).toBe('x')
    expect(await fs.exists('src')).toBe(false)
  })

  it('move 到已存在路径直接失败，交由上层决定避让策略', async () => {
    await fs.writeText('a.md', '')
    await fs.writeText('b.md', '')
    await expect(fs.move('a.md', 'b.md')).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
  })

  it('读取不存在的文件抛 NOT_FOUND', async () => {
    await expect(fs.readText('missing.md')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('不允许删除工作区根目录', async () => {
    await expect(fs.remove('')).rejects.toThrow(StorageError)
  })

  it('重写文件保留创建时间、更新修改时间', async () => {
    let clock = 1_000
    const clocked = new MemoryAdapter(() => clock)

    await clocked.writeText('a.md', '1')
    clock = 2_000
    await clocked.writeText('a.md', '2')

    const stat = await clocked.stat('a.md')
    expect(stat.createdAt).toBe(1_000)
    expect(stat.modifiedAt).toBe(2_000)
  })

  it('分块读写保持字节顺序且不依赖单次块大小', async () => {
    async function* source() {
      yield new Uint8Array([1, 2])
      yield new Uint8Array([3])
      yield new Uint8Array([4, 5, 6])
    }
    await fs.writeChunks('large.bin', source())

    const chunks: number[][] = []
    for await (const chunk of fs.readChunks('large.bin', 2)) chunks.push([...chunk])

    expect(chunks).toEqual([[1, 2], [3, 4], [5, 6]])
  })
})

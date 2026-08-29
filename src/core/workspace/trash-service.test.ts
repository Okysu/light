import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { TrashService } from './trash-service'
import { TRASH_DIR } from './types'

const DAY = 24 * 60 * 60 * 1000

describe('TrashService', () => {
  let fs: MemoryAdapter
  let clock: number
  let trash: TrashService

  beforeEach(() => {
    clock = 1_700_000_000_000
    fs = new MemoryAdapter(() => clock)
    trash = new TrashService(fs, () => clock)
  })

  it('删除是移动而非物理删除，原内容仍可读', async () => {
    await fs.writeText('notes/a.md', '内容')
    const item = await trash.trash('notes/a.md')

    expect(await fs.exists('notes/a.md')).toBe(false)
    expect(await fs.readText(`${TRASH_DIR}/${item.archivedPath}`)).toBe('内容')
    expect(item.originalPath).toBe('notes/a.md')
    expect(item.kind).toBe('note')
  })

  it('还原回原路径并从清单中移除', async () => {
    await fs.writeText('notes/a.md', '内容')
    const item = await trash.trash('notes/a.md')

    expect(await trash.restore(item.archivedPath)).toBe('notes/a.md')
    expect(await fs.readText('notes/a.md')).toBe('内容')
    expect(await trash.list()).toEqual([])
  })

  it('原路径已被新文件占用时避让而非覆盖', async () => {
    await fs.writeText('a.md', '旧')
    const item = await trash.trash('a.md')
    await fs.writeText('a.md', '新')

    expect(await trash.restore(item.archivedPath)).toBe('a (2).md')
    expect(await fs.readText('a.md')).toBe('新')
  })

  it('父目录已被删除时重建后再还原', async () => {
    await fs.writeText('deep/nested/a.md', '内容')
    const item = await trash.trash('deep/nested/a.md')
    await fs.remove('deep', { recursive: true })

    expect(await trash.restore(item.archivedPath)).toBe('deep/nested/a.md')
  })

  it('回收站内同名条目各自独立存放', async () => {
    await fs.writeText('x/a.md', '1')
    await fs.writeText('y/a.md', '2')
    const first = await trash.trash('x/a.md')
    const second = await trash.trash('y/a.md')

    expect(first.archivedPath).not.toBe(second.archivedPath)
    expect(await fs.readText(`${TRASH_DIR}/${second.archivedPath}`)).toBe('2')
  })

  it('删除目录时整棵子树一起归档', async () => {
    await fs.writeText('folder/sub/a.md', '内容')
    const item = await trash.trash('folder')

    expect(item.kind).toBe('folder')
    expect(await fs.readText(`${TRASH_DIR}/${item.archivedPath}/sub/a.md`)).toBe('内容')
  })

  it('autoClean 只清理超期条目', async () => {
    await fs.writeText('old.md', '')
    await trash.trash('old.md')

    clock += 31 * DAY
    await fs.writeText('new.md', '')
    await trash.trash('new.md')

    expect(await trash.autoClean(30)).toBe(1)
    const remaining = await trash.list()
    expect(remaining.map((item) => item.originalPath)).toEqual(['new.md'])
  })

  it('retentionDays 为 0 表示永不自动清理', async () => {
    await fs.writeText('a.md', '')
    await trash.trash('a.md')
    clock += 365 * DAY

    expect(await trash.autoClean(0)).toBe(0)
    expect(await trash.list()).toHaveLength(1)
  })

  it('清单损坏时按空回收站处理，不阻塞工作区打开', async () => {
    await fs.writeText(`${TRASH_DIR}/manifest.json`, '{ 这不是合法 JSON')
    expect(await trash.list()).toEqual([])
  })

  it('拒绝把回收站自身移入回收站', async () => {
    await fs.mkdir(TRASH_DIR)
    await expect(trash.trash(TRASH_DIR)).rejects.toThrow()
  })
})

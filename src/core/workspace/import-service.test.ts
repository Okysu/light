import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { importFiles } from './import-service'

function file(path: string, text = '内容'): { path: string; bytes: Uint8Array } {
  return { path, bytes: new TextEncoder().encode(text) }
}

describe('importFiles', () => {
  let storage: MemoryAdapter

  beforeEach(() => {
    storage = new MemoryAdapter()
  })

  it('把文件写进目标目录', async () => {
    const result = await importFiles(storage, '收件箱', [file('日记.md', '今天')])

    expect(result).toEqual({ imported: 1, skipped: [] })
    expect(await storage.readText('收件箱/日记.md')).toBe('今天')
  })

  it('保留源目录结构', async () => {
    await importFiles(storage, '', [file('项目/设计/草案.md'), file('项目/设计/终稿.md')])

    expect(await storage.exists('项目/设计/草案.md')).toBe(true)
    expect(await storage.exists('项目/设计/终稿.md')).toBe(true)
  })

  it('同名文件避让而不是覆盖——导入绝不能吃掉已有笔记', async () => {
    await storage.writeText('日记.md', '原有内容')

    await importFiles(storage, '', [file('日记.md', '导入内容')])

    expect(await storage.readText('日记.md')).toBe('原有内容')
    expect(await storage.readText('日记 (2).md')).toBe('导入内容')
  })

  it('同一次导入里同目录的多个文件不会被拆进不同目录', async () => {
    await storage.mkdir('项目')
    await storage.writeText('项目/已有.md', 'x')

    await importFiles(storage, '', [file('项目/甲.md'), file('项目/乙.md')])

    // 目录合并而非避让成「项目 (2)」，否则同一批内容会散落两处
    expect(await storage.exists('项目/甲.md')).toBe(true)
    expect(await storage.exists('项目/乙.md')).toBe(true)
    expect(await storage.exists('项目 (2)')).toBe(false)
  })

  it('跳过隐藏文件与隐藏目录', async () => {
    const result = await importFiles(storage, '', [
      file('.obsidian/app.json'),
      file('.DS_Store'),
      file('正文.md'),
    ])

    expect(result.imported).toBe(1)
    expect(result.skipped).toEqual(['.obsidian/app.json', '.DS_Store'])
    expect(await storage.exists('.obsidian/app.json')).toBe(false)
  })

  it('单个文件失败不中断整批', async () => {
    const broken = {
      path: '坏的.png',
      get bytes(): Uint8Array {
        throw new Error('读不出来')
      },
    }

    const result = await importFiles(storage, '', [file('好的.md'), broken, file('也好.md')])

    expect(result.imported).toBe(2)
    expect(result.skipped).toEqual(['坏的.png'])
  })

  it('二进制文件按二进制写入，不经过文本解码', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])

    await importFiles(storage, '', [{ path: '图.png', bytes }])

    expect(await storage.readBinary('图.png')).toEqual(bytes)
  })
})

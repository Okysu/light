import { afterEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { HISTORY_DIR, HistoryError, HistoryService } from './history-service'
import { deriveAppKey, isProtectedText, setActiveLocalVaultKey } from '../security/local-vault'

afterEach(() => setActiveLocalVaultKey(null))

function source(content: string, path = '笔记.md') {
  return { id: 'note-stable-id', path, title: '笔记', content }
}

describe('HistoryService', () => {
  it('保存并读取上一版本，索引与正文均位于内部目录', async () => {
    const storage = new MemoryAdapter()
    const service = new HistoryService(storage, { now: () => 1_000, newId: () => 'entry-1' })
    const entry = await service.capture(source('# 笔记\n\n第一版'))

    expect(entry?.id).toBe('entry-1')
    expect(await service.list('note-stable-id')).toEqual([entry])
    expect(await service.read('note-stable-id', 'entry-1')).toMatchObject({
      noteId: 'note-stable-id',
      title: '笔记',
      content: '# 笔记\n\n第一版',
    })
    expect((await storage.list('.light')).some((item) => item.path === '.light/history')).toBe(true)
  })

  it('自动快照在时间窗口内节流，强制快照可绕过节流', async () => {
    let now = 1_000
    let id = 0
    const service = new HistoryService(new MemoryAdapter(), {
      now: () => now,
      newId: () => `entry-${++id}`,
      intervalMs: 300_000,
    })
    await service.capture(source('第一版'))
    now += 1_000
    expect(await service.capture(source('第二版'))).toBeNull()
    expect(await service.capture(source('第二版'), { force: true, reason: 'manual' })).toMatchObject({
      reason: 'manual',
    })
  })

  it('相同内容始终去重，避免手动按钮制造空版本', async () => {
    const service = new HistoryService(new MemoryAdapter(), { now: () => 1_000 })
    await service.capture(source('相同'))
    expect(await service.capture(source('相同'), { force: true })).toBeNull()
    expect(await service.list('note-stable-id')).toHaveLength(1)
  })

  it('按稳定 ID 查找，文件改名或移动不丢历史', async () => {
    let now = 1_000
    const service = new HistoryService(new MemoryAdapter(), { now: () => now, intervalMs: 0 })
    await service.capture(source('改名前', '旧目录/旧名.md'))
    now += 1
    await service.capture(source('改名后', '新目录/新名.md'))
    expect((await service.list('note-stable-id')).map((entry) => entry.title)).toEqual(['笔记', '笔记'])
  })

  it('限制最大条目并清理不再引用的内容对象', async () => {
    let now = 1_000
    let id = 0
    const storage = new MemoryAdapter()
    const service = new HistoryService(storage, {
      now: () => now,
      newId: () => `entry-${++id}`,
      intervalMs: 0,
      maxEntries: 2,
    })
    await service.capture(source('一'))
    now += 1
    await service.capture(source('二'))
    now += 1
    await service.capture(source('三'))

    expect((await service.list('note-stable-id')).map((entry) => entry.id)).toEqual(['entry-3', 'entry-2'])
    const noteDir = (await storage.list(HISTORY_DIR)).find((entry) => entry.isDirectory)!.path
    expect(await storage.list(`${noteDir}/objects`)).toHaveLength(2)
  })

  it('清理超过保留期的条目', async () => {
    let now = 1_000
    const service = new HistoryService(new MemoryAdapter(), {
      now: () => now,
      intervalMs: 0,
      retentionMs: 100,
    })
    await service.capture(source('旧'))
    now += 101
    await service.capture(source('新'))
    expect((await service.list('note-stable-id')).map((entry) => entry.title)).toHaveLength(1)
    expect((await service.list('note-stable-id'))[0]?.createdAt).toBe(1_101)
  })

  it('恶意 note id 只参与哈希，不可能逃出 history 目录', async () => {
    const storage = new MemoryAdapter()
    const service = new HistoryService(storage)
    await service.capture({ ...source('正文'), id: '../../../outside' })
    expect(await storage.exists('outside')).toBe(false)
    expect(await storage.exists(HISTORY_DIR)).toBe(true)
  })

  it('索引损坏时停止写入，不用空索引覆盖现有历史', async () => {
    const storage = new MemoryAdapter()
    const service = new HistoryService(storage)
    await service.capture(source('第一版'))
    const noteDir = (await storage.list(HISTORY_DIR)).find((entry) => entry.isDirectory)!.path
    await storage.writeText(`${noteDir}/index.json`, '{broken')

    await expect(service.capture(source('第二版'), { force: true })).rejects.toBeInstanceOf(HistoryError)
    expect(await storage.readText(`${noteDir}/index.json`)).toBe('{broken')
  })

  it('找不到条目时给出领域错误', async () => {
    const service = new HistoryService(new MemoryAdapter())
    await expect(service.read('note-stable-id', 'missing')).rejects.toBeInstanceOf(HistoryError)
  })

  it('敏感笔记的现有历史会整体转成密文并隐藏路径与标题', async () => {
    const storage = new MemoryAdapter()
    const service = new HistoryService(storage, { now: () => 1_000, newId: () => 'entry-1' })
    await service.capture(source('绝密旧版本', '秘密/计划.md'))
    const { key } = await deriveAppKey('test-password', new Uint8Array(16).fill(3), 1)
    setActiveLocalVaultKey(key)
    await service.setProtection('note-stable-id', true, { path: '秘密/计划.md', title: '计划' })

    const noteDir = (await storage.list(HISTORY_DIR)).find((entry) => entry.isDirectory)!.path
    const object = (await storage.list(`${noteDir}/objects`))[0]!
    expect(isProtectedText(await storage.readText(object.path))).toBe(true)
    const index = await storage.readText(`${noteDir}/index.json`)
    expect(index).not.toContain('秘密/计划.md')
    expect(index).not.toContain('计划')
    expect((await service.read('note-stable-id', 'entry-1')).content).toBe('绝密旧版本')
  })
})

// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryAdapter } from '@/core/storage/memory-adapter'
import { useAttachmentsStore } from './attachments'
import { useWorkspaceStore } from './workspace'

const bytes = new Uint8Array([137, 80, 78, 71])
const response = () => new Response(bytes, { headers: { 'content-type': 'image/png' } })

beforeEach(() => { setActivePinia(createPinia()) })
afterEach(() => { vi.unstubAllGlobals() })

describe('网络图片存入当前数据目录', () => {
  it('自动创建附件目录，并返回相对笔记的引用', async () => {
    const storage = new MemoryAdapter()
    useWorkspaceStore().storage = storage
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    const href = await useAttachmentsStore().importRemoteImage('https://cdn.example/a.png', 'notes/n.md')
    expect(href).toBe('../attachments/a.png')
    expect(await storage.readBinary('attachments/a.png')).toEqual(bytes)
  })

  it('同名图片不会覆盖已有附件', async () => {
    const storage = new MemoryAdapter()
    useWorkspaceStore().storage = storage
    await storage.writeBinary('attachments/a.png', new Uint8Array([42]))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    const href = await useAttachmentsStore().importRemoteImage('https://cdn.example/a.png', 'n.md')
    expect(href).toBe('attachments/a-2.png')
    expect(await storage.readBinary('attachments/a.png')).toEqual(new Uint8Array([42]))
  })

  it('下载期间切换数据目录，不会写入新目录', async () => {
    const previous = new MemoryAdapter()
    const next = new MemoryAdapter()
    const workspace = useWorkspaceStore()
    workspace.storage = previous
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve })))
    const attachments = useAttachmentsStore()
    const pending = attachments.importRemoteImage('https://cdn.example/a.png', 'notes/n.md')
    workspace.storage = next
    attachments.invalidate()
    finish(response())
    expect(await pending).toBe('../attachments/a.png')
    expect(await previous.exists('attachments/a.png')).toBe(true)
    expect(await next.exists('attachments/a.png')).toBe(false)
  })

  it('取消后不写入文件', async () => {
    const storage = new MemoryAdapter()
    useWorkspaceStore().storage = storage
    const controller = new AbortController()
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve })))
    const pending = useAttachmentsStore().importRemoteImage('https://cdn.example/a.png', 'n.md', controller.signal)
    controller.abort()
    finish(response())
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(await storage.exists('attachments/a.png')).toBe(false)
  })
})

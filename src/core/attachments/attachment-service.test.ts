import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage'
import { AttachmentService } from './attachment-service'

describe('AttachmentService 媒体 MIME', () => {
  it('读取音频与视频时返回浏览器可播放的 MIME', async () => {
    const storage = new MemoryAdapter()
    const service = new AttachmentService(storage)
    await storage.mkdir('attachments')
    await storage.writeBinary('attachments/a.mp3', Uint8Array.of(1))
    await storage.writeBinary('attachments/v.webm', Uint8Array.of(2))

    expect((await service.read('attachments/a.mp3', '笔记.md'))?.mime).toBe('audio/mpeg')
    expect((await service.read('attachments/v.webm', '笔记.md'))?.mime).toBe('video/webm')
  })
})

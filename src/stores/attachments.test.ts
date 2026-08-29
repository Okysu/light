// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryAdapter } from '@/core/storage/memory-adapter'
import { useAttachmentsStore } from './attachments'
import { useWorkspaceStore } from './workspace'

/**
 * blob URL 的**所有权**测试。
 *
 * 用户报的现象：粘贴图片能显示，切一次标签页回来就变成
 * `net::ERR_FILE_NOT_FOUND`，刷新页面又好了。
 *
 * 根因是同一个 URL 有两个生命周期主人——store 缓存着它，
 * 而编辑器的 NodeView 在销毁时也去 revoke 它。切标签页会销毁编辑器，
 * URL 就此失效，但 store 的缓存里还留着那个已经死掉的字符串。
 * 刷新页面清空了缓存，所以「刷新就好了」。
 *
 * 这里锁住的结论：**缓存里的 URL 只能由 store 自己释放**。
 */

/** jsdom 没有 URL.createObjectURL，自己记一份账 */
function trackObjectUrls(): { alive: Set<string>; created: string[] } {
  const alive = new Set<string>()
  const created: string[] = []
  let counter = 0

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => {
      const url = `blob:test/${(counter += 1)}`
      alive.add(url)
      created.push(url)
      return url
    },
    revokeObjectURL: (url: string) => {
      alive.delete(url)
    },
  })

  return { alive, created }
}

async function setup(): Promise<{ storage: MemoryAdapter }> {
  setActivePinia(createPinia())
  const storage = new MemoryAdapter()
  await storage.writeBinary('attachments/图.png', new Uint8Array([137, 80, 78, 71]))

  const workspace = useWorkspaceStore()
  workspace.storage = storage

  return { storage }
}

describe('附件 blob URL 的所有权', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('同一张图重复解析复用同一个 URL，不会每次都新建', async () => {
    trackObjectUrls()
    await setup()
    const attachments = useAttachmentsStore()

    const first = await attachments.resolve('attachments/图.png', '笔记.md')
    const second = await attachments.resolve('attachments/图.png', '笔记.md')

    expect(first).toBe(second)
  })

  it('release 之后再解析会拿到一个新的、活着的 URL', async () => {
    const tracker = trackObjectUrls()
    await setup()
    const attachments = useAttachmentsStore()

    const first = await attachments.resolve('attachments/图.png', '笔记.md')
    attachments.release(first!)

    const second = await attachments.resolve('attachments/图.png', '笔记.md')

    // 关键：不能把已经 revoke 的 URL 从缓存里再发一次——
    // 那正是「切回标签页图片就裂了」的成因
    expect(second).not.toBe(first)
    expect(tracker.alive.has(second!)).toBe(true)
  })

  it('release 一个不在缓存里的 URL 不会误伤别的条目', async () => {
    const tracker = trackObjectUrls()
    await setup()
    const attachments = useAttachmentsStore()

    const url = await attachments.resolve('attachments/图.png', '笔记.md')
    attachments.release('blob:test/无关的东西')

    expect(tracker.alive.has(url!)).toBe(true)
    expect(await attachments.resolve('attachments/图.png', '笔记.md')).toBe(url)
  })

  it('invalidate 释放全部并清空缓存', async () => {
    const tracker = trackObjectUrls()
    await setup()
    const attachments = useAttachmentsStore()

    await attachments.resolve('attachments/图.png', '笔记.md')
    attachments.invalidate()

    expect(tracker.alive.size).toBe(0)
  })

  it('解析不存在的附件返回 null，不会产生悬空的 URL', async () => {
    const tracker = trackObjectUrls()
    await setup()
    const attachments = useAttachmentsStore()

    expect(await attachments.resolve('attachments/没有.png', '笔记.md')).toBeNull()
    expect(tracker.created).toHaveLength(0)
  })
})

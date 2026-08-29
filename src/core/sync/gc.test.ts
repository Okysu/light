import { describe, expect, it } from 'vitest'
import { RemoteGarbageCollector, type RemoteGcBackend, type RemoteGcOwnedContent } from './gc'
import type { RemoteManifest, RemoteManifestSnapshot } from './types'
import { SyncError } from './types'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 7, 29)

class FakeBackend implements RemoteGcBackend {
  manifest: RemoteManifest | null = manifestOf(['used'])
  etag = 'etag-1'
  objects: RemoteGcOwnedContent[] = []
  activeLock: string | null = null
  acquired: string[] = []
  released: string[] = []
  deleted: string[][] = []
  onRead?: () => void
  onList?: () => void
  onDelete?: () => void

  async acquireMaintenanceLock(token: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (this.activeLock) throw new SyncError('locked', 'REMOTE_CHANGED')
    this.activeLock = token
    this.acquired.push(token)
  }

  async releaseMaintenanceLock(token: string): Promise<void> {
    if (this.activeLock !== token) throw new Error('not owner')
    this.released.push(token)
    this.activeLock = null
  }

  async readManifest(): Promise<RemoteManifestSnapshot | null> {
    this.onRead?.()
    return this.manifest ? { manifest: structuredClone(this.manifest), etag: this.etag } : null
  }

  async listOwnedContents(): Promise<RemoteGcOwnedContent[]> {
    this.onList?.()
    return structuredClone(this.objects)
  }

  async referencedContentIds(manifest: RemoteManifest): Promise<string[]> {
    return Object.values(manifest.entries).flatMap((entry) => !entry.deleted && entry.hash ? [entry.hash] : [])
  }

  async deleteOwnedContents(ids: string[]): Promise<void> {
    this.onDelete?.()
    this.deleted.push([...ids])
    this.objects = this.objects.filter(({ id }) => !ids.includes(id))
  }
}

function manifestOf(hashes: string[]): RemoteManifest {
  return {
    version: 1,
    updatedAt: 1,
    entries: Object.fromEntries(hashes.map((hash) => [hash, {
      hash,
      size: 1,
      vector: { device: 1 },
      deleted: false,
      modifiedAt: 1,
    }])),
  }
}

function collector(backend: FakeBackend): RemoteGarbageCollector {
  let token = 0
  return new RemoteGarbageCollector(backend, {
    now: () => NOW,
    createToken: () => `token-${++token}`,
  })
}

describe('远端内容 GC', () => {
  it('dry-run 只计划未引用且超过默认 30 天的 Light 内容对象', async () => {
    const backend = new FakeBackend()
    backend.objects = [
      { id: 'used', lastModified: NOW - 100 * DAY, size: 10 },
      { id: 'old-orphan', lastModified: NOW - 31 * DAY, size: 20 },
      { id: 'boundary', lastModified: NOW - 30 * DAY, size: 30 },
      { id: 'young-orphan', lastModified: NOW - 29 * DAY, size: 40 },
      { id: 'unknown-age', lastModified: null, size: 50 },
    ]

    const plan = await collector(backend).dryRun()

    expect(plan.candidates.map(({ id }) => id)).toEqual(['boundary', 'old-orphan'])
    expect(plan).toMatchObject({
      candidateCount: 2,
      candidateBytes: 50,
      skippedReferenced: 1,
      skippedWithinGrace: 1,
      skippedUnknownAge: 1,
      gracePeriodMs: 30 * DAY,
    })
    expect(backend.deleted).toEqual([])
    expect(backend.released).toEqual([backend.acquired[0]])
  })

  it('候选缺少 size 时字节统计为 null', async () => {
    const backend = new FakeBackend()
    backend.objects = [
      { id: 'a', lastModified: NOW - 31 * DAY, size: 4 },
      { id: 'b', lastModified: NOW - 31 * DAY },
    ]
    expect((await collector(backend).dryRun()).candidateBytes).toBeNull()
  })

  it('execute 重新获取锁、锁内复核后删除，并释放自己的新 token', async () => {
    const backend = new FakeBackend()
    backend.objects = [{ id: 'orphan', lastModified: NOW - 31 * DAY, size: 12 }]
    const gc = collector(backend)
    const plan = await gc.dryRun()

    const result = await gc.execute(plan, plan.confirmationToken)

    expect(result).toEqual({ deletedCount: 1, deletedBytes: 12 })
    expect(backend.deleted).toEqual([['orphan']])
    expect(backend.acquired).toHaveLength(2)
    expect(backend.acquired[1]).not.toBe(backend.acquired[0])
    expect(backend.released).toEqual(backend.acquired)
    expect(backend.activeLock).toBeNull()
  })

  it('错误 token、篡改计划和重复执行都不会删除', async () => {
    const backend = new FakeBackend()
    backend.objects = [{ id: 'orphan', lastModified: NOW - 31 * DAY, size: 12 }]
    const gc = collector(backend)
    const plan = await gc.dryRun()

    await expect(gc.execute(plan, 'wrong')).rejects.toMatchObject({ code: 'INVALID_REMOTE' })
    plan.candidates[0]!.id = 'other'
    await expect(gc.execute(plan, plan.confirmationToken)).rejects.toMatchObject({ code: 'INVALID_REMOTE' })
    expect(backend.deleted).toEqual([])

    const fresh = await gc.dryRun()
    await gc.execute(fresh, fresh.confirmationToken)
    await expect(gc.execute(fresh, fresh.confirmationToken)).rejects.toMatchObject({ code: 'INVALID_REMOTE' })
    expect(backend.deleted).toHaveLength(1)
  })

  it('清单 ETag 或内容改变时 fail closed', async () => {
    const backend = new FakeBackend()
    backend.objects = [{ id: 'orphan', lastModified: NOW - 31 * DAY, size: 12 }]
    const gc = collector(backend)
    const plan = await gc.dryRun()
    backend.etag = 'etag-2'

    await expect(gc.execute(plan, plan.confirmationToken)).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    expect(backend.deleted).toEqual([])
    expect(backend.activeLock).toBeNull()
  })

  it('ETag 不变但清单正文改变时仍拒绝删除', async () => {
    const backend = new FakeBackend()
    backend.objects = [{ id: 'orphan', lastModified: NOW - 31 * DAY, size: 12 }]
    const gc = collector(backend)
    const plan = await gc.dryRun()
    backend.manifest!.updatedAt += 1

    await expect(gc.execute(plan, plan.confirmationToken)).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    expect(backend.deleted).toEqual([])
  })

  it('对象候选的 ID、时间或大小变化时均拒绝删除', async () => {
    for (const changed of [
      { id: 'other', lastModified: NOW - 31 * DAY, size: 12 },
      { id: 'orphan', lastModified: NOW - 32 * DAY, size: 12 },
      { id: 'orphan', lastModified: NOW - 31 * DAY, size: 13 },
    ]) {
      const backend = new FakeBackend()
      backend.objects = [{ id: 'orphan', lastModified: NOW - 31 * DAY, size: 12 }]
      const gc = collector(backend)
      const plan = await gc.dryRun()
      backend.objects = [changed]
      await expect(gc.execute(plan, plan.confirmationToken)).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
      expect(backend.deleted).toEqual([])
    }
  })

  it('取消时不删除并释放已获取的锁', async () => {
    const backend = new FakeBackend()
    backend.objects = [{ id: 'orphan', lastModified: NOW - 31 * DAY, size: 12 }]
    const gc = collector(backend)
    const plan = await gc.dryRun()
    const controller = new AbortController()
    backend.onList = () => controller.abort('user')

    await expect(gc.execute(plan, plan.confirmationToken, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(backend.deleted).toEqual([])
    expect(backend.activeLock).toBeNull()
  })

  it('删除前任一读取或列举失败都 fail closed，并释放锁', async () => {
    const backend = new FakeBackend()
    backend.objects = [{ id: 'orphan', lastModified: NOW - 31 * DAY }]
    const gc = collector(backend)
    const plan = await gc.dryRun()
    backend.onList = () => { throw new Error('network') }

    await expect(gc.execute(plan, plan.confirmationToken)).rejects.toMatchObject({ code: 'IO' })
    expect(backend.deleted).toEqual([])
    expect(backend.activeLock).toBeNull()
  })

  it('清单不存在、对象重复或无效时保守拒绝 GC', async () => {
    const missing = new FakeBackend()
    missing.manifest = null
    await expect(collector(missing).dryRun()).rejects.toMatchObject({ code: 'INVALID_REMOTE' })

    const duplicate = new FakeBackend()
    duplicate.objects = [
      { id: 'same', lastModified: NOW - 31 * DAY },
      { id: 'same', lastModified: NOW - 31 * DAY },
    ]
    await expect(collector(duplicate).dryRun()).rejects.toMatchObject({ code: 'INVALID_REMOTE' })

    const invalid = new FakeBackend()
    invalid.objects = [{ id: 'bad', lastModified: NOW - 31 * DAY, size: -1 }]
    await expect(collector(invalid).dryRun()).rejects.toMatchObject({ code: 'INVALID_REMOTE' })
    expect(missing.activeLock).toBeNull()
    expect(duplicate.activeLock).toBeNull()
    expect(invalid.activeLock).toBeNull()
  })

  it('锁被占用时不读取、不列举、不删除，也不会释放别人的锁', async () => {
    const backend = new FakeBackend()
    backend.activeLock = 'other-owner'
    let read = false
    backend.onRead = () => { read = true }

    await expect(collector(backend).dryRun()).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    expect(read).toBe(false)
    expect(backend.deleted).toEqual([])
    expect(backend.released).toEqual([])
    expect(backend.activeLock).toBe('other-owner')
  })
})

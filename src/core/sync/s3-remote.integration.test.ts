import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { MemoryAdapter } from '../storage/memory-adapter'
import { synchronize } from './engine'
import { createS3Remote, type MultipartJournal, type MultipartUploadRecord } from './s3-remote'
import { initializeVault } from './vault'
import type { S3Credentials, SyncConfig } from './types'

const endpoint = process.env.LIGHT_S3_ENDPOINT ?? ''
const bucket = process.env.LIGHT_S3_BUCKET ?? ''
const accessKeyId = process.env.LIGHT_S3_ACCESS_KEY ?? ''
const secretAccessKey = process.env.LIGHT_S3_SECRET_KEY ?? ''
const region = process.env.LIGHT_S3_REGION ?? 'auto'
const enabled = Boolean(endpoint && bucket && accessKeyId && secretAccessKey)
const prefix = `codex-e2e/${Date.now()}-${crypto.randomUUID()}`

const config: SyncConfig = {
  version: 1,
  enabled: true,
  endpoint,
  region,
  bucket,
  prefix,
  forcePathStyle: true,
  autoSync: false,
  conflictPolicy: 'keep-both',
  attachmentPolicy: { enabled: true, maxSizeMb: 0, excludedExtensions: [] },
}
const credentials: S3Credentials = { accessKeyId, secretAccessKey }

const suite = enabled ? describe : describe.skip

suite('真实 S3 兼容服务', () => {
  const client = new S3Client({ endpoint, region, forcePathStyle: true, credentials })
  let vaultKey: Uint8Array

  beforeAll(async () => {
    const initialized = await initializeVault(`integration-${crypto.randomUUID()}`)
    vaultKey = initialized.vaultKey
    const control = await createS3Remote(config, credentials)
    await control.writeKeyDocument(initialized.keyDoc, null)
  }, 30_000)

  afterAll(async () => {
    let token: string | undefined
    do {
      const page = await client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefix}/`,
        ContinuationToken: token,
      }))
      const objects = (page.Contents ?? []).flatMap((item) => item.Key ? [{ Key: item.Key }] : [])
      if (objects.length) await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }))
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
    client.destroy()
    vaultKey?.fill(0)
  })

  it('完成连接、首次上传、另一设备下载和反向更新', async () => {
    const remote = await createS3Remote(config, credentials, { vaultKey })
    await remote.testConnection()

    const first = new MemoryAdapter()
    const second = new MemoryAdapter()
    await first.writeText('端到端.md', '# 来自设备 A\n\n第一版')

    const uploaded = await synchronize({
      storage: first,
      remote,
      deviceId: 'integration-a',
      conflictPolicy: 'keep-both',
    })
    expect(uploaded.uploaded).toBe(1)

    const downloaded = await synchronize({
      storage: second,
      remote,
      deviceId: 'integration-b',
      conflictPolicy: 'keep-both',
    })
    expect(downloaded.downloaded).toBe(1)
    expect(await second.readText('端到端.md')).toContain('设备 A')

    await second.writeText('端到端.md', '# 来自设备 B\n\n第二版')
    expect((await synchronize({
      storage: second,
      remote,
      deviceId: 'integration-b',
      conflictPolicy: 'keep-both',
    })).uploaded).toBe(1)

    expect((await synchronize({
      storage: first,
      remote,
      deviceId: 'integration-a',
      conflictPolicy: 'keep-both',
    })).downloaded).toBe(1)
    expect(await first.readText('端到端.md')).toContain('设备 B')
  }, 30_000)

  it('可条件接管过期维护锁，且拒绝非所有者释放', async () => {
    const remote = await createS3Remote(config, credentials, { vaultKey })
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}/.light-sync/maintenance.lock`,
      Body: JSON.stringify({ version: 1, token: 'expired-owner', expiresAt: 1 }),
      ContentType: 'application/json',
      IfNoneMatch: '*',
    }))
    await remote.acquireMaintenanceLock('current-owner')
    await expect(remote.releaseMaintenanceLock('other-owner')).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    await remote.releaseMaintenanceLock('current-owner')
  }, 30_000)

  it('远端清单、路径、内容和对象名均不泄漏明文', async () => {
    const remote = await createS3Remote(config, credentials, { vaultKey })
    const storage = new MemoryAdapter()
    await storage.writeText('绝密路径.md', '绝密正文-不应出现在 S3')
    await synchronize({ storage, remote, deviceId: 'privacy', conflictPolicy: 'keep-both' })

    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/.light-sync/` }))
    const keys = (page.Contents ?? []).flatMap((item) => item.Key ? [item.Key] : [])
    const plaintextHash = await awaitHash('绝密正文-不应出现在 S3')
    expect(keys.some((item) => item.includes('绝密路径') || item.includes(plaintextHash))).toBe(false)
    for (const objectKey of keys.filter((item) => !item.endsWith('key.json'))) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }))
      const raw = await response.Body?.transformToString() ?? ''
      expect(raw).not.toContain('绝密路径.md')
      expect(raw).not.toContain('绝密正文-不应出现在 S3')
    }
  }, 30_000)

  it('以流式分帧和 multipart 往返 17 MiB 对象', async () => {
    const remote = await createS3Remote(config, credentials, { vaultKey })
    const source = new MemoryAdapter()
    const target = new MemoryAdapter()
    const large = new Uint8Array(17 * 1024 * 1024)
    for (let index = 0; index < large.byteLength; index += 1) large[index] = index % 251
    await source.writeBinary('assets/large.bin', large)
    expect((await synchronize({ storage: source, remote, deviceId: 'large-a', conflictPolicy: 'keep-both' })).uploaded).toBeGreaterThan(0)
    expect((await synchronize({ storage: target, remote, deviceId: 'large-b', conflictPolicy: 'keep-both' })).downloaded).toBeGreaterThan(0)
    const downloaded = await target.readBinary('assets/large.bin')
    expect(downloaded.byteLength).toBe(large.byteLength)
    expect(await bytesHash(downloaded)).toBe(await bytesHash(large))
  }, 120_000)

  it('取消 multipart 后使用本机 journal 恢复同一加密对象', async () => {
    const large = new Uint8Array(17 * 1024 * 1024).fill(23)
    const hash = await bytesHash(large)
    const controller = new AbortController()
    const journal = new TestMultipartJournal(() => controller.abort())
    const interrupted = await createS3Remote(config, credentials, { vaultKey, multipartJournal: journal })

    await expect(interrupted.writeContentChunks!(hash, large.byteLength, chunksOf(large), controller.signal))
      .rejects.toMatchObject({ code: 'CANCELLED' })
    expect(journal.record?.parts).toHaveLength(1)

    journal.onFirstCompletedPart = undefined
    const resumed = await createS3Remote(config, credentials, { vaultKey, multipartJournal: journal })
    await resumed.writeContentChunks!(hash, large.byteLength, chunksOf(large))
    expect(journal.record).toBeNull()
    const downloaded = await resumed.readContent(hash)
    expect(await bytesHash(downloaded)).toBe(hash)
  }, 120_000)
})

class TestMultipartJournal implements MultipartJournal {
  record: MultipartUploadRecord | null = null

  constructor(public onFirstCompletedPart?: () => void) {}

  async load(): Promise<MultipartUploadRecord | null> {
    return this.record ? structuredClone(this.record) : null
  }

  async save(_id: string, record: MultipartUploadRecord): Promise<void> {
    this.record = structuredClone(record)
    if (record.parts.length === 1) this.onFirstCompletedPart?.()
  }

  async remove(): Promise<void> {
    this.record = null
  }
}

async function* chunksOf(value: Uint8Array): AsyncIterable<Uint8Array> {
  const size = 1024 * 1024
  for (let offset = 0; offset < value.byteLength; offset += size) yield value.subarray(offset, offset + size)
}

async function awaitHash(value: string): Promise<string> {
  return bytesHash(new TextEncoder().encode(value))
}

async function bytesHash(value: Uint8Array): Promise<string> {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

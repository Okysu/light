import type { S3Credentials, SyncConfig, SyncRemote, RemoteManifest, RemoteManifestSnapshot } from './types'
import { SyncError } from './types'
import { SyncCryptoError, decryptBytes, deriveVaultSubkey, encryptBytes, keyedObjectId } from './crypto'
import { FramedCryptoError, decryptFramedStream, encryptFramedStream, framedCiphertextSize } from './framed-crypto'
import type { RemoteGcBackend, RemoteGcOwnedContent } from './gc'

export interface MultipartUploadRecord {
  key: string
  uploadId: string
  size: number
  parts: Array<{ ETag: string; PartNumber: number }>
  updatedAt: number
  /** framed encryption v1 的 64-bit nonce prefix；使暂停后可重建完全相同的分片。 */
  noncePrefix: string
}

export interface MultipartJournal {
  load(id: string): Promise<MultipartUploadRecord | null>
  save(id: string, record: MultipartUploadRecord): Promise<void>
  remove(id: string): Promise<void>
}

export interface S3RemoteOptions {
  multipartJournal?: MultipartJournal
  /** 未解锁时仍可测试连接和读取 key document，但禁止访问同步内容。 */
  vaultKey?: Uint8Array
}

export interface RemoteKeyDocumentSnapshot {
  document: unknown
  etag: string | null
}

export interface S3VaultRemote extends SyncRemote, RemoteGcBackend {
  readKeyDocument(signal?: AbortSignal): Promise<RemoteKeyDocumentSnapshot | null>
  writeKeyDocument(document: unknown, previousEtag: string | null, signal?: AbortSignal): Promise<void>
  /** 开发期显式重置：只删除当前 prefix 下 Light 自己的 `.light-sync/` 对象。 */
  resetProtocolData(signal?: AbortSignal): Promise<number>
}

/**
 * S3 只保存两类对象：内容寻址的不可变 blob，以及一份受 ETag 条件保护的清单。
 * 先传 blob、最后 CAS 清单；即使两台设备同时同步，也只会留下无害的孤立 blob，
 * 不会把某个路径静默指到错误内容。
 */
export async function createS3Remote(
  config: SyncConfig,
  credentials: S3Credentials,
  options: S3RemoteOptions = {},
): Promise<S3VaultRemote> {
  const {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    ListPartsCommand,
    PutObjectCommand,
    S3Client,
    UploadPartCommand,
  } = await import('@aws-sdk/client-s3')

  const MULTIPART_THRESHOLD = 16 * 1024 * 1024
  const PART_SIZE = 8 * 1024 * 1024
  const LOCK_TTL_MS = 30 * 60 * 1000

  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials,
  })

  const key = (suffix: string) => [config.prefix, '.light-sync', suffix].filter(Boolean).join('/')
  const manifestKey = key('manifest.json')
  const keyDocumentKey = key('key.json')
  const maintenanceLockKey = key('maintenance.lock')
  const manifestAad = new TextEncoder().encode('light-sync:v1:manifest')

  function requireVaultKey(): Uint8Array {
    if (!options.vaultKey || options.vaultKey.byteLength !== 32) {
      throw new SyncError('S3 Vault 尚未解锁', 'NOT_CONFIGURED')
    }
    return options.vaultKey
  }

  function manifestEncryptionKey(): Promise<Uint8Array<ArrayBuffer>> {
    return deriveVaultSubkey(requireVaultKey(), 'manifest-encryption')
  }

  async function readManifest(signal?: AbortSignal): Promise<RemoteManifestSnapshot | null> {
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: manifestKey }), { abortSignal: signal })
      if (!response.Body) throw new SyncError('远端同步清单没有内容', 'INVALID_REMOTE')
      const raw = await response.Body.transformToString()
      const envelope = parseJson(raw, '远端加密同步清单已损坏')
      const plaintext = await decryptBytes(envelope, await manifestEncryptionKey(), manifestAad)
      return { manifest: parseManifest(new TextDecoder().decode(plaintext)), etag: response.ETag ?? null }
    } catch (cause) {
      if (statusOf(cause) === 404 || nameOf(cause) === 'NoSuchKey') return null
      throw mapS3Error(cause, '读取远端同步清单失败')
    }
  }

  async function writeManifest(manifest: RemoteManifest, previousEtag: string | null, signal?: AbortSignal): Promise<void> {
    const lockToken = `sync-${crypto.randomUUID()}`
    let locked = false
    try {
      await acquireMaintenanceLock(lockToken, signal)
      locked = true
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: manifestKey,
          Body: JSON.stringify(await encryptBytes(
            new TextEncoder().encode(JSON.stringify(manifest)),
            await manifestEncryptionKey(),
            manifestAad,
          )),
          ContentType: 'application/json',
          ...(previousEtag ? { IfMatch: previousEtag } : { IfNoneMatch: '*' }),
        }), { abortSignal: signal },
      )
    } catch (cause) {
      const status = statusOf(cause)
      if (status === 409 || status === 412) {
        throw new SyncError('远端刚被另一台设备更新，请重试同步', 'REMOTE_CHANGED', { cause })
      }
      throw mapS3Error(cause, '提交远端同步清单失败')
    } finally {
      if (locked) await releaseMaintenanceLock(lockToken)
    }
  }

  async function readContent(hash: string, signal?: AbortSignal): Promise<Uint8Array> {
    return collectBytes(readContentChunks(hash, signal), signal)
  }

  async function* readContentChunks(hash: string, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    const vaultKey = requireVaultKey()
    const objectId = await contentObjectId(vaultKey, hash)
    const contentKey = await deriveVaultSubkey(vaultKey, 'content-encryption')
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key(`objects/${objectId}`) }), { abortSignal: signal })
      if (!response.Body) throw new SyncError(`远端内容缺失：${hash}`, 'INVALID_REMOTE')
      yield* decryptFramedStream(bodyChunks(response.Body), { key: contentKey, objectId, signal })
    } catch (cause) {
      throw mapS3Error(cause, `下载远端内容失败：${hash}`)
    }
  }

  async function writeContent(hash: string, contents: Uint8Array, signal?: AbortSignal): Promise<void> {
    await writeContentChunks(hash, contents.byteLength, oneChunk(contents), signal)
  }

  async function writeContentChunks(
    hash: string,
    plaintextSize: number,
    contents: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void> {
    const vaultKey = requireVaultKey()
    const objectId = await contentObjectId(vaultKey, hash)
    const contentKey = await deriveVaultSubkey(vaultKey, 'content-encryption')
    const encryptedSize = framedCiphertextSize(plaintextSize)
    if (encryptedSize >= BigInt(MULTIPART_THRESHOLD)) {
      await writeFramedMultipart(hash, objectId, plaintextSize, contents, contentKey, signal)
      return
    }
    const encrypted = await collectBytes(encryptFramedStream(contents, {
      key: contentKey,
      objectId,
      totalPlaintextBytes: plaintextSize,
      signal,
    }), signal)
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key(`objects/${objectId}`),
          Body: encrypted,
          IfNoneMatch: '*',
        }), { abortSignal: signal },
      )
    } catch (cause) {
      // 对象 ID 是 Vault key 对明文 SHA-256 的 HMAC；已存在即可安全复用。
      if (statusOf(cause) === 412) return
      throw mapS3Error(cause, `上传内容失败：${hash}`)
    }
  }

  async function writeFramedMultipart(
    journalId: string,
    objectId: string,
    plaintextSize: number,
    contents: AsyncIterable<Uint8Array>,
    vaultKey: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void> {
    const objectKey = key(`objects/${objectId}`)
    try {
      await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }), { abortSignal: signal })
      return
    } catch (cause) {
      if (statusOf(cause) !== 404 && nameOf(cause) !== 'NotFound' && nameOf(cause) !== 'NoSuchKey') {
        throw mapS3Error(cause, `检查远端内容失败：${journalId}`)
      }
    }

    let uploadId: string | undefined
    let parts: Array<{ ETag: string; PartNumber: number }> = []
    let noncePrefix = randomNoncePrefix()
    try {
      const saved = await options.multipartJournal?.load(journalId)
      if (saved && saved.key === objectKey && saved.size === plaintextSize && saved.noncePrefix) {
        const decoded = decodeNoncePrefix(saved.noncePrefix)
        if (decoded) {
          uploadId = saved.uploadId
          noncePrefix = decoded
          try {
            parts = await remoteParts(objectKey, uploadId, signal)
            if (parts.some((part, index) => part.PartNumber !== index + 1)) {
              throw new SyncError('远端 multipart 分片序号不连续，拒绝恢复', 'INVALID_REMOTE')
            }
          } catch (cause) {
            if (nameOf(cause) !== 'NoSuchUpload' && statusOf(cause) !== 404) throw cause
            uploadId = undefined
            await options.multipartJournal?.remove(journalId)
          }
        }
      }
      if (!uploadId) {
        const created = await client.send(new CreateMultipartUploadCommand({
          Bucket: config.bucket,
          Key: objectKey,
          ContentType: 'application/octet-stream',
        }), { abortSignal: signal })
        uploadId = created.UploadId
        if (!uploadId) throw new SyncError('S3 未返回分片上传标识', 'IO')
        parts = []
        noncePrefix = randomNoncePrefix()
        await saveMultipartRecord(journalId, objectKey, uploadId, plaintextSize, parts, noncePrefix)
      }

      const encrypted = encryptFramedStream(contents, {
        key: vaultKey,
        objectId,
        totalPlaintextBytes: plaintextSize,
        noncePrefix,
        signal,
      })
      if (framedCiphertextSize(plaintextSize) > BigInt(PART_SIZE) * 10_000n) {
        throw new SyncError('对象过大，超过当前 8 MiB 分片协议的 10,000 片上限', 'IO')
      }
      let partNumber = 0
      for await (const body of fixedSizeParts(encrypted, PART_SIZE, signal)) {
        partNumber += 1
        if (partNumber <= parts.length) continue
        const response = await client.send(new UploadPartCommand({
          Bucket: config.bucket,
          Key: objectKey,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
        }), { abortSignal: signal })
        if (!response.ETag) throw new SyncError(`第 ${partNumber} 个分片缺少 ETag`, 'IO')
        parts.push({ ETag: response.ETag, PartNumber: partNumber })
        await saveMultipartRecord(journalId, objectKey, uploadId, plaintextSize, parts, noncePrefix)
      }

      await client.send(new CompleteMultipartUploadCommand({
        Bucket: config.bucket,
        Key: objectKey,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }), { abortSignal: signal })
      await options.multipartJournal?.remove(journalId)
    } catch (cause) {
      if (uploadId && !isRecoverableUploadError(cause, signal)) {
        try {
          await client.send(new AbortMultipartUploadCommand({ Bucket: config.bucket, Key: objectKey, UploadId: uploadId }))
        } catch { /* 服务端生命周期规则可继续清理。 */ }
        await options.multipartJournal?.remove(journalId)
      }
      throw mapS3Error(cause, `分片上传失败：${journalId}`)
    }
  }

  async function remoteParts(
    objectKey: string,
    uploadId: string,
    signal?: AbortSignal,
  ): Promise<Array<{ ETag: string; PartNumber: number }>> {
    const result: Array<{ ETag: string; PartNumber: number }> = []
    let marker: string | undefined
    do {
      const page = await client.send(new ListPartsCommand({
        Bucket: config.bucket,
        Key: objectKey,
        UploadId: uploadId,
        PartNumberMarker: marker,
      }), { abortSignal: signal })
      for (const part of page.Parts ?? []) {
        if (part.ETag && part.PartNumber) result.push({ ETag: part.ETag, PartNumber: part.PartNumber })
      }
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined
    } while (marker)
    return result.sort((a, b) => a.PartNumber - b.PartNumber)
  }

  async function saveMultipartRecord(
    id: string,
    objectKey: string,
    uploadId: string,
    size: number,
    parts: Array<{ ETag: string; PartNumber: number }>,
    noncePrefix: Uint8Array,
  ): Promise<void> {
    await options.multipartJournal?.save(id, {
      key: objectKey,
      uploadId,
      size,
      parts: parts.map((part) => ({ ...part })),
      updatedAt: Date.now(),
      noncePrefix: encodeNoncePrefix(noncePrefix),
    })
  }

  async function testConnection(signal?: AbortSignal): Promise<void> {
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }), { abortSignal: signal })
    } catch (cause) {
      throw mapS3Error(cause, '无法访问 Bucket')
    }
  }

  async function readKeyDocument(signal?: AbortSignal): Promise<RemoteKeyDocumentSnapshot | null> {
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: keyDocumentKey }), { abortSignal: signal })
      if (!response.Body) throw new SyncError('远端 Vault key document 没有内容', 'INVALID_REMOTE')
      return {
        document: parseJson(await response.Body.transformToString(), '远端 Vault key document 已损坏'),
        etag: response.ETag ?? null,
      }
    } catch (cause) {
      if (statusOf(cause) === 404 || nameOf(cause) === 'NoSuchKey') return null
      throw mapS3Error(cause, '读取远端 Vault key document 失败')
    }
  }

  async function writeKeyDocument(document: unknown, previousEtag: string | null, signal?: AbortSignal): Promise<void> {
    try {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: keyDocumentKey,
        Body: JSON.stringify(document),
        ContentType: 'application/json',
        ...(previousEtag ? { IfMatch: previousEtag } : { IfNoneMatch: '*' }),
      }), { abortSignal: signal })
    } catch (cause) {
      if (statusOf(cause) === 409 || statusOf(cause) === 412) {
        throw new SyncError('远端 Vault 已被另一台设备初始化或更新', 'REMOTE_CHANGED', { cause })
      }
      throw mapS3Error(cause, '写入远端 Vault key document 失败')
    }
  }

  async function resetProtocolData(signal?: AbortSignal): Promise<number> {
    const protocolPrefix = `${key('')}/`
    let continuationToken: string | undefined
    const keys: string[] = []
    do {
      const page = await client.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: protocolPrefix,
        ContinuationToken: continuationToken,
      }), { abortSignal: signal })
      keys.push(...(page.Contents ?? []).flatMap((item) => item.Key ? [item.Key] : []))
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (continuationToken)
    for (let offset = 0; offset < keys.length; offset += 1000) {
      const batch = keys.slice(offset, offset + 1000)
      if (!batch.length) continue
      await client.send(new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Quiet: true, Objects: batch.map((Key) => ({ Key })) },
      }), { abortSignal: signal })
    }
    return keys.length
  }

  async function listContents(signal?: AbortSignal) {
    const objects: Array<{ hash: string; lastModified: number | null; size?: number }> = []
    const objectPrefix = key('objects/')
    let continuationToken: string | undefined
    do {
      const page = await client.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: objectPrefix,
        ContinuationToken: continuationToken,
      }), { abortSignal: signal })
      for (const item of page.Contents ?? []) {
        const hash = item.Key?.slice(objectPrefix.length)
        if (hash && /^[a-f0-9]{64}$/.test(hash)) {
          objects.push({ hash, lastModified: item.LastModified?.getTime() ?? null, ...(item.Size === undefined ? {} : { size: item.Size }) })
        }
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (continuationToken)
    return objects
  }

  async function acquireMaintenanceLock(token: string, signal?: AbortSignal): Promise<void> {
    const body = () => JSON.stringify({ version: 1, token, expiresAt: Date.now() + LOCK_TTL_MS })
    try {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: maintenanceLockKey,
        Body: body(),
        ContentType: 'application/json',
        IfNoneMatch: '*',
      }), { abortSignal: signal })
    } catch (cause) {
      if (statusOf(cause) === 409 || statusOf(cause) === 412) {
        const current = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: maintenanceLockKey }), { abortSignal: signal })
        if (!current.Body || !current.ETag) throw new SyncError('远端维护锁缺少内容或 ETag', 'INVALID_REMOTE')
        const lock = parseMaintenanceLock(await current.Body.transformToString())
        if (lock.expiresAt > Date.now()) {
          throw new SyncError('远端正在提交清单或执行维护，请稍后重试', 'REMOTE_CHANGED', { cause })
        }
        try {
          await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: maintenanceLockKey, IfMatch: current.ETag }), { abortSignal: signal })
          await client.send(new PutObjectCommand({
            Bucket: config.bucket,
            Key: maintenanceLockKey,
            Body: body(),
            ContentType: 'application/json',
            IfNoneMatch: '*',
          }), { abortSignal: signal })
          return
        } catch (retryCause) {
          if (statusOf(retryCause) === 409 || statusOf(retryCause) === 412) {
            throw new SyncError('远端维护锁刚被其它设备取得，请稍后重试', 'REMOTE_CHANGED', { cause: retryCause })
          }
          throw mapS3Error(retryCause, '接管已过期的远端维护锁失败')
        }
      }
      throw mapS3Error(cause, '获取远端维护锁失败')
    }
  }

  async function releaseMaintenanceLock(token: string): Promise<void> {
    try {
      const current = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: maintenanceLockKey }))
      if (!current.Body || !current.ETag) throw new SyncError('远端维护锁缺少内容或 ETag', 'INVALID_REMOTE')
      if (parseMaintenanceLock(await current.Body.transformToString()).token !== token) {
        throw new SyncError('拒绝释放不属于当前操作的远端维护锁', 'REMOTE_CHANGED')
      }
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: maintenanceLockKey, IfMatch: current.ETag }))
    } catch (cause) {
      if (statusOf(cause) === 404 || nameOf(cause) === 'NoSuchKey') return
      throw mapS3Error(cause, '释放远端维护锁失败')
    }
  }

  async function referencedContentIds(manifest: RemoteManifest): Promise<string[]> {
    const vaultKey = requireVaultKey()
    return Promise.all(Object.values(manifest.entries).flatMap((entry) =>
      !entry.deleted && entry.hash ? [contentObjectId(vaultKey, entry.hash)] : [],
    ))
  }

  async function listOwnedContents(signal?: AbortSignal): Promise<RemoteGcOwnedContent[]> {
    return (await listContents(signal)).map((item) => ({
      id: item.hash,
      lastModified: item.lastModified,
      ...(item.size === undefined ? {} : { size: item.size }),
    }))
  }

  async function deleteOwnedContents(ids: string[], signal?: AbortSignal): Promise<void> {
    if (ids.some((id) => !/^[a-f0-9]{64}$/.test(id))) throw new SyncError('GC 内容对象 ID 无效', 'INVALID_REMOTE')
    await deleteContents(ids, signal)
  }

  async function deleteContents(hashes: string[], signal?: AbortSignal): Promise<void> {
    for (let offset = 0; offset < hashes.length; offset += 1000) {
      const batch = hashes.slice(offset, offset + 1000)
      if (!batch.length) continue
      await client.send(new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Quiet: true, Objects: batch.map((hash) => ({ Key: key(`objects/${hash}`) })) },
      }), { abortSignal: signal })
    }
  }

  return {
    readManifest,
    writeManifest,
    readContent,
    writeContent,
    readContentChunks,
    writeContentChunks,
    testConnection,
    listContents,
    deleteContents,
    readKeyDocument,
    writeKeyDocument,
    resetProtocolData,
    acquireMaintenanceLock,
    releaseMaintenanceLock,
    referencedContentIds,
    listOwnedContents,
    deleteOwnedContents,
  } satisfies S3VaultRemote
}

async function contentObjectId(vaultKey: Uint8Array, hash: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new SyncError('内容哈希格式无效', 'INVALID_REMOTE')
  return keyedObjectId(await deriveVaultSubkey(vaultKey, 'object-id'), new TextEncoder().encode(`content:${hash}`))
}

function parseJson(raw: string, message: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (cause) {
    throw new SyncError(message, 'INVALID_REMOTE', { cause })
  }
}

function parseMaintenanceLock(raw: string): { token: string; expiresAt: number } {
  const value = parseJson(raw, '远端维护锁已损坏') as Record<string, unknown>
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'expiresAt,token,version'
    || value.version !== 1 || typeof value.token !== 'string' || !value.token
    || !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) <= 0) {
    throw new SyncError('远端维护锁已损坏', 'INVALID_REMOTE')
  }
  return { token: value.token, expiresAt: Number(value.expiresAt) }
}

function parseManifest(raw: string): RemoteManifest {
  try {
    const value = JSON.parse(raw) as Partial<RemoteManifest>
    if (value.version !== 1 || !value.entries || typeof value.entries !== 'object') throw new Error('结构不兼容')
    return { version: 1, entries: value.entries, updatedAt: Number(value.updatedAt) || 0 }
  } catch (cause) {
    throw new SyncError('远端同步清单已损坏或版本不兼容', 'INVALID_REMOTE', { cause })
  }
}

function mapS3Error(cause: unknown, prefix: string): SyncError {
  if (cause instanceof SyncError) return cause
  if (cause instanceof SyncCryptoError) {
    return new SyncError(
      cause.code === 'AUTHENTICATION_FAILED' ? `${prefix}：Vault 密钥错误或数据遭篡改` : `${prefix}：加密数据无效`,
      cause.code === 'AUTHENTICATION_FAILED' ? 'AUTH' : 'INVALID_REMOTE',
      { cause },
    )
  }
  if (cause instanceof FramedCryptoError) {
    if (cause.code === 'CANCELLED') return new SyncError('同步已取消', 'CANCELLED', { cause })
    return new SyncError(`${prefix}：加密对象验证失败`, 'INVALID_REMOTE', { cause })
  }
  if (nameOf(cause) === 'AbortError') return new SyncError('同步已取消', 'CANCELLED', { cause })
  const status = statusOf(cause)
  if (status === 401 || status === 403) return new SyncError(`${prefix}：凭据无效或没有权限`, 'AUTH', { cause })
  if (status === 0 || !status) return new SyncError(`${prefix}：网络不可用，或端点未允许浏览器跨域访问`, 'NETWORK', { cause })
  return new SyncError(`${prefix}（${nameOf(cause) || status}）`, 'IO', { cause })
}

function statusOf(cause: unknown): number | undefined {
  return (cause as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
}

function nameOf(cause: unknown): string {
  return (cause as { name?: string })?.name ?? ''
}

function isRecoverableUploadError(cause: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || nameOf(cause) === 'AbortError') return true
  const status = statusOf(cause)
  return !status || status === 408 || status === 429 || status >= 500
}

async function* oneChunk(contents: Uint8Array): AsyncIterable<Uint8Array> {
  yield contents
}

async function collectBytes(source: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let total = 0
  for await (const part of source) {
    if (signal?.aborted) throw signal.reason
    parts.push(part)
    total += part.byteLength
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

async function* fixedSizeParts(
  source: AsyncIterable<Uint8Array>,
  partSize: number,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  let buffer = new Uint8Array(partSize)
  let used = 0
  for await (const chunk of source) {
    if (signal?.aborted) throw signal.reason
    let offset = 0
    while (offset < chunk.byteLength) {
      const copied = Math.min(partSize - used, chunk.byteLength - offset)
      buffer.set(chunk.subarray(offset, offset + copied), used)
      used += copied
      offset += copied
      if (used === partSize) {
        yield buffer
        buffer = new Uint8Array(partSize)
        used = 0
      }
    }
  }
  if (used) yield buffer.slice(0, used)
}

async function* bodyChunks(body: unknown): AsyncIterable<Uint8Array> {
  const asyncBody = body as { [Symbol.asyncIterator]?: () => AsyncIterator<unknown> }
  if (typeof asyncBody[Symbol.asyncIterator] === 'function') {
    for await (const chunk of asyncBody as AsyncIterable<unknown>) yield asBytes(chunk)
    return
  }
  const streamBody = body as { transformToWebStream?: () => ReadableStream<Uint8Array> }
  if (typeof streamBody.transformToWebStream === 'function') {
    const reader = streamBody.transformToWebStream().getReader()
    try {
      while (true) {
        const result = await reader.read()
        if (result.done) return
        yield result.value
      }
    } finally {
      reader.releaseLock()
    }
  }
  throw new SyncError('S3 响应体不支持流式读取', 'IO')
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (typeof value === 'string') return new TextEncoder().encode(value)
  throw new SyncError('S3 返回了无法识别的内容分片', 'IO')
}

function randomNoncePrefix(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(8))
}

function encodeNoncePrefix(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeNoncePrefix(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{11}$/.test(value)) return null
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(12, '='))
    const output = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index)
    return output.byteLength === 8 ? output : null
  } catch {
    return null
  }
}

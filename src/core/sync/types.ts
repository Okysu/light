import type { StorageAdapter } from '../storage'
import type { AttachmentSyncPolicy } from './attachment-policy'

export type ConflictPolicy = 'keep-both' | 'manual' | 'prefer-local' | 'prefer-remote'
export type VersionVector = Record<string, number>

/** 会随 Vault 走的公开配置；凭据绝不放在这里。 */
export interface SyncConfig {
  version: 1
  enabled: boolean
  endpoint: string
  region: string
  bucket: string
  prefix: string
  forcePathStyle: boolean
  autoSync: boolean
  conflictPolicy: ConflictPolicy
  attachmentPolicy: AttachmentSyncPolicy
}

export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
}

export interface RemoteEntry {
  hash: string | null
  /** 明文字节数；用于附件策略，删除墓碑固定为 0。 */
  size: number
  vector: VersionVector
  deleted: boolean
  modifiedAt: number
}

export interface RemoteManifest {
  version: 1
  entries: Record<string, RemoteEntry>
  updatedAt: number
}

export interface LocalSyncEntry {
  /** 上次同步完成后，本地文件的哈希；null 表示当时本地不存在。 */
  localHash: string | null
  /** 上次同步时远端条目指向的内容；null 表示删除态或不存在。 */
  remoteHash: string | null
  /** 上次同步时已观察到的远端版本。 */
  vector: VersionVector
}

export interface LocalSyncState {
  version: 1
  deviceId: string
  entries: Record<string, LocalSyncEntry>
  lastSyncedAt: number | null
}

export interface RemoteManifestSnapshot {
  manifest: RemoteManifest
  /** S3 ETag，用于 If-Match 条件写，避免两台设备静默互相覆盖清单。 */
  etag: string | null
}

export interface SyncRemote {
  readManifest(signal?: AbortSignal): Promise<RemoteManifestSnapshot | null>
  writeManifest(manifest: RemoteManifest, previousEtag: string | null, signal?: AbortSignal): Promise<void>
  readContent(hash: string, signal?: AbortSignal): Promise<Uint8Array>
  writeContent(hash: string, contents: Uint8Array, signal?: AbortSignal): Promise<void>
  /** 大对象优先走分块接口；未实现时引擎会兼容旧的整块接口。 */
  readContentChunks?(hash: string, signal?: AbortSignal): AsyncIterable<Uint8Array>
  writeContentChunks?(
    hash: string,
    plaintextSize: number,
    contents: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void>
  testConnection(signal?: AbortSignal): Promise<void>
  listContents?(signal?: AbortSignal): Promise<RemoteContentObject[]>
  deleteContents?(hashes: string[], signal?: AbortSignal): Promise<void>
}

export interface RemoteContentObject {
  hash: string
  lastModified: number | null
  size?: number
}

export interface SyncProgress {
  phase: 'scan' | 'download' | 'upload' | 'commit' | 'cleanup'
  current: number
  total: number
  path?: string
}

export interface SyncResult {
  uploaded: number
  downloaded: number
  deletedLocal: number
  deletedRemote: number
  conflicts: string[]
  finishedAt: number
}

export interface SyncOptions {
  storage: StorageAdapter
  remote: SyncRemote
  deviceId: string
  conflictPolicy: ConflictPolicy
  now?: () => number
  onProgress?: (progress: SyncProgress) => void
  signal?: AbortSignal
  attachmentsDir?: string
  attachmentPolicy?: AttachmentSyncPolicy
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_CONFIGURED'
      | 'AUTH'
      | 'NETWORK'
      | 'REMOTE_CHANGED'
      | 'INVALID_REMOTE'
      | 'CANCELLED'
      | 'IO',
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'SyncError'
  }
}

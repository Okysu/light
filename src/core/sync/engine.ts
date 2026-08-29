import { dirname, extname, joinPath, normalizePath, stem } from '../path'
import type { StorageAdapter } from '../storage'
import { SYNC_STATE_PATH } from './config'
import type { LocalSyncEntry, LocalSyncState, RemoteEntry, RemoteManifest, RemoteManifestSnapshot, SyncOptions, SyncResult, VersionVector } from './types'
import { SyncError } from './types'
import { compareVectors, incrementVector, mergeVectors } from './vector'
import { attachmentSyncDecision, DEFAULT_ATTACHMENT_SYNC_POLICY } from './attachment-policy'
import { createSHA256 } from 'hash-wasm'

const EXCLUDED_ROOTS = new Set(['.git', '.obsidian', 'node_modules', '.light-sync'])
/** 每台设备独立生成的派生状态；同步它会让自动快照索引互相冲突。 */
const LOCAL_ONLY_PREFIXES = ['.light/history']
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 25

interface LocalFile { path: string; hash: string; size: number }
interface UploadAction { path: string; hash: string }
interface DownloadAction { kind: 'download'; path: string; hash: string; expectedLocal?: LocalFile }
interface DeleteAction { kind: 'delete'; path: string; expectedLocal: LocalFile }
interface ConflictCopyAction { kind: 'conflict-copy'; path: string; hash: string }
type LocalAction = DownloadAction | DeleteAction | ConflictCopyAction

interface SyncPlan {
  manifest: RemoteManifest
  nextState: LocalSyncState
  manifestChanged: boolean
  uploads: UploadAction[]
  localActions: LocalAction[]
  result: SyncResult
}

/**
 * 每次尝试都遵循事务边界：扫描快照和纯计划 -> 上传不可变对象 ->
 * CAS 清单 -> 落地本地动作 -> 写同步状态。CAS 失败前绝不修改本地文件。
 */
export async function synchronize(options: SyncOptions): Promise<SyncResult> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    throwIfAborted(options.signal)
    try {
      return await synchronizeAttempt(options)
    } catch (error) {
      if (!isRemoteChanged(error) || attempt === MAX_RETRIES) throw error
      await abortableDelay(RETRY_BASE_DELAY_MS * (2 ** attempt), options.signal)
    }
  }
  throw new SyncError('远端同步清单持续变化，请稍后重试', 'REMOTE_CHANGED')
}

async function synchronizeAttempt(options: SyncOptions): Promise<SyncResult> {
  const now = options.now ?? Date.now
  options.onProgress?.({ phase: 'scan', current: 0, total: 0 })
  const [localFiles, state, remoteSnapshot] = await Promise.all([
    scanLocal(options.storage, options.signal),
    readState(options.storage, options.deviceId),
    options.remote.readManifest(options.signal),
  ])
  throwIfAborted(options.signal)
  const plan = buildPlan(localFiles, state, remoteSnapshot, options, now)

  for (let index = 0; index < plan.uploads.length; index += 1) {
    throwIfAborted(options.signal)
    const upload = plan.uploads[index]!
    options.onProgress?.({ phase: 'upload', current: index, total: plan.uploads.length, path: upload.path })
    const current = await hashChunks(options.storage.readChunks(upload.path, undefined, options.signal), options.signal)
    if (current !== upload.hash) {
      throw new SyncError(`同步扫描后文件又发生了变化，请重试：${upload.path}`, 'IO')
    }
    if (options.remote.writeContentChunks) {
      const size = (await options.storage.stat(upload.path)).size
      await options.remote.writeContentChunks(
        upload.hash,
        size,
        options.storage.readChunks(upload.path, undefined, options.signal),
        options.signal,
      )
    } else {
      await options.remote.writeContent(
        upload.hash,
        await collectChunks(options.storage.readChunks(upload.path, undefined, options.signal), options.signal),
        options.signal,
      )
    }
    plan.result.uploaded += 1
    options.onProgress?.({ phase: 'upload', current: index + 1, total: plan.uploads.length, path: upload.path })
  }

  if (plan.manifestChanged) {
    throwIfAborted(options.signal)
    plan.manifest.updatedAt = now()
    options.onProgress?.({ phase: 'commit', current: 0, total: 1 })
    await options.remote.writeManifest(plan.manifest, remoteSnapshot?.etag ?? null, options.signal)
    options.onProgress?.({ phase: 'commit', current: 1, total: 1 })
  }

  await applyLocalActions(
    plan.localActions,
    localFiles,
    options,
    plan.result,
    now,
    plan.manifestChanged ? undefined : () => assertRemoteUnchanged(options, remoteSnapshot),
  )
  throwIfAborted(options.signal)
  plan.nextState.lastSyncedAt = now()
  await options.storage.writeText(SYNC_STATE_PATH, JSON.stringify(plan.nextState, null, 2))
  plan.result.finishedAt = plan.nextState.lastSyncedAt
  return plan.result
}

function buildPlan(
  localFiles: Map<string, LocalFile>,
  state: LocalSyncState,
  remoteSnapshot: RemoteManifestSnapshot | null,
  options: SyncOptions,
  now: () => number,
): SyncPlan {
  const manifest: RemoteManifest = remoteSnapshot
    ? structuredClone(remoteSnapshot.manifest)
    : { version: 1, entries: {}, updatedAt: 0 }
  validateManifest(manifest)
  const baselineEntries = remoteSnapshot ? state.entries : {}
  const nextState: LocalSyncState = remoteSnapshot
    ? structuredClone(state)
    : { version: 1, deviceId: options.deviceId, entries: {}, lastSyncedAt: null }
  nextState.deviceId = options.deviceId
  const plan: SyncPlan = {
    manifest,
    nextState,
    manifestChanged: false,
    uploads: [],
    localActions: [],
    result: { uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [], finishedAt: 0 },
  }

  const paths = new Set([...localFiles.keys(), ...Object.keys(baselineEntries), ...Object.keys(manifest.entries)])
  const ordered = [...paths]
    .filter(isSyncable)
    .filter((path) => shouldSyncPath(path, localFiles.get(path), manifest.entries[path], options))
    .sort()
  for (let index = 0; index < ordered.length; index += 1) {
    throwIfAborted(options.signal)
    const path = ordered[index]!
    options.onProgress?.({ phase: 'scan', current: index + 1, total: ordered.length, path })
    const local = localFiles.get(path)
    const remote = manifest.entries[path]
    const baseline = baselineEntries[path]
    if (!baseline) {
      reconcileFirstSeen(path, local, remote, plan, options, now)
      continue
    }
    if (!remote) throw new SyncError(`远端同步清单丢失已跟踪条目：${path}`, 'INVALID_REMOTE')

    const localHash = local?.hash ?? null
    const remoteHash = contentHash(remote)
    const localChanged = localHash !== baseline.localHash
    const remoteChanged = remoteHash !== baseline.remoteHash
      || compareVectors(remote.vector, baseline.vector) !== 'equal'
    if (!localChanged && !remoteChanged) continue
    if (localChanged && !remoteChanged) {
      publishLocal(path, local, remote, baseline.vector, plan, options, now)
    } else if (!localChanged && remoteChanged) {
      applyRemote(path, local, remote, plan)
    } else if (localHash === remoteHash) {
      plan.nextState.entries[path] = entryState(localHash, remoteHash, remote.vector)
    } else {
      resolveConflict(path, local, remote, baseline.vector, plan, options, now)
    }
  }
  return plan
}

function reconcileFirstSeen(path: string, local: LocalFile | undefined, remote: RemoteEntry | undefined, plan: SyncPlan, options: SyncOptions, now: () => number): void {
  const localHash = local?.hash ?? null
  const remoteHash = contentHash(remote)
  if (localHash === remoteHash && (local || remote)) {
    plan.nextState.entries[path] = entryState(localHash, remoteHash, remote?.vector ?? {})
  } else if (local && !remote) {
    publishLocal(path, local, remote, {}, plan, options, now)
  } else if (!local && remote) {
    applyRemote(path, local, remote, plan)
  } else if (local && remote) {
    resolveConflict(path, local, remote, {}, plan, options, now)
  }
}

function publishLocal(path: string, local: LocalFile | undefined, remote: RemoteEntry | undefined, baselineVector: VersionVector, plan: SyncPlan, options: SyncOptions, now: () => number): void {
  const vector = incrementVector(mergeVectors(baselineVector, remote?.vector ?? {}), options.deviceId)
  plan.manifestChanged = true
  if (local) {
    plan.uploads.push({ path, hash: local.hash })
    plan.manifest.entries[path] = { hash: local.hash, size: local.size, vector, deleted: false, modifiedAt: now() }
    plan.nextState.entries[path] = entryState(local.hash, local.hash, vector)
  } else {
    plan.result.deletedRemote += 1
    plan.manifest.entries[path] = { hash: null, size: 0, vector, deleted: true, modifiedAt: now() }
    plan.nextState.entries[path] = entryState(null, null, vector)
  }
}

function applyRemote(path: string, local: LocalFile | undefined, remote: RemoteEntry | undefined, plan: SyncPlan): void {
  if (!remote || remote.deleted || !remote.hash) {
    if (local) plan.localActions.push({ kind: 'delete', path, expectedLocal: local })
    plan.nextState.entries[path] = entryState(null, null, remote?.vector ?? {})
  } else {
    plan.localActions.push({ kind: 'download', path, hash: remote.hash, expectedLocal: local })
    plan.nextState.entries[path] = entryState(remote.hash, remote.hash, remote.vector)
  }
}

function resolveConflict(path: string, local: LocalFile | undefined, remote: RemoteEntry, baselineVector: VersionVector, plan: SyncPlan, options: SyncOptions, now: () => number): void {
  plan.result.conflicts.push(path)
  if (options.conflictPolicy === 'prefer-local') {
    publishLocal(path, local, remote, baselineVector, plan, options, now)
  } else if (options.conflictPolicy === 'prefer-remote') {
    applyRemote(path, local, remote, plan)
  } else {
    if (!remote.deleted && remote.hash) plan.localActions.push({ kind: 'conflict-copy', path, hash: remote.hash })
    if (options.conflictPolicy === 'keep-both') {
      publishLocal(path, local, remote, baselineVector, plan, options, now)
    } else {
      plan.nextState.entries[path] = entryState(local?.hash ?? null, contentHash(remote), remote.vector)
    }
  }
}

async function applyLocalActions(
  actions: LocalAction[],
  localFiles: Map<string, LocalFile>,
  options: SyncOptions,
  result: SyncResult,
  now: () => number,
  verifyRemoteBeforeApply?: () => Promise<void>,
): Promise<void> {
  if (actions.length === 0) return
  throwIfAborted(options.signal)
  // 先下载并校验全部内容，避免下载失败造成部分本地落地。
  const staged = new Map<string, string>()
  try {
    for (const action of actions) {
      if (action.kind === 'delete' || staged.has(action.hash)) continue
      const stagingPath = `.light-sync/staging/${crypto.randomUUID()}`
      await stageVerifiedRemoteContent(options, action.hash, stagingPath)
      staged.set(action.hash, stagingPath)
    }
    // 下载可能很慢；真正落地前再做 ETag 屏障，避免检查后的远端竞争窗口。
    await verifyRemoteBeforeApply?.()
    // 对所有破坏性路径做全局预检，扫描后的用户编辑绝不能被覆盖。
    const destructivePaths = new Set(actions.filter((action) => action.kind !== 'conflict-copy').map((action) => action.path))
    for (const path of destructivePaths) await assertLocalUnchanged(options.storage, path, localFiles.get(path))

    for (const action of actions) {
      throwIfAborted(options.signal)
      if (action.kind === 'conflict-copy') {
        const conflictPath = await uniqueConflictPath(options.storage, action.path, now())
        await options.storage.writeChunks(conflictPath, options.storage.readChunks(staged.get(action.hash)!, undefined, options.signal), options.signal)
        result.downloaded += 1
      } else {
        // 再检一次，尽量缩小检查与写入之间的竞态窗口。
        await assertLocalUnchanged(options.storage, action.path, action.expectedLocal)
        if (action.kind === 'delete') {
          await options.storage.remove(action.path)
          result.deletedLocal += 1
        } else {
          options.onProgress?.({ phase: 'download', current: result.downloaded, total: result.downloaded + 1, path: action.path })
          await options.storage.writeChunks(action.path, options.storage.readChunks(staged.get(action.hash)!, undefined, options.signal), options.signal)
          result.downloaded += 1
        }
      }
    }
  } finally {
    for (const stagingPath of staged.values()) {
      try { await options.storage.remove(stagingPath) } catch { /* 尽力清理；残留位于同步排除目录。 */ }
    }
  }
}

async function assertLocalUnchanged(storage: StorageAdapter, path: string, expected: LocalFile | undefined): Promise<void> {
  const exists = await storage.exists(path)
  if (!expected) {
    if (exists) throw new SyncError(`同步扫描后文件又发生了变化，拒绝覆盖：${path}`, 'IO')
  } else if (!exists || await hashChunks(storage.readChunks(path)) !== expected.hash) {
    throw new SyncError(`同步扫描后文件又发生了变化，拒绝覆盖：${path}`, 'IO')
  }
}

async function assertRemoteUnchanged(options: SyncOptions, expected: RemoteManifestSnapshot | null): Promise<void> {
  throwIfAborted(options.signal)
  const actual = await options.remote.readManifest(options.signal)
  if (!sameRemoteSnapshot(expected, actual)) throw new SyncError('远端同步清单已变化', 'REMOTE_CHANGED')
}

function sameRemoteSnapshot(left: RemoteManifestSnapshot | null, right: RemoteManifestSnapshot | null): boolean {
  if (!left || !right) return left === right
  if (left.etag !== null || right.etag !== null) return left.etag === right.etag
  return JSON.stringify(left.manifest) === JSON.stringify(right.manifest)
}

async function scanLocal(storage: StorageAdapter, signal?: AbortSignal): Promise<Map<string, LocalFile>> {
  const files = new Map<string, LocalFile>()
  async function walk(dir: string): Promise<void> {
    throwIfAborted(signal)
    for (const entry of await storage.list(dir)) {
      throwIfAborted(signal)
      if (entry.isDirectory) {
        if (dir === '' && EXCLUDED_ROOTS.has(entry.name)) continue
        await walk(entry.path)
      } else if (isSyncable(entry.path)) {
        const stat = await storage.stat(entry.path)
        files.set(entry.path, { path: entry.path, size: stat.size, hash: await hashChunks(storage.readChunks(entry.path, undefined, signal), signal) })
      }
    }
  }
  await walk('')
  return files
}

function isSyncable(path: string): boolean {
  const normalized = normalizePath(path)
  const root = normalized.split('/')[0] ?? ''
  return path !== SYNC_STATE_PATH
    && !EXCLUDED_ROOTS.has(root)
    && !LOCAL_ONLY_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))
}

function shouldSyncPath(
  path: string,
  local: LocalFile | undefined,
  remote: RemoteEntry | undefined,
  options: SyncOptions,
): boolean {
  if (!options.attachmentsDir) return true
  return attachmentSyncDecision(
    path,
    local?.size ?? remote?.size ?? 0,
    options.attachmentsDir,
    options.attachmentPolicy ?? DEFAULT_ATTACHMENT_SYNC_POLICY,
  ) === 'sync'
}

async function readState(storage: StorageAdapter, deviceId: string): Promise<LocalSyncState> {
  try {
    const raw = JSON.parse(await storage.readText(SYNC_STATE_PATH)) as Partial<LocalSyncState>
    if (raw.version !== 1 || !raw.entries || typeof raw.entries !== 'object') throw new Error('invalid state')
    return { version: 1, deviceId, entries: raw.entries, lastSyncedAt: typeof raw.lastSyncedAt === 'number' ? raw.lastSyncedAt : null }
  } catch {
    return { version: 1, deviceId, entries: {}, lastSyncedAt: null }
  }
}

function entryState(localHash: string | null, remoteHash: string | null, vector: VersionVector): LocalSyncEntry {
  return { localHash, remoteHash, vector: mergeVectors(vector) }
}

function contentHash(entry: RemoteEntry | undefined): string | null {
  return entry && !entry.deleted ? entry.hash : null
}

async function uniqueConflictPath(storage: StorageAdapter, path: string, timestamp: number): Promise<string> {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  const dir = dirname(path)
  const extension = extname(path)
  const base = stem(path)
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? '' : ` ${index}`
    const candidate = joinPath(dir, `${base} (冲突-云端-${stamp}${suffix})${extension}`)
    if (!(await storage.exists(candidate))) return candidate
  }
  throw new SyncError(`无法为冲突副本生成可用文件名：${path}`, 'IO')
}

async function stageVerifiedRemoteContent(options: SyncOptions, expectedHash: string, stagingPath: string): Promise<void> {
  throwIfAborted(options.signal)
  const source = options.remote.readContentChunks
    ? options.remote.readContentChunks(expectedHash, options.signal)
    : singleChunk(await options.remote.readContent(expectedHash, options.signal))
  const hasher = await createSHA256()
  await options.storage.writeChunks(stagingPath, (async function* () {
    for await (const chunk of source) {
      throwIfAborted(options.signal)
      hasher.update(chunk)
      yield chunk
    }
  })(), options.signal)
  if (hasher.digest('hex') !== expectedHash) {
    throw new SyncError(`远端对象校验失败：${expectedHash}`, 'INVALID_REMOTE')
  }
}

async function hashChunks(chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<string> {
  const hasher = await createSHA256()
  for await (const chunk of chunks) {
    throwIfAborted(signal)
    hasher.update(chunk)
  }
  return hasher.digest('hex')
}

async function collectChunks(chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let size = 0
  for await (const chunk of chunks) {
    throwIfAborted(signal)
    parts.push(chunk)
    size += chunk.byteLength
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

async function* singleChunk(contents: Uint8Array): AsyncIterable<Uint8Array> {
  yield contents
}

function isRemoteChanged(error: unknown): error is SyncError {
  return error instanceof SyncError && error.code === 'REMOTE_CHANGED'
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const abort = () => {
      clearTimeout(timer)
      reject(new SyncError('同步已取消', 'CANCELLED', { cause: signal?.reason }))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SyncError('同步已取消', 'CANCELLED', { cause: signal.reason })
}

function validateManifest(manifest: RemoteManifest): void {
  for (const [path, entry] of Object.entries(manifest.entries)) {
    if (!path || normalizePath(path) !== path || !isSyncable(path) || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new SyncError(`远端同步清单包含不安全的路径：${path}`, 'INVALID_REMOTE')
    }
    if (!entry || typeof entry !== 'object' || typeof entry.deleted !== 'boolean'
      || (entry.deleted ? entry.hash !== null : !entry.hash || !/^[a-f0-9]{64}$/.test(entry.hash))
      || !Number.isSafeInteger(entry.size) || entry.size < 0 || (entry.deleted && entry.size !== 0)
      || !entry.vector || typeof entry.vector !== 'object'
      || Object.values(entry.vector).some((counter) => !Number.isSafeInteger(counter) || counter < 0)) {
      throw new SyncError(`远端同步清单条目无效：${path}`, 'INVALID_REMOTE')
    }
  }
}

import type { RemoteManifest, RemoteManifestSnapshot } from './types'
import { SyncError } from './types'

export const DEFAULT_GC_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 后端必须把“Light 自己的内容对象”与 Bucket 中的其他对象隔离开。
 * GC 永远不会接收任意 S3 key，也不会自行拼接或扫描 Bucket 根前缀。
 */
export interface RemoteGcBackend {
  /** 以条件创建语义获取锁；锁已存在时必须拒绝，不能覆盖其他 token。 */
  acquireMaintenanceLock(token: string, signal?: AbortSignal): Promise<void>
  /** 仅当远端仍保存同一个 token 时释放锁。不得删除其他执行者的锁。 */
  releaseMaintenanceLock(token: string): Promise<void>
  readManifest(signal?: AbortSignal): Promise<RemoteManifestSnapshot | null>
  /** 将清单中的明文内容哈希映射为远端 HMAC 对象 ID。 */
  referencedContentIds(manifest: RemoteManifest): Promise<string[]>
  /** 只列出 Light 协议内容目录中的合法内容对象。 */
  listOwnedContents(signal?: AbortSignal): Promise<RemoteGcOwnedContent[]>
  /** 只接受 listOwnedContents 所使用的内容对象 ID。 */
  deleteOwnedContents(ids: string[], signal?: AbortSignal): Promise<void>
}

export interface RemoteGcOwnedContent {
  id: string
  /** 无法可靠取得时间时必须为 null；GC 会保守地跳过该对象。 */
  lastModified: number | null
  size?: number
}

export interface RemoteGcCandidate {
  id: string
  lastModified: number
  size?: number
}

export interface RemoteGcPlan {
  version: 1
  createdAt: number
  cutoff: number
  gracePeriodMs: number
  manifestEtag: string | null
  manifestFingerprint: string
  candidates: RemoteGcCandidate[]
  candidateCount: number
  /** 任一候选没有 size 时为 null，避免把不完整的字节数展示成总量。 */
  candidateBytes: number | null
  skippedReferenced: number
  skippedWithinGrace: number
  skippedUnknownAge: number
  confirmationToken: string
}

export interface RemoteGcResult {
  deletedCount: number
  deletedBytes: number | null
}

export interface RemoteGarbageCollectorOptions {
  now?: () => number
  gracePeriodMs?: number
  createToken?: () => string
}

/**
 * 一次实例持有一次性确认 token 的签发记录。应用重启或实例重建后必须重新 dry-run。
 * 这能避免调用方手工构造或修改计划后直接执行删除。
 */
export class RemoteGarbageCollector {
  private readonly issuedPlans = new Map<string, string>()
  private readonly now: () => number
  private readonly gracePeriodMs: number
  private readonly createToken: () => string

  constructor(
    private readonly backend: RemoteGcBackend,
    options: RemoteGarbageCollectorOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GC_GRACE_PERIOD_MS
    this.createToken = options.createToken ?? (() => crypto.randomUUID())
    if (!Number.isFinite(this.gracePeriodMs) || this.gracePeriodMs < 0) {
      throw new RangeError('GC gracePeriodMs 必须是非负有限数')
    }
  }

  async dryRun(signal?: AbortSignal): Promise<RemoteGcPlan> {
    throwIfCancelled(signal)
    const lockToken = this.createToken()
    return this.withMaintenanceLock(lockToken, signal, async () => {
      const snapshot = requireManifest(await this.backend.readManifest(signal))
      throwIfCancelled(signal)
      const objects = await this.backend.listOwnedContents(signal)
      const referencedIds = await this.backend.referencedContentIds(snapshot.manifest)
      throwIfCancelled(signal)

      const createdAt = this.now()
      if (!Number.isFinite(createdAt)) throw new SyncError('GC 当前时间无效', 'IO')
      const cutoff = createdAt - this.gracePeriodMs
      const summary = buildCandidateSummary(referencedIds, objects, cutoff)
      const planWithoutToken = {
        version: 1 as const,
        createdAt,
        cutoff,
        gracePeriodMs: this.gracePeriodMs,
        manifestEtag: snapshot.etag,
        manifestFingerprint: await manifestFingerprint(snapshot.manifest),
        ...summary,
      }
      const confirmationToken = this.createToken()
      const digest = await planDigest(planWithoutToken)
      this.issuedPlans.set(confirmationToken, digest)
      return { ...planWithoutToken, confirmationToken }
    })
  }

  async execute(
    plan: RemoteGcPlan,
    confirmationToken: string,
    signal?: AbortSignal,
  ): Promise<RemoteGcResult> {
    throwIfCancelled(signal)
    if (confirmationToken !== plan.confirmationToken) {
      throw new SyncError('GC 确认 token 与计划不匹配', 'INVALID_REMOTE')
    }
    const issuedDigest = this.issuedPlans.get(confirmationToken)
    const actualDigest = await planDigest(withoutConfirmationToken(plan))
    if (!issuedDigest || issuedDigest !== actualDigest) {
      throw new SyncError('GC 计划未经签发或已被修改，请重新 dry-run', 'INVALID_REMOTE')
    }

    // token 一次性消费；无论后续成功、取消或失败，都必须重新 dry-run 才能重试。
    this.issuedPlans.delete(confirmationToken)
    const lockToken = this.createToken()
    return this.withMaintenanceLock(lockToken, signal, async () => {
      const snapshot = requireManifest(await this.backend.readManifest(signal))
      throwIfCancelled(signal)
      const fingerprint = await manifestFingerprint(snapshot.manifest)
      if (snapshot.etag !== plan.manifestEtag || fingerprint !== plan.manifestFingerprint) {
        throw new SyncError('远端清单已变化，请重新 dry-run', 'REMOTE_CHANGED')
      }

      const objects = await this.backend.listOwnedContents(signal)
      const referencedIds = await this.backend.referencedContentIds(snapshot.manifest)
      throwIfCancelled(signal)
      const current = buildCandidateSummary(referencedIds, objects, plan.cutoff)
      if (candidateFingerprint(current.candidates) !== candidateFingerprint(plan.candidates)) {
        throw new SyncError('GC 候选对象已变化，请重新 dry-run', 'REMOTE_CHANGED')
      }
      if (current.candidateCount !== plan.candidateCount || current.candidateBytes !== plan.candidateBytes) {
        throw new SyncError('GC 候选统计已变化，请重新 dry-run', 'REMOTE_CHANGED')
      }

      throwIfCancelled(signal)
      if (plan.candidates.length > 0) {
        await this.backend.deleteOwnedContents(plan.candidates.map(({ id }) => id), signal)
      }
      throwIfCancelled(signal)
      return { deletedCount: plan.candidateCount, deletedBytes: plan.candidateBytes }
    })
  }

  private async withMaintenanceLock<T>(
    lockToken: string,
    signal: AbortSignal | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    let acquired = false
    let result: T | undefined
    let actionError: unknown
    try {
      await this.backend.acquireMaintenanceLock(lockToken, signal)
      acquired = true
      throwIfCancelled(signal)
      result = await action()
    } catch (cause) {
      actionError = normalizeError(cause, signal)
    }

    if (acquired) {
      try {
        // 清锁不能沿用已取消的 signal，否则会遗留锁；后端仍须校验 token 所有权。
        await this.backend.releaseMaintenanceLock(lockToken)
      } catch (cause) {
        if (!actionError) throw normalizeError(cause)
      }
    }
    if (actionError) throw actionError
    return result as T
  }
}

function requireManifest(snapshot: RemoteManifestSnapshot | null): RemoteManifestSnapshot {
  // 没有清单时不能证明任何对象是垃圾，保守拒绝清理。
  if (!snapshot) throw new SyncError('远端清单不存在，拒绝执行 GC', 'INVALID_REMOTE')
  return snapshot
}

function buildCandidateSummary(
  referencedIds: string[],
  objects: RemoteGcOwnedContent[],
  cutoff: number,
): Pick<RemoteGcPlan,
  | 'candidates'
  | 'candidateCount'
  | 'candidateBytes'
  | 'skippedReferenced'
  | 'skippedWithinGrace'
  | 'skippedUnknownAge'
> {
  const referenced = new Set(referencedIds)
  const seen = new Set<string>()
  const candidates: RemoteGcCandidate[] = []
  let skippedReferenced = 0
  let skippedWithinGrace = 0
  let skippedUnknownAge = 0

  for (const object of objects) {
    validateOwnedObject(object)
    if (seen.has(object.id)) throw new SyncError(`GC 内容对象重复：${object.id}`, 'INVALID_REMOTE')
    seen.add(object.id)
    if (referenced.has(object.id)) {
      skippedReferenced += 1
    } else if (object.lastModified === null) {
      skippedUnknownAge += 1
    } else if (object.lastModified > cutoff) {
      skippedWithinGrace += 1
    } else {
      candidates.push({
        id: object.id,
        lastModified: object.lastModified,
        ...(object.size === undefined ? {} : { size: object.size }),
      })
    }
  }
  candidates.sort((left, right) => left.id.localeCompare(right.id))
  return {
    candidates,
    candidateCount: candidates.length,
    candidateBytes: totalBytes(candidates),
    skippedReferenced,
    skippedWithinGrace,
    skippedUnknownAge,
  }
}

function validateOwnedObject(object: RemoteGcOwnedContent): void {
  if (!object.id || typeof object.id !== 'string') {
    throw new SyncError('GC 内容对象 ID 无效', 'INVALID_REMOTE')
  }
  if (object.lastModified !== null && !Number.isFinite(object.lastModified)) {
    throw new SyncError(`GC 内容对象时间无效：${object.id}`, 'INVALID_REMOTE')
  }
  if (object.size !== undefined && (!Number.isSafeInteger(object.size) || object.size < 0)) {
    throw new SyncError(`GC 内容对象大小无效：${object.id}`, 'INVALID_REMOTE')
  }
}

function totalBytes(candidates: RemoteGcCandidate[]): number | null {
  if (candidates.some(({ size }) => size === undefined)) return null
  return candidates.reduce((total, { size }) => total + (size ?? 0), 0)
}

function candidateFingerprint(candidates: RemoteGcCandidate[]): string {
  return stableStringify([...candidates].sort((left, right) => left.id.localeCompare(right.id)))
}

function withoutConfirmationToken(plan: RemoteGcPlan): Omit<RemoteGcPlan, 'confirmationToken'> {
  const { confirmationToken: _confirmationToken, ...rest } = plan
  return rest
}

async function planDigest(plan: Omit<RemoteGcPlan, 'confirmationToken'>): Promise<string> {
  return sha256(stableStringify(plan))
}

async function manifestFingerprint(manifest: RemoteManifest): Promise<string> {
  return sha256(stableStringify(manifest))
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SyncError('远端内容清理已取消', 'CANCELLED', { cause: signal.reason })
}

function normalizeError(cause: unknown, signal?: AbortSignal): SyncError {
  if (cause instanceof SyncError) return cause
  if (signal?.aborted || (cause as { name?: string })?.name === 'AbortError') {
    return new SyncError('远端内容清理已取消', 'CANCELLED', { cause })
  }
  return new SyncError('远端内容清理失败', 'IO', { cause })
}

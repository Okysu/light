import { joinPath } from '../path'
import type { StorageAdapter } from '../storage'
import { decryptProtectedText, encryptProtectedText, isProtectedText, readProtectedText } from '../security/local-vault'

export const HISTORY_DIR = '.light/history/v1'
export const DEFAULT_HISTORY_INTERVAL_MS = 5 * 60 * 1000
export const DEFAULT_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
export const DEFAULT_HISTORY_MAX_ENTRIES = 50

export type HistoryReason = 'auto' | 'manual' | 'before-restore'

export interface HistorySource {
  id: string
  path: string
  title: string
  content: string
  sensitive?: boolean
}

export interface HistoryEntry {
  id: string
  createdAt: number
  objectId: string
  byteLength: number
  title: string
  reason: HistoryReason
}

export interface HistorySnapshot {
  version: 1
  noteId: string
  title: string
  content: string
}

interface HistoryIndex {
  version: 1
  noteId: string
  path: string
  entries: HistoryEntry[]
}

export interface HistoryServiceOptions {
  now?: () => number
  newId?: () => string
  intervalMs?: number
  retentionMs?: number
  maxEntries?: number
}

export class HistoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'HistoryError'
  }
}

/**
 * 设备本地的笔记版本历史。
 *
 * 索引按 frontmatter.id 定位，文件改名/移动不会丢历史；内容按 SHA-256 去重。
 * 服务只保存“将被覆盖的上一版”，不介入 NoteRepository 的正文格式。
 */
export class HistoryService {
  private readonly now: () => number
  private readonly newId: () => string
  private readonly intervalMs: number
  private readonly retentionMs: number
  private readonly maxEntries: number

  constructor(
    private readonly storage: StorageAdapter,
    options: HistoryServiceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now())
    this.newId = options.newId ?? (() => crypto.randomUUID())
    this.intervalMs = options.intervalMs ?? DEFAULT_HISTORY_INTERVAL_MS
    this.retentionMs = options.retentionMs ?? DEFAULT_HISTORY_RETENTION_MS
    this.maxEntries = options.maxEntries ?? DEFAULT_HISTORY_MAX_ENTRIES
  }

  async list(noteId: string): Promise<HistoryEntry[]> {
    const index = await this.readIndex(noteId)
    return [...index.entries].sort((left, right) => right.createdAt - left.createdAt)
  }

  async read(noteId: string, entryId: string): Promise<HistorySnapshot> {
    const index = await this.readIndex(noteId)
    const entry = index.entries.find((candidate) => candidate.id === entryId)
    if (!entry) throw new HistoryError('找不到这个历史版本，它可能已被保留策略清理')

    try {
      const parsed = JSON.parse(await readProtectedText(await this.storage.readText(await this.objectPath(noteId, entry.objectId)))) as unknown
      return parseSnapshot(parsed, noteId)
    } catch (cause) {
      if (cause instanceof HistoryError) throw cause
      throw new HistoryError('历史版本内容损坏或无法读取', { cause })
    }
  }

  async capture(
    source: HistorySource,
    options: { force?: boolean; reason?: HistoryReason } = {},
  ): Promise<HistoryEntry | null> {
    if (!source.id.trim()) throw new HistoryError('笔记缺少稳定 ID，无法创建版本历史')

    const timestamp = this.now()
    const index = await this.readIndex(source.id, source.path)
    const snapshot: HistorySnapshot = {
      version: 1,
      noteId: source.id,
      title: source.sensitive ? '敏感笔记' : source.title,
      content: source.content,
    }
    const serialized = JSON.stringify(snapshot)
    const objectId = await sha256(serialized)
    const latest = [...index.entries].sort((left, right) => right.createdAt - left.createdAt)[0]

    // 内容未变时不制造“看起来不同、实际一样”的版本；手动保存同样遵守去重。
    if (latest?.objectId === objectId) return null
    if (!options.force && latest && timestamp - latest.createdAt < this.intervalMs) return null

    const objectPath = await this.objectPath(source.id, objectId)
    if (!(await this.storage.exists(objectPath))) {
      await this.storage.writeText(objectPath, source.sensitive ? await encryptProtectedText(serialized) : serialized)
    }

    const entry: HistoryEntry = {
      id: this.newId(),
      createdAt: timestamp,
      objectId,
      byteLength: new TextEncoder().encode(source.content).byteLength,
      title: source.title,
      reason: options.reason ?? 'auto',
    }

    const cutoff = timestamp - this.retentionMs
    const entries = [entry, ...index.entries]
      .filter((candidate) => candidate.createdAt >= cutoff)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, this.maxEntries)
    await this.storage.writeText(
      await this.indexPath(source.id),
      JSON.stringify({ version: 1, noteId: source.id, path: source.sensitive ? '' : source.path, entries } satisfies HistoryIndex, null, 2),
    )
    await this.removeUnreferencedObjects(source.id, new Set(entries.map((candidate) => candidate.objectId)))
    return entry
  }

  /** 敏感标记变化时同时改写已有历史，避免旧版本把正文或标题留成明文。 */
  async setProtection(noteId: string, protect: boolean, metadata: { path: string; title: string }): Promise<void> {
    const index = await this.readIndex(noteId, metadata.path)
    const directory = await this.noteDirectory(noteId)
    const objects = joinPath(directory, 'objects')
    if (await this.storage.exists(objects)) {
      for (const item of await this.storage.list(objects)) {
        if (item.isDirectory || !item.name.endsWith('.json')) continue
        const raw = await this.storage.readText(item.path)
        if (protect && !isProtectedText(raw)) await this.storage.writeText(item.path, await encryptProtectedText(raw))
        if (!protect && isProtectedText(raw)) await this.storage.writeText(item.path, await decryptProtectedText(raw))
      }
    }
    if (await this.storage.exists(await this.indexPath(noteId))) {
      await this.storage.writeText(await this.indexPath(noteId), JSON.stringify({
        ...index,
        path: protect ? '' : metadata.path,
        entries: index.entries.map((entry) => ({ ...entry, title: protect ? '敏感笔记' : metadata.title })),
      } satisfies HistoryIndex, null, 2))
    }
  }

  private async readIndex(noteId: string, path = ''): Promise<HistoryIndex> {
    const indexPath = await this.indexPath(noteId)
    if (!(await this.storage.exists(indexPath))) {
      return { version: 1, noteId, path, entries: [] }
    }

    try {
      return parseIndex(JSON.parse(await this.storage.readText(indexPath)), noteId)
    } catch (cause) {
      if (cause instanceof HistoryError) throw cause
      throw new HistoryError('版本历史索引损坏；已停止写入以避免覆盖现有历史', { cause })
    }
  }

  private async removeUnreferencedObjects(noteId: string, referenced: ReadonlySet<string>): Promise<void> {
    const directory = await this.noteDirectory(noteId)
    const objects = joinPath(directory, 'objects')
    if (!(await this.storage.exists(objects))) return

    for (const entry of await this.storage.list(objects)) {
      if (entry.isDirectory || !entry.name.endsWith('.json')) continue
      const objectId = entry.name.slice(0, -'.json'.length)
      if (!referenced.has(objectId)) await this.storage.remove(entry.path)
    }
  }

  private async indexPath(noteId: string): Promise<string> {
    return joinPath(await this.noteDirectory(noteId), 'index.json')
  }

  private async objectPath(noteId: string, objectId: string): Promise<string> {
    return joinPath(await this.noteDirectory(noteId), 'objects', `${objectId}.json`)
  }

  private async noteDirectory(noteId: string): Promise<string> {
    return joinPath(HISTORY_DIR, await sha256(`light-history-note-v1\0${noteId}`))
  }
}

function parseIndex(value: unknown, expectedNoteId: string): HistoryIndex {
  if (!isRecord(value) || value.version !== 1 || value.noteId !== expectedNoteId || typeof value.path !== 'string') {
    throw new HistoryError('版本历史索引格式无效')
  }
  if (!Array.isArray(value.entries)) throw new HistoryError('版本历史条目列表无效')

  const entries = value.entries.map((entry): HistoryEntry => {
    if (
      !isRecord(entry)
      || typeof entry.id !== 'string'
      || !Number.isFinite(entry.createdAt)
      || typeof entry.objectId !== 'string'
      || !/^[a-f0-9]{64}$/.test(entry.objectId)
      || !Number.isFinite(entry.byteLength)
      || typeof entry.title !== 'string'
      || !isReason(entry.reason)
    ) {
      throw new HistoryError('版本历史条目格式无效')
    }
    return entry as unknown as HistoryEntry
  })
  return { version: 1, noteId: expectedNoteId, path: value.path, entries }
}

function parseSnapshot(value: unknown, expectedNoteId: string): HistorySnapshot {
  if (
    !isRecord(value)
    || value.version !== 1
    || value.noteId !== expectedNoteId
    || typeof value.title !== 'string'
    || typeof value.content !== 'string'
  ) {
    throw new HistoryError('历史版本内容格式无效')
  }
  return value as unknown as HistorySnapshot
}

function isReason(value: unknown): value is HistoryReason {
  return value === 'auto' || value === 'manual' || value === 'before-restore'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

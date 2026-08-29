import { basename, dirname, joinPath, stem } from '../path'
import { StorageError, type StorageAdapter } from '../storage'
import { kindOf } from './tree'
import { TRASH_DIR, TRASH_MANIFEST_PATH, type NodeKind, type TrashItem } from './types'

/**
 * 软删除。
 *
 * 删除 = 移动到 `.light/trash/` + 在清单中登记原路径，而非物理删除。
 * 清单文件与被删内容都落在工作区内，因此回收站状态天然随 S3 同步扩散到其它设备
 * （对应需求：某设备删除后，其他设备回收站同步感知），无需额外的删除墓碑协议。
 */
export class TrashService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async list(): Promise<TrashItem[]> {
    const items = await this.readManifest()
    return [...items].sort((a, b) => b.deletedAt - a.deletedAt)
  }

  /** 移入回收站，返回归档条目 */
  async trash(path: string): Promise<TrashItem> {
    if (path === '' || path.startsWith(TRASH_DIR)) {
      throw new StorageError('IO', path, '该路径不可被移入回收站')
    }

    const stat = await this.storage.stat(path)
    const kind: NodeKind = stat.isDirectory ? 'folder' : (kindOf(path) ?? 'note')
    const archivedPath = await this.uniqueArchiveName(basename(path))

    await this.storage.mkdir(TRASH_DIR)
    await this.storage.move(path, joinPath(TRASH_DIR, archivedPath))

    const item: TrashItem = { archivedPath, originalPath: path, kind, deletedAt: this.now() }
    await this.writeManifest([...(await this.readManifest()), item])
    return item
  }

  /**
   * 还原到原路径。原路径已被占用或其父目录已不存在时，
   * 分别走「避让后缀」与「重建父目录」，不因此让还原失败。
   * @returns 实际还原到的路径
   */
  async restore(archivedPath: string): Promise<string> {
    const items = await this.readManifest()
    const item = items.find((candidate) => candidate.archivedPath === archivedPath)
    if (!item) throw new StorageError('NOT_FOUND', archivedPath, '回收站中没有该条目')

    const parent = dirname(item.originalPath)
    if (parent) await this.storage.mkdir(parent)

    const target = await this.uniqueRestorePath(item.originalPath)
    await this.storage.move(joinPath(TRASH_DIR, archivedPath), target)
    await this.writeManifest(items.filter((candidate) => candidate.archivedPath !== archivedPath))
    return target
  }

  /** 永久删除单个条目 */
  async purge(archivedPath: string): Promise<void> {
    const items = await this.readManifest()
    await this.storage.remove(joinPath(TRASH_DIR, archivedPath), { recursive: true }).catch(ignoreMissing)
    await this.writeManifest(items.filter((candidate) => candidate.archivedPath !== archivedPath))
  }

  /** 清空回收站 */
  async empty(): Promise<void> {
    for (const item of await this.readManifest()) {
      await this.storage.remove(joinPath(TRASH_DIR, item.archivedPath), { recursive: true }).catch(ignoreMissing)
    }
    await this.writeManifest([])
  }

  /**
   * 清理超过保留期的条目。`retentionDays <= 0` 表示不自动清理。
   * @returns 被清理的条目数
   */
  async autoClean(retentionDays: number): Promise<number> {
    if (retentionDays <= 0) return 0

    const deadline = this.now() - retentionDays * 24 * 60 * 60 * 1000
    const items = await this.readManifest()
    const expired = items.filter((item) => item.deletedAt < deadline)
    if (expired.length === 0) return 0

    for (const item of expired) {
      await this.storage.remove(joinPath(TRASH_DIR, item.archivedPath), { recursive: true }).catch(ignoreMissing)
    }
    await this.writeManifest(items.filter((item) => !expired.includes(item)))
    return expired.length
  }

  // --- 清单持久化 -------------------------------------------------------

  private async readManifest(): Promise<TrashItem[]> {
    try {
      const parsed: unknown = JSON.parse(await this.storage.readText(TRASH_MANIFEST_PATH))
      return Array.isArray(parsed) ? parsed.filter(isTrashItem) : []
    } catch {
      // 清单缺失或损坏时按空回收站处理：宁可少显示，也不能让整个工作区打不开
      return []
    }
  }

  private async writeManifest(items: TrashItem[]): Promise<void> {
    await this.storage.writeText(TRASH_MANIFEST_PATH, JSON.stringify(items, null, 2))
  }

  /** 回收站内部按扁平结构存放，同名文件靠后缀区分 */
  private async uniqueArchiveName(name: string): Promise<string> {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
    const base = ext ? name.slice(0, -ext.length) : name
    for (let index = 1; index < 10_000; index += 1) {
      const candidate = index === 1 ? name : `${base} (${index})${ext}`
      if (!(await this.storage.exists(joinPath(TRASH_DIR, candidate)))) return candidate
    }
    throw new StorageError('ALREADY_EXISTS', name, '回收站中同名条目过多')
  }

  private async uniqueRestorePath(originalPath: string): Promise<string> {
    if (!(await this.storage.exists(originalPath))) return originalPath

    const dir = dirname(originalPath)
    const name = basename(originalPath)
    const ext = name.slice(stem(name).length)
    for (let index = 2; index < 1000; index += 1) {
      const candidate = joinPath(dir, `${stem(name)} (${index})${ext}`)
      if (!(await this.storage.exists(candidate))) return candidate
    }
    throw new StorageError('ALREADY_EXISTS', originalPath, '同名条目过多，无法还原')
  }
}

function isTrashItem(value: unknown): value is TrashItem {
  const item = value as Partial<TrashItem>
  return typeof item?.archivedPath === 'string' && typeof item.originalPath === 'string'
}

function ignoreMissing(error: unknown): void {
  if (error instanceof StorageError && error.code === 'NOT_FOUND') return
  throw error
}

import { basename, dirname, joinPath, segments } from '../path'
import { StorageError, type DirEntry, type FileStat, type RemoveOptions, type StorageAdapter } from './types'

/**
 * 纯网页模式的存储实现：Origin Private File System。
 *
 * OPFS 提供真正的文件语义（目录树 + 二进制流），且不受 localStorage 容量限制，
 * 因此 Web 模式与桌面模式可以共用同一套「Markdown 文件即真源」的目录结构，
 * 两端数据可直接互导。
 *
 * 已知限制：OPFS 不记录创建时间，`createdAt` 恒为 null；
 * 笔记的创建时间以 frontmatter 中的字段为准，不依赖文件系统元数据。
 */
export class OpfsAdapter implements StorageAdapter {
  readonly kind = 'opfs' as const

  /** 工作区根句柄。Web 模式下每个工作区对应 OPFS 根下的一个目录。 */
  private constructor(private readonly root: FileSystemDirectoryHandle) {}

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
  }

  /**
   * @param workspaceDir OPFS 根下的工作区目录名；留空表示直接使用 OPFS 根
   */
  static async create(workspaceDir?: string): Promise<OpfsAdapter> {
    if (!OpfsAdapter.isSupported()) {
      throw new StorageError('IO', '', '当前浏览器不支持 OPFS，无法在纯网页模式下持久化数据')
    }
    let root = await navigator.storage.getDirectory()
    if (workspaceDir) {
      root = await root.getDirectoryHandle(workspaceDir, { create: true })
    }
    return new OpfsAdapter(root)
  }

  // --- 句柄解析 ---------------------------------------------------------

  private async dirHandle(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let handle = this.root
    for (const segment of segments(path)) {
      try {
        handle = await handle.getDirectoryHandle(segment, { create })
      } catch (cause) {
        throw toStorageError(cause, path)
      }
    }
    return handle
  }

  private async fileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
    const parent = await this.dirHandle(dirname(path), create)
    try {
      return await parent.getFileHandle(basename(path), { create })
    } catch (cause) {
      throw toStorageError(cause, path)
    }
  }

  // --- 查询 -------------------------------------------------------------

  async exists(path: string): Promise<boolean> {
    if (path === '') return true
    try {
      await this.stat(path)
      return true
    } catch (error) {
      if (error instanceof StorageError && error.code === 'NOT_FOUND') return false
      throw error
    }
  }

  async stat(path: string): Promise<FileStat> {
    if (path === '') {
      return { path: '', isDirectory: true, size: 0, modifiedAt: null, createdAt: null }
    }

    // 先按文件试，失败再按目录试：目录数量远少于文件，这样平均少一次 miss
    try {
      const file = await (await this.fileHandle(path)).getFile()
      return {
        path,
        isDirectory: false,
        size: file.size,
        modifiedAt: file.lastModified,
        createdAt: null,
      }
    } catch (error) {
      // 路径不存在会抛 NotFoundError；路径是**目录**时 getFileHandle 抛 TypeMismatchError。
      // 两者都只说明「它不是文件」，必须继续按目录再试一次——
      // 若在此直接抛出，任何针对目录的 stat/exists 都会失败（曾导致文件夹无法删除）。
      const notAFile =
        error instanceof StorageError && (error.code === 'NOT_FOUND' || error.code === 'NOT_A_DIRECTORY')
      if (!notAFile) throw error
    }

    await this.dirHandle(path)
    return { path, isDirectory: true, size: 0, modifiedAt: null, createdAt: null }
  }

  async list(path: string): Promise<DirEntry[]> {
    const dir = await this.dirHandle(path)
    const entries: DirEntry[] = []
    for await (const [name, handle] of dir.entries()) {
      entries.push({
        path: joinPath(path, name),
        name,
        isDirectory: handle.kind === 'directory',
      })
    }
    return entries
  }

  // --- 变更 -------------------------------------------------------------

  async mkdir(path: string): Promise<void> {
    await this.dirHandle(path, true)
  }

  async remove(path: string, options?: RemoveOptions): Promise<void> {
    if (path === '') throw new StorageError('IO', path, '不允许删除工作区根目录')
    const parent = await this.dirHandle(dirname(path))
    try {
      await parent.removeEntry(basename(path), { recursive: options?.recursive ?? false })
    } catch (cause) {
      throw toStorageError(cause, path)
    }
  }

  async move(from: string, to: string): Promise<void> {
    if (await this.exists(to)) {
      throw new StorageError('ALREADY_EXISTS', to)
    }

    const stat = await this.stat(from)
    if (stat.isDirectory) {
      await this.moveDirectory(from, to)
      return
    }

    await this.writeBinary(to, await this.readBinary(from))
    await this.remove(from)
  }

  /** OPFS 无原生递归移动，逐层复制后删除源目录 */
  private async moveDirectory(from: string, to: string): Promise<void> {
    await this.mkdir(to)
    for (const entry of await this.list(from)) {
      const target = joinPath(to, entry.name)
      if (entry.isDirectory) {
        await this.moveDirectory(entry.path, target)
      } else {
        await this.writeBinary(target, await this.readBinary(entry.path))
      }
    }
    await this.remove(from, { recursive: true })
  }

  // --- 读写 -------------------------------------------------------------

  async readText(path: string): Promise<string> {
    return (await (await this.fileHandle(path)).getFile()).text()
  }

  async writeText(path: string, contents: string): Promise<void> {
    await this.write(path, contents)
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const buffer = await (await (await this.fileHandle(path)).getFile()).arrayBuffer()
    return new Uint8Array(buffer)
  }

  async writeBinary(path: string, contents: Uint8Array): Promise<void> {
    await this.write(path, contents)
  }

  async *readChunks(path: string, chunkSize = 8 * 1024 * 1024, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    const file = await (await this.fileHandle(path)).getFile()
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      if (signal?.aborted) throw signal.reason
      yield new Uint8Array(await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer())
    }
  }

  async writeChunks(path: string, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<void> {
    await this.dirHandle(dirname(path), true)
    const handle = await this.fileHandle(path, true)
    const writable = await handle.createWritable()
    try {
      for await (const chunk of chunks) {
        if (signal?.aborted) throw signal.reason
        await writable.write(chunk as FileSystemWriteChunkType)
      }
    } catch (cause) {
      await writable.abort(cause)
      throw cause
    }
    await writable.close()
  }

  private async write(path: string, contents: string | Uint8Array): Promise<void> {
    await this.dirHandle(dirname(path), true) // 自动补齐父目录
    const handle = await this.fileHandle(path, true)
    const writable = await handle.createWritable()
    try {
      await writable.write(contents as FileSystemWriteChunkType)
    } finally {
      await writable.close()
    }
  }
}

function toStorageError(cause: unknown, path: string): StorageError {
  if (cause instanceof StorageError) return cause
  const name = (cause as { name?: string })?.name
  if (name === 'NotFoundError') return new StorageError('NOT_FOUND', path, undefined, { cause })
  if (name === 'TypeMismatchError') return new StorageError('NOT_A_DIRECTORY', path, undefined, { cause })
  if (name === 'InvalidModificationError') return new StorageError('IO', path, '目录非空', { cause })
  return new StorageError('IO', path, (cause as Error)?.message, { cause })
}

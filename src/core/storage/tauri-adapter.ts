import { basename, joinPath, normalizePath } from '../path'
import { StorageError, type DirEntry, type FileStat, type RemoveOptions, type StorageAdapter } from './types'

/** 只取用到的部分，避免把整个插件类型面暴露给领域层 */
type FsModule = typeof import('@tauri-apps/plugin-fs')

/**
 * 桌面客户端模式的存储实现：真实文件系统。
 *
 * 工作区根是用户选定的绝对路径，领域层传入的相对路径在此处拼接为绝对路径。
 * 目录结构与 OPFS 实现完全一致，因此同一个 Vault 可以在网页版与客户端之间直接搬运。
 *
 * 注意：Tauri 2 的 fs 插件有作用域限制，用户通过对话框新选的目录需要由 Rust 侧
 * 调用 `FsExt::allow_directory` 动态放行，否则这里的调用会因权限被拒。
 */
export class TauriFsAdapter implements StorageAdapter {
  readonly kind = 'tauri-fs' as const

  private constructor(
    private readonly fs: FsModule,
    /** 工作区根的绝对路径，已归一化为正斜杠形式 */
    private readonly root: string,
  ) {}

  static isSupported(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  }

  static async create(rootPath: string): Promise<TauriFsAdapter> {
    if (!TauriFsAdapter.isSupported()) {
      throw new StorageError('IO', rootPath, '当前不在 Tauri 客户端环境中')
    }
    const fs = await import('@tauri-apps/plugin-fs')
    return new TauriFsAdapter(fs, rootPath.replace(/\\/g, '/').replace(/\/+$/, ''))
  }

  /** 相对路径 → 绝对路径。空路径即工作区根。 */
  private abs(path: string): string {
    const relative = normalizePath(path)
    return relative === '' ? this.root : `${this.root}/${relative}`
  }

  async exists(path: string): Promise<boolean> {
    try {
      return await this.fs.exists(this.abs(path))
    } catch (cause) {
      throw toStorageError(cause, path)
    }
  }

  async stat(path: string): Promise<FileStat> {
    try {
      const info = await this.fs.stat(this.abs(path))
      return {
        path: normalizePath(path),
        isDirectory: info.isDirectory,
        size: info.size,
        modifiedAt: info.mtime ? info.mtime.getTime() : null,
        createdAt: info.birthtime ? info.birthtime.getTime() : null,
      }
    } catch (cause) {
      throw toStorageError(cause, path)
    }
  }

  async list(path: string): Promise<DirEntry[]> {
    try {
      const entries = await this.fs.readDir(this.abs(path))
      return entries.map((entry) => ({
        path: joinPath(path, entry.name),
        name: entry.name,
        isDirectory: entry.isDirectory,
      }))
    } catch (cause) {
      throw toStorageError(cause, path)
    }
  }

  async mkdir(path: string): Promise<void> {
    try {
      await this.fs.mkdir(this.abs(path), { recursive: true })
    } catch (cause) {
      throw toStorageError(cause, path)
    }
  }

  async remove(path: string, options?: RemoveOptions): Promise<void> {
    if (normalizePath(path) === '') throw new StorageError('IO', path, '不允许删除工作区根目录')
    try {
      await this.fs.remove(this.abs(path), { recursive: options?.recursive ?? false })
    } catch (cause) {
      throw toStorageError(cause, path)
    }
  }

  async move(from: string, to: string): Promise<void> {
    if (await this.exists(to)) throw new StorageError('ALREADY_EXISTS', to)
    try {
      await this.fs.rename(this.abs(from), this.abs(to))
    } catch (cause) {
      throw toStorageError(cause, from)
    }
  }

  async readText(path: string): Promise<string> {
    try {
      return await this.fs.readTextFile(this.abs(path))
    } catch (cause) {
      throw toStorageError(cause, path)
    }
  }

  async writeText(path: string, contents: string): Promise<void> {
    await this.ensureParent(path)
    try {
      await this.fs.writeTextFile(this.abs(path), contents)
    } catch (cause) {
      throw toStorageError(cause, path)
    }
  }

  async readBinary(path: string): Promise<Uint8Array> {
    try {
      return await this.fs.readFile(this.abs(path))
    } catch (cause) {
      throw toStorageError(cause, path)
    }
  }

  async writeBinary(path: string, contents: Uint8Array): Promise<void> {
    await this.ensureParent(path)
    try {
      await this.fs.writeFile(this.abs(path), contents)
    } catch (cause) {
      throw toStorageError(cause, path)
    }
  }

  async *readChunks(path: string, chunkSize = 8 * 1024 * 1024, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    let file: Awaited<ReturnType<FsModule['open']>> | null = null
    try {
      file = await this.fs.open(this.abs(path), { read: true })
      while (true) {
        if (signal?.aborted) throw signal.reason
        const buffer = new Uint8Array(chunkSize)
        const read = await file.read(buffer)
        if (read === null) break
        yield read === buffer.byteLength ? buffer : buffer.slice(0, read)
      }
    } catch (cause) {
      throw toStorageError(cause, path)
    } finally {
      await file?.close()
    }
  }

  async writeChunks(path: string, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<void> {
    await this.ensureParent(path)
    let file: Awaited<ReturnType<FsModule['open']>> | null = null
    try {
      file = await this.fs.open(this.abs(path), { write: true, create: true, truncate: true })
      for await (const chunk of chunks) {
        if (signal?.aborted) throw signal.reason
        await file.write(chunk)
      }
    } catch (cause) {
      throw toStorageError(cause, path)
    } finally {
      await file?.close()
    }
  }

  /** 与 OPFS 实现对齐：写文件时父目录不存在则自动创建 */
  private async ensureParent(path: string): Promise<void> {
    const parent = normalizePath(path).slice(0, -basename(path).length)
    if (parent) await this.mkdir(parent)
  }
}

function toStorageError(cause: unknown, path: string): StorageError {
  if (cause instanceof StorageError) return cause
  const message = String((cause as Error)?.message ?? cause)
  if (/No such file|not found|cannot find/i.test(message)) {
    return new StorageError('NOT_FOUND', path, message, { cause })
  }
  if (/already exists/i.test(message)) {
    return new StorageError('ALREADY_EXISTS', path, message, { cause })
  }
  if (/Not a directory/i.test(message)) {
    return new StorageError('NOT_A_DIRECTORY', path, message, { cause })
  }
  return new StorageError('IO', path, message, { cause })
}

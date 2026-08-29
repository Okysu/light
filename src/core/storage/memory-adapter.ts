import { dirname, isDescendant, joinPath, normalizePath } from '../path'
import { StorageError, type DirEntry, type FileStat, type RemoveOptions, type StorageAdapter } from './types'

interface MemoryFile {
  data: Uint8Array
  modifiedAt: number
  createdAt: number
}

/**
 * 内存实现。用于单元测试与「未选择工作区」时的临时草稿区，
 * 让领域层逻辑无需真实文件系统即可验证（测试不依赖浏览器或客户端环境）。
 *
 * 时间戳由外部注入的时钟提供，测试可传入可控时钟以断言修改时间。
 */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const

  private readonly files = new Map<string, MemoryFile>()
  private readonly dirs = new Set<string>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  async exists(path: string): Promise<boolean> {
    const key = normalizePath(path)
    return key === '' || this.files.has(key) || this.dirs.has(key)
  }

  async stat(path: string): Promise<FileStat> {
    const key = normalizePath(path)
    if (key === '' || this.dirs.has(key)) {
      return { path: key, isDirectory: true, size: 0, modifiedAt: null, createdAt: null }
    }
    const file = this.files.get(key)
    if (!file) throw new StorageError('NOT_FOUND', key)
    return {
      path: key,
      isDirectory: false,
      size: file.data.byteLength,
      modifiedAt: file.modifiedAt,
      createdAt: file.createdAt,
    }
  }

  async list(path: string): Promise<DirEntry[]> {
    const key = normalizePath(path)
    if (key !== '' && !this.dirs.has(key)) throw new StorageError('NOT_FOUND', key)

    const seen = new Map<string, DirEntry>()
    const collect = (candidate: string, isDirectory: boolean) => {
      if (!isDescendant(key, candidate)) return
      const name = candidate.slice(key === '' ? 0 : key.length + 1).split('/')[0]!
      const childPath = joinPath(key, name)
      if (seen.has(childPath)) return
      // 只有恰好是直接子项时才沿用其类型，否则是中间目录
      seen.set(childPath, { path: childPath, name, isDirectory: childPath === candidate ? isDirectory : true })
    }

    for (const dir of this.dirs) collect(dir, true)
    for (const file of this.files.keys()) collect(file, false)
    return [...seen.values()]
  }

  async mkdir(path: string): Promise<void> {
    const key = normalizePath(path)
    if (key === '') return
    for (let current = key; current !== ''; current = dirname(current)) {
      this.dirs.add(current)
    }
  }

  async remove(path: string, options?: RemoveOptions): Promise<void> {
    const key = normalizePath(path)
    if (key === '') throw new StorageError('IO', key, '不允许删除工作区根目录')

    if (this.files.delete(key)) return
    if (!this.dirs.has(key)) throw new StorageError('NOT_FOUND', key)

    const children = await this.list(key)
    if (children.length > 0 && !options?.recursive) {
      throw new StorageError('IO', key, '目录非空')
    }
    for (const file of [...this.files.keys()]) {
      if (isDescendant(key, file)) this.files.delete(file)
    }
    for (const dir of [...this.dirs]) {
      if (dir === key || isDescendant(key, dir)) this.dirs.delete(dir)
    }
  }

  async move(from: string, to: string): Promise<void> {
    const source = normalizePath(from)
    const target = normalizePath(to)
    if (await this.exists(target)) throw new StorageError('ALREADY_EXISTS', target)

    const file = this.files.get(source)
    if (file) {
      this.files.delete(source)
      await this.mkdir(dirname(target))
      this.files.set(target, { ...file, modifiedAt: this.now() })
      return
    }
    if (!this.dirs.has(source)) throw new StorageError('NOT_FOUND', source)

    const rebase = (path: string) => joinPath(target, path.slice(source.length + 1))
    for (const [path, value] of [...this.files]) {
      if (!isDescendant(source, path)) continue
      this.files.delete(path)
      this.files.set(rebase(path), value)
    }
    for (const dir of [...this.dirs]) {
      if (dir !== source && !isDescendant(source, dir)) continue
      this.dirs.delete(dir)
      this.dirs.add(dir === source ? target : rebase(dir))
    }
    await this.mkdir(target)
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path))
  }

  async writeText(path: string, contents: string): Promise<void> {
    await this.writeBinary(path, new TextEncoder().encode(contents))
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const file = this.files.get(normalizePath(path))
    if (!file) throw new StorageError('NOT_FOUND', normalizePath(path))
    return file.data
  }

  async writeBinary(path: string, contents: Uint8Array): Promise<void> {
    const key = normalizePath(path)
    if (key === '' || this.dirs.has(key)) throw new StorageError('IO', key, '目标是目录')
    await this.mkdir(dirname(key))
    const timestamp = this.now()
    const existing = this.files.get(key)
    this.files.set(key, {
      data: contents,
      modifiedAt: timestamp,
      createdAt: existing?.createdAt ?? timestamp,
    })
  }

  async *readChunks(path: string, chunkSize = 8 * 1024 * 1024, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    const contents = await this.readBinary(path)
    for (let offset = 0; offset < contents.byteLength; offset += chunkSize) {
      if (signal?.aborted) throw signal.reason
      yield contents.slice(offset, Math.min(offset + chunkSize, contents.byteLength))
    }
  }

  async writeChunks(path: string, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<void> {
    const parts: Uint8Array[] = []
    let size = 0
    for await (const chunk of chunks) {
      if (signal?.aborted) throw signal.reason
      parts.push(chunk.slice())
      size += chunk.byteLength
    }
    const contents = new Uint8Array(size)
    let offset = 0
    for (const part of parts) {
      contents.set(part, offset)
      offset += part.byteLength
    }
    await this.writeBinary(path, contents)
  }
}

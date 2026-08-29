/**
 * 存储适配层契约。
 *
 * 依赖倒置：领域层（工作区、笔记、附件、同步）只依赖此处的抽象，
 * 不感知运行在浏览器（OPFS）还是桌面客户端（Tauri 文件系统）。
 * 新增运行环境 = 新增一个实现，上层零改动（开闭原则）。
 */

export type StorageKind = 'opfs' | 'tauri-fs' | 'memory'

export interface DirEntry {
  /** 相对工作区根的 POSIX 路径 */
  path: string
  name: string
  isDirectory: boolean
}

export interface FileStat {
  path: string
  isDirectory: boolean
  /** 字节数；目录为 0 */
  size: number
  /** 最后修改时间（毫秒时间戳）；OPFS 目录无此信息时为 null */
  modifiedAt: number | null
  createdAt: number | null
}

export interface RemoveOptions {
  /** 目录非空时是否递归删除 */
  recursive?: boolean
}

/**
 * 文件系统抽象。所有 path 均为相对工作区根的 POSIX 相对路径。
 * 实现须保证：写入文件时自动创建缺失的父目录。
 */
export interface StorageAdapter {
  readonly kind: StorageKind

  exists(path: string): Promise<boolean>
  stat(path: string): Promise<FileStat>

  /** 仅列出直接子项，不递归 */
  list(path: string): Promise<DirEntry[]>
  mkdir(path: string): Promise<void>
  remove(path: string, options?: RemoveOptions): Promise<void>
  /** 移动或重命名；目标已存在时抛错，由上层决定是否先改名避让 */
  move(from: string, to: string): Promise<void>

  readText(path: string): Promise<string>
  writeText(path: string, contents: string): Promise<void>
  readBinary(path: string): Promise<Uint8Array>
  writeBinary(path: string, contents: Uint8Array): Promise<void>
  /** 大文件同步使用的分块 I/O；实现不得把完整文件一次性装入内存。 */
  readChunks(path: string, chunkSize?: number, signal?: AbortSignal): AsyncIterable<Uint8Array>
  writeChunks(path: string, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<void>
}

/** 存储层统一错误，便于上层按 code 分支处理而非匹配错误文案 */
export type StorageErrorCode = 'NOT_FOUND' | 'ALREADY_EXISTS' | 'NOT_A_DIRECTORY' | 'IO'

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    readonly path: string,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? `${code}: ${path}`, options)
    this.name = 'StorageError'
  }
}

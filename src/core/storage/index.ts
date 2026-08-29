import { MemoryAdapter } from './memory-adapter'
import { OpfsAdapter } from './opfs-adapter'
import { TauriFsAdapter } from './tauri-adapter'
import type { StorageAdapter } from './types'

export * from './types'
export * from './desktop'
export * from './default-location'
export { MemoryAdapter, OpfsAdapter, TauriFsAdapter }

export type RuntimeEnv = 'desktop' | 'web'

/**
 * 工作区的物理落点。持久化在应用设置里，启动时据此重建 StorageAdapter。
 * 用可辨识联合而非「路径 + 布尔标记」，避免出现 web 模式却带绝对路径的非法组合。
 */
export type WorkspaceLocation =
  | { kind: 'opfs'; /** OPFS 根下的目录名 */ dir: string }
  | { kind: 'tauri-fs'; /** 用户选定的绝对路径 */ path: string }
  | { kind: 'memory' }

export function detectRuntime(): RuntimeEnv {
  return TauriFsAdapter.isSupported() ? 'desktop' : 'web'
}

/** 工厂：按落点类型装配实现，调用方只拿到 StorageAdapter 抽象 */
export async function createStorage(location: WorkspaceLocation): Promise<StorageAdapter> {
  switch (location.kind) {
    case 'tauri-fs':
      return TauriFsAdapter.create(location.path)
    case 'opfs':
      return OpfsAdapter.create(location.dir)
    case 'memory':
      return new MemoryAdapter()
  }
}

import { StorageError } from './types'

/**
 * 桌面端专有能力：选择工作区目录，并把它加入文件系统作用域。
 *
 * Tauri 2 的 fs 插件默认只允许 capabilities 中预先声明的路径。工作区由用户在运行时
 * 选定，编译期无从声明，因此选完必须调用 Rust 侧的 `allow_workspace` 动态放行——
 * 少了这一步，`TauriFsAdapter` 的每次读写都会被作用域拒绝，且错误信息只说「forbidden path」，
 * 极难联想到是授权问题。
 *
 * 放在 core 而非组件里：它是「打开工作区」这条领域流程的一环，
 * 与 UI 无关，桌面端的入口按钮只是触发者。
 */

/** 只在 Tauri 客户端里可用 */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * 弹出系统目录选择框。
 * @returns 用户选定的绝对路径；取消选择时为 null
 */
export async function pickWorkspaceDirectory(): Promise<string | null> {
  if (!isDesktop()) throw new StorageError('IO', '', '仅桌面客户端支持选择本地目录')

  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ directory: true, multiple: false, title: '选择工作区目录' })

  return typeof selected === 'string' ? selected : null
}

/** 把目录加入 fs 作用域；必须在任何读写之前调用 */
export async function authorizeDirectory(path: string): Promise<void> {
  if (!isDesktop()) return

  const { invoke } = await import('@tauri-apps/api/core')
  try {
    await invoke('allow_workspace', { path })
  } catch (cause) {
    throw new StorageError('IO', path, `无法获得目录访问权限：${String(cause)}`, { cause })
  }
}

/** 选择目录并完成授权，返回可直接用于打开工作区的路径 */
export async function chooseWorkspace(): Promise<string | null> {
  const path = await pickWorkspaceDirectory()
  if (!path) return null

  await authorizeDirectory(path)
  return path
}

import { isDesktop } from './desktop'
import type { WorkspaceLocation } from './index'

/**
 * 数据存放位置。
 *
 * **不让用户「选择工作区」**：那是把实现细节当成了功能。用户想的是
 * 「我的笔记存在哪」，不是「我要挂载哪个 Vault」。因此客户端首次启动
 * 直接在文档目录下建一个 `Light` 文件夹开始用，想换位置的去设置里改。
 *
 * 网页端没有可选路径——数据在浏览器的私有存储里，位置由浏览器决定。
 */

/** 记住用户改过的路径；没改过就用默认 */
const CUSTOM_PATH_KEY = 'light:data-path'

/** 客户端默认目录名，建在系统的「文档」下 */
const DEFAULT_FOLDER = 'Light'

/**
 * 客户端的默认数据目录。
 *
 * 选文档目录而不是应用数据目录（AppData / Library）：笔记是**用户的**文件，
 * 应该待在用户找得到、能备份、能同步的地方。藏进 AppData 等于变相锁定——
 * 用户想拿走数据得先知道那个路径存在。
 */
export async function defaultDataPath(): Promise<string> {
  const { documentDir, join } = await import('@tauri-apps/api/path')
  return join(await documentDir(), DEFAULT_FOLDER)
}

/** 当前生效的数据目录；用户改过就用改过的 */
export async function currentDataPath(): Promise<string> {
  return localStorage.getItem(CUSTOM_PATH_KEY) || (await defaultDataPath())
}

export function rememberDataPath(path: string): void {
  localStorage.setItem(CUSTOM_PATH_KEY, path)
}

export function forgetDataPath(): void {
  localStorage.removeItem(CUSTOM_PATH_KEY)
}

/** 用户是否改过默认位置——设置页据此显示「恢复默认」 */
export function hasCustomDataPath(): boolean {
  return localStorage.getItem(CUSTOM_PATH_KEY) !== null
}

/**
 * 应用启动时该打开哪里。
 *
 * 客户端：默认目录（不存在就建）。网页端：浏览器私有存储。
 * 两端都不需要用户做任何选择就能开始写第一个字。
 */
export async function startupLocation(): Promise<WorkspaceLocation> {
  if (!isDesktop()) return { kind: 'opfs', dir: 'default' }

  const path = await currentDataPath()
  await ensureDirectory(path)
  return { kind: 'tauri-fs', path }
}

/**
 * 确保目录存在并已获得访问授权。
 *
 * 顺序不能反：`mkdir` 本身也受 fs 作用域约束，先放行父目录才建得出来。
 */
export async function ensureDirectory(path: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('prepare_data_dir', { path })
}

import { isDesktop } from '@/core/storage/desktop'

/**
 * 主进程与前端之间的事件约定。
 *
 * 客户端有两个 webview（主窗口、速记窗口）与一个 Rust 主进程，三方都需要在
 * 「数据变了」「该落盘了」这两件事上对齐。用事件而不是轮询：速记写完一篇笔记后
 * 主窗口要立刻看到，而定时扫描磁盘既慢又浪费。
 */
export const DESKTOP_EVENT = {
  /** 主进程要求前端立即落盘（窗口隐藏、应用退出前） */
  flush: 'light://flush',
  /** 速记窗口写入了新笔记，主窗口据此刷新文件树 */
  noteCreated: 'light://note-created',
} as const

/** 空的取消订阅函数，用于非桌面端，让调用方无需分支处理 */
const noop = (): void => {}

/**
 * 监听主进程 / 其他窗口发来的事件。
 * 网页端没有这套机制，返回空操作而不是抛错——调用方本就该两端共用一份代码。
 */
export async function onDesktopEvent(name: string, handler: () => void): Promise<() => void> {
  if (!isDesktop()) return noop

  const { listen } = await import('@tauri-apps/api/event')
  return await listen(name, () => handler())
}

/** 向其他窗口广播事件；网页端为空操作 */
export async function emitDesktopEvent(name: string): Promise<void> {
  if (!isDesktop()) return

  const { emit } = await import('@tauri-apps/api/event')
  await emit(name)
}

/** 隐藏当前窗口（速记写完 / 按 Esc）。速记窗口只隐藏不销毁，下次唤起才是即时的。 */
export async function hideCurrentWindow(): Promise<void> {
  if (!isDesktop()) return

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().hide()
}

/** 当前窗口是否是速记胶囊。Rust 侧建窗时写入这个 query 参数。 */
export function isCaptureWindow(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('window') === 'capture'
}

import { ref } from 'vue'

export interface ConfirmRequest {
  title: string
  description?: string
  confirmLabel: string
  cancelLabel: string
  /** 破坏性操作用醒目的样式，让人在点下去之前多看一眼 */
  danger: boolean
}

/**
 * 全局单例的确认对话框。
 *
 * 与 `use-prompt` 同一套路数：不用 `window.confirm`——Tauri 的 WebView 中原生
 * 对话框被禁用，样式也无法随主题变化。
 *
 * 只给**不易撤销或影响面大**的操作用。回收站里的删除、清空、批量改写属于此类；
 * 而「移入回收站」本身可以还原，之所以也确认，是因为它常常是误触右键菜单的结果，
 * 而误删一篇正在写的笔记，即使能还原也已经打断了思路。
 */
const request = ref<ConfirmRequest | null>(null)
let resolver: ((result: boolean) => void) | null = null

export function useConfirm() {
  function confirm(options: {
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
  }): Promise<boolean> {
    // 前一个对话框未关闭时先兑现为取消，避免 Promise 永久挂起
    resolver?.(false)

    request.value = {
      title: options.title,
      description: options.description ?? '',
      confirmLabel: options.confirmLabel ?? '确定',
      cancelLabel: options.cancelLabel ?? '取消',
      danger: options.danger ?? false,
    }

    return new Promise((resolve) => {
      resolver = resolve
    })
  }

  function settle(result: boolean): void {
    request.value = null
    resolver?.(result)
    resolver = null
  }

  return {
    request,
    confirm,
    accept: () => settle(true),
    cancel: () => settle(false),
  }
}

import { ref } from 'vue'

interface PromptRequest {
  title: string
  description?: string
  defaultValue: string
  confirmLabel: string
  placeholder: string
  multiline: boolean
}

/**
 * 全局单例的输入对话框。
 *
 * 不用 window.prompt：Tauri 的 WebView 中原生对话框被禁用，且样式无法随主题变化。
 * 模块级状态 + App 中的单个 <PromptDialog> 即可，无需在每个调用点各挂一个对话框。
 */
const request = ref<PromptRequest | null>(null)
const value = ref('')
let resolver: ((result: string | null) => void) | null = null

export function usePrompt() {
  function prompt(options: {
    title: string
    description?: string
    defaultValue?: string
    confirmLabel?: string
    placeholder?: string
    multiline?: boolean
  }): Promise<string | null> {
    // 前一个对话框未关闭时先兑现为取消，避免 Promise 永久挂起
    resolver?.(null)

    request.value = {
      title: options.title,
      description: options.description ?? '',
      defaultValue: options.defaultValue ?? '',
      confirmLabel: options.confirmLabel ?? '确定',
      placeholder: options.placeholder ?? '',
      multiline: options.multiline ?? false,
    }
    value.value = options.defaultValue ?? ''

    return new Promise((resolve) => {
      resolver = resolve
    })
  }

  function confirm(): void {
    const trimmed = value.value.trim()
    if (!trimmed) return
    settle(trimmed)
  }

  function cancel(): void {
    settle(null)
  }

  function settle(result: string | null): void {
    request.value = null
    resolver?.(result)
    resolver = null
  }

  return { request, value, prompt, confirm, cancel }
}

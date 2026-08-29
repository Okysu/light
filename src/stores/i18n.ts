import { defineStore } from 'pinia'
import { ref, watchEffect } from 'vue'
import { messages, type Locale, type MessageKey } from '@/core/i18n/messages'
import { syncTrayLocale } from '@/core/desktop/events'

const STORAGE_KEY = 'light:locale'

export const useI18nStore = defineStore('i18n', () => {
  const saved = localStorage.getItem(STORAGE_KEY)
  const locale = ref<Locale>(saved === 'en-US' ? 'en-US' : 'zh-CN')

  function t(key: MessageKey, params: Record<string, string | number> = {}): string {
    let value: string = messages[locale.value][key] ?? messages['zh-CN'][key]
    for (const [name, replacement] of Object.entries(params)) value = value.replaceAll(`{${name}}`, String(replacement))
    return value
  }

  watchEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale.value)
    document.documentElement.lang = locale.value
    // 原生托盘不属于当前 webview，需要单独通知 Rust 主进程。
    void syncTrayLocale(locale.value).catch(() => {
      // 托盘同步失败不能阻断界面语言切换；桌面构建与 Rust 测试会校验命令存在。
    })
  })

  return { locale, t }
})

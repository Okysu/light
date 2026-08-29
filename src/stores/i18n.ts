import { defineStore } from 'pinia'
import { ref, watchEffect } from 'vue'
import { messages, type Locale, type MessageKey } from '@/core/i18n/messages'

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
  })

  return { locale, t }
})

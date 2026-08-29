import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastKind = 'error' | 'success' | 'info'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

export const useToastStore = defineStore('toast', () => {
  const items = ref<ToastItem[]>([])
  let nextId = 1
  const recent = new Map<string, number>()

  function remove(id: number): void {
    items.value = items.value.filter((item) => item.id !== id)
  }

  function show(message: string, kind: ToastKind = 'info', duration = 4200): number {
    const normalized = message.trim()
    if (!normalized) return 0

    const now = Date.now()
    const duplicateAt = recent.get(`${kind}:${normalized}`)
    if (duplicateAt && now - duplicateAt < 1200) return 0
    recent.set(`${kind}:${normalized}`, now)

    const id = nextId++
    items.value = [...items.value.slice(-3), { id, message: normalized, kind }]
    window.setTimeout(() => remove(id), duration)
    return id
  }

  return {
    items,
    remove,
    show,
    error: (message: string) => show(message, 'error', 6000),
    success: (message: string) => show(message, 'success'),
    info: (message: string) => show(message, 'info'),
  }
})

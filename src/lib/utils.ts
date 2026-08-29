import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn-vue 约定的类名合并：后来的工具类覆盖先前的同类工具类 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 字节数转人类可读大小，用于属性面板与附件列表 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

/** 相对时间，供「最近编辑」列表使用 */
export function formatRelativeTime(timestamp: number, locale = 'zh-CN', now = Date.now()): string {
  const diff = now - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (diff < minute) return relative.format(0, 'second')
  if (diff < hour) return relative.format(-Math.floor(diff / minute), 'minute')
  if (diff < day) return relative.format(-Math.floor(diff / hour), 'hour')
  if (diff < 7 * day) return relative.format(-Math.floor(diff / day), 'day')
  return new Date(timestamp).toLocaleDateString(locale)
}

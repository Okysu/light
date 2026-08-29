/**
 * 快捷键的解析、匹配与显示。
 *
 * 单独成一层，是为了让快捷键有**唯一数据源**：处理逻辑与设置页展示读同一份定义。
 * 各写一份的话，两边迟早对不上——用户在设置里看到的和实际按出来的不是一回事，
 * 是最难被发现的那类 bug（没人会想到去怀疑说明文字）。
 *
 * 这也是 13.1「快捷键可自定义映射」的前置条件：届时只要让定义可写即可。
 */

import type { MessageKey } from '@/core/i18n/messages'

/** `Mod` 在 macOS 上是 ⌘，其余平台是 Ctrl——这样一份定义就能跨平台 */
export type ShortcutKeys = string

export interface ShortcutBinding {
  id: string
  keys: ShortcutKeys
  /** 文案只保存 i18n key，避免快捷键设置页成为最后一块硬编码界面。 */
  labelKey: MessageKey
  /** 提示这个快捷键在哪里生效，帮助用户理解为何某处按了没反应 */
  scopeKey: MessageKey
}

/**
 * 按键事件里我们真正需要的部分。
 *
 * 不直接写 `KeyboardEvent`：那是 DOM 类型，会把 core 层绑到浏览器环境上，
 * 单测就得为此拉起 jsdom。真实的 `KeyboardEvent` 结构上兼容这个接口，
 * 调用方无需做任何转换。
 */
export interface KeyPress {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** 只保存被用户改过的条目；没有覆盖项时自然回退到内置值。 */
export type ShortcutOverrides = Record<string, ShortcutKeys>

interface ParsedShortcut {
  mod: boolean
  shift: boolean
  alt: boolean
  /** 统一小写；单字符键与具名键（Escape、Enter 等）都走这里 */
  key: string
}

/** `event.key` 里不便直接书写的键，在定义中用名字表示 */
const KEY_ALIASES: Record<string, string> = {
  space: ' ',
  plus: '+',
}

const SERIALIZED_KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  '+': 'Plus',
  escape: 'Escape',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
}

const MODIFIER_KEYS = new Set(['control', 'meta', 'shift', 'alt', 'altgraph'])

export function parseShortcut(keys: ShortcutKeys): ParsedShortcut {
  const parts = keys.split('+').map((part) => part.trim())
  const last = (parts.at(-1) ?? '').toLowerCase()

  return {
    mod: parts.some((part) => part.toLowerCase() === 'mod'),
    shift: parts.some((part) => part.toLowerCase() === 'shift'),
    alt: parts.some((part) => part.toLowerCase() === 'alt'),
    key: KEY_ALIASES[last] ?? last,
  }
}

/**
 * 事件是否匹配某个快捷键。
 *
 * 修饰键做的是**精确匹配**而不是「包含即可」：`Mod+K` 不应该被 `Mod+Shift+K`
 * 触发，否则两个快捷键会同时响应一次按键。
 */
export function matchesShortcut(event: KeyPress, keys: ShortcutKeys): boolean {
  const wanted = parseShortcut(keys)
  const mod = event.ctrlKey || event.metaKey

  if (mod !== wanted.mod) return false
  if (event.shiftKey !== wanted.shift) return false
  if (event.altKey !== wanted.alt) return false

  return event.key.toLowerCase() === wanted.key
}

/**
 * 把一次真实按键录成跨平台定义。返回 null 表示只有修饰键，或组合会干扰普通输入。
 *
 * 单字母、数字和符号必须带 Mod / Alt；否则把 `A` 设成全局快捷键后，编辑器连字都打不了。
 * Escape 和 F1–F24 可以单独使用，和现有的「退出专注模式」保持一致。
 */
export function shortcutFromKeyPress(event: KeyPress): ShortcutKeys | null {
  const rawKey = event.key.toLowerCase()
  if (!rawKey || MODIFIER_KEYS.has(rawKey)) return null

  const hasMod = event.ctrlKey || event.metaKey
  const isFunctionKey = /^f(?:[1-9]|1\d|2[0-4])$/.test(rawKey)
  if (!hasMod && !event.altKey && rawKey !== 'escape' && !isFunctionKey) return null

  const segments: string[] = []
  if (hasMod) segments.push('Mod')
  if (event.shiftKey) segments.push('Shift')
  if (event.altKey) segments.push('Alt')

  const serialized = SERIALIZED_KEY_NAMES[rawKey]
    ?? (rawKey.length === 1 ? rawKey.toUpperCase() : event.key)
  segments.push(serialized)
  return segments.join('+')
}

/** 比较用的稳定形式：修饰键顺序、大小写和别名不同也视为同一个组合。 */
export function shortcutIdentity(keys: ShortcutKeys): string {
  const parsed = parseShortcut(keys)
  return `${parsed.mod ? 'm' : '-'}${parsed.shift ? 's' : '-'}${parsed.alt ? 'a' : '-'}:${parsed.key}`
}

export function resolveShortcut(binding: ShortcutBinding, overrides: ShortcutOverrides): ShortcutKeys {
  return overrides[binding.id] || binding.keys
}

/** 找到占用同一组合的另一条应用内快捷键。 */
export function findShortcutConflict(
  bindingId: string,
  keys: ShortcutKeys,
  bindings: ShortcutBinding[],
  overrides: ShortcutOverrides,
): ShortcutBinding | undefined {
  const wanted = shortcutIdentity(keys)
  return bindings.find(
    (binding) => binding.id !== bindingId && shortcutIdentity(resolveShortcut(binding, overrides)) === wanted,
  )
}

const DISPLAY_NAMES: Record<string, string> = {
  escape: 'Esc',
  enter: 'Enter',
  ' ': 'Space',
  '+': '+',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
}

/**
 * 转成可读形式，例如 `Mod+Shift+K` → Windows 上 `Ctrl + Shift + K`、macOS 上 `⌘ + Shift + K`。
 * @param isMac 显式传入而不是在这里探测平台，纯函数才好测
 */
export function formatShortcut(keys: ShortcutKeys, isMac: boolean): string {
  const parsed = parseShortcut(keys)
  const segments: string[] = []

  if (parsed.mod) segments.push(isMac ? '⌘' : 'Ctrl')
  if (parsed.shift) segments.push('Shift')
  if (parsed.alt) segments.push(isMac ? '⌥' : 'Alt')

  const name = DISPLAY_NAMES[parsed.key] ?? parsed.key.toUpperCase()
  segments.push(name)

  return segments.join(' + ')
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac/i.test(navigator.platform || navigator.userAgent)
}

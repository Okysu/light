import type { ShortcutBinding } from './shortcut'

/**
 * 全部内置快捷键的唯一清单。
 *
 * 只放「是什么」，不放「做什么」——动作是 UI 层的事（见 App.vue 的 id → handler 映射）。
 * 这样 core 层不需要知道有命令面板、有专注模式，设置页也能在不 import 任何组件的
 * 前提下把它们列出来。
 *
 * `Mod` 在 macOS 上是 ⌘，其余平台是 Ctrl。
 */
export const SHORTCUT_BINDINGS: ShortcutBinding[] = [
  { id: 'command-palette', keys: 'Mod+K', labelKey: 'shortcut.commandPalette', scopeKey: 'shortcut.scope.global' },
  { id: 'toggle-sidebar', keys: 'Mod+\\', labelKey: 'shortcut.toggleSidebar', scopeKey: 'shortcut.scope.global' },
  { id: 'toggle-zen', keys: 'Mod+J', labelKey: 'shortcut.toggleZen', scopeKey: 'shortcut.scope.global' },
  { id: 'daily-note', keys: 'Mod+Shift+D', labelKey: 'shortcut.dailyNote', scopeKey: 'shortcut.scope.global' },
  { id: 'ai-assistant', keys: 'Mod+Shift+A', labelKey: 'shortcut.ai', scopeKey: 'shortcut.scope.global' },
  { id: 'exit-zen', keys: 'Escape', labelKey: 'shortcut.exitZen', scopeKey: 'shortcut.scope.zen' },
]

/**
 * 客户端独有、由操作系统注册的快捷键。
 *
 * 与上面分开列：它们在应用没有焦点时也生效，注册在 Rust 侧（src-tauri/src/lib.rs），
 * 前端既拦不到也改不了。混在一起会让用户以为网页版也有。
 */
export const DESKTOP_SHORTCUT_BINDINGS: ShortcutBinding[] = [
  { id: 'quick-capture', keys: 'Mod+Shift+Space', labelKey: 'shortcut.quickCapture', scopeKey: 'shortcut.scope.system' },
]

import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import type { ShortcutKeys, ShortcutOverrides } from '@/core/keyboard/shortcut'

/**
 * 应用级偏好：只影响**这台设备**，因此存 localStorage 而不是工作区。
 *
 * 这条线不能混——把它们写进 Vault，两台设备就会互相覆盖对方的偏好；
 * 反过来，工作区级的设置（回收站保留期、属性定义）不会写进 localStorage，
 * 换台设备就得重配一遍。设置面板的左侧分组正是按这个归属划分的。
 *
 * 与 `ui` store 的分工：那边是会话性的面板开关，这边是跨会话的用户选择。
 */
export const usePreferencesStore = defineStore('preferences', () => {
  /**
   * 停止输入后多久落盘（毫秒）。
   * Milkdown 的 listener 已内置 200ms 防抖，这里是第二层，两层叠加才是实际延迟。
   */
  const autosaveDelay = useLocalStorage('light:autosave-delay', 400)

  /** 编辑器拼写检查（13.2）。中文写作时红波浪线是干扰，因此可关。 */
  const spellcheck = useLocalStorage('light:spellcheck', true)

  /** 应用内快捷键覆盖项；跟随设备，不写入 Vault，也不参与 S3 同步。 */
  const shortcutOverrides = useLocalStorage<ShortcutOverrides>('light:shortcut-overrides', {})

  function setShortcut(bindingId: string, keys: ShortcutKeys): void {
    shortcutOverrides.value = { ...shortcutOverrides.value, [bindingId]: keys }
  }

  function resetShortcut(bindingId: string): void {
    const next = { ...shortcutOverrides.value }
    delete next[bindingId]
    shortcutOverrides.value = next
  }

  function resetShortcuts(): void {
    shortcutOverrides.value = {}
  }

  return {
    autosaveDelay,
    spellcheck,
    shortcutOverrides,
    setShortcut,
    resetShortcut,
    resetShortcuts,
  }
})

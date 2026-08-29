import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 纯界面状态：面板开关、专注模式等。
 *
 * 单独成 store 是为了让触发方与被触发方解耦——命令面板要能打开回收站，
 * 但它不该 import 回收站组件，否则两者就绑死了。
 * 会话性状态用 ref，跨会话偏好用 useLocalStorage 持久化。
 */
export const useUiStore = defineStore('ui', () => {
  const commandPaletteOpen = ref(false)
  const trashOpen = ref(false)
  const graphOpen = ref(false)
  const historyOpen = ref(false)
  const attachmentsOpen = ref(false)
  const settingsOpen = ref(false)
  /** 设置页录入快捷键时暂停全局动作派发，避免录入本身触发命令。 */
  const shortcutCaptureActive = ref(false)
  /** AI 助手面板（模块 6） */
  const aiOpen = ref(false)
  const propertiesPath = ref<string | null>(null)

  /** 专注写作：隐藏两侧面板 */
  const zenMode = ref(false)

  // 侧栏显隐属于用户偏好，重开应用应当保持
  const sidebarVisible = useLocalStorage('light:sidebar-visible', true)
  const outlineVisible = useLocalStorage('light:outline-visible', true)

  function toggleCommandPalette(): void {
    commandPaletteOpen.value = !commandPaletteOpen.value
  }

  function openProperties(path: string): void {
    propertiesPath.value = path
  }

  function toggleZen(): void {
    zenMode.value = !zenMode.value
  }

  return {
    commandPaletteOpen,
    trashOpen,
    graphOpen,
    historyOpen,
    attachmentsOpen,
    settingsOpen,
    shortcutCaptureActive,
    aiOpen,
    propertiesPath,
    zenMode,
    sidebarVisible,
    outlineVisible,
    toggleCommandPalette,
    openProperties,
    toggleZen,
  }
})

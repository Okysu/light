<script setup lang="ts">
import { computed } from 'vue'
import { Minus, Square, X } from 'lucide-vue-next'
import { isDesktop } from '@/core/storage/desktop'
import { useI18nStore } from '@/stores/i18n'

const i18n = useI18nStore()
const visible = isDesktop()
const platform = computed<'macos' | 'windows' | 'linux'>(() => {
  const value = `${navigator.platform} ${navigator.userAgent}`.toLowerCase()
  if (value.includes('mac')) return 'macos'
  if (value.includes('win')) return 'windows'
  return 'linux'
})

async function windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const current = getCurrentWindow()
  if (action === 'minimize') await current.minimize()
  else if (action === 'maximize') await current.toggleMaximize()
  else await current.close()
}
</script>

<template>
  <div
    v-if="visible"
    data-tauri-drag-region
    class="light-desktop-titlebar relative flex h-8 shrink-0 select-none items-center border-b border-border bg-background"
    :data-platform="platform"
  >
    <div v-if="platform === 'macos'" class="relative z-10 flex h-full items-center gap-2 px-3">
      <button class="light-mac-control bg-[#ff5f57]" :aria-label="i18n.t('window.close')" @click="windowAction('close')" />
      <button class="light-mac-control bg-[#febc2e]" :aria-label="i18n.t('window.minimize')" @click="windowAction('minimize')" />
      <button class="light-mac-control bg-[#28c840]" :aria-label="i18n.t('window.maximize')" @click="windowAction('maximize')" />
    </div>
    <span data-tauri-drag-region class="pointer-events-none absolute inset-0 grid place-items-center text-[11px] font-medium text-muted-foreground">Light</span>
    <div v-if="platform !== 'macos'" class="relative z-10 ml-auto flex h-full">
      <button class="light-window-control" :aria-label="i18n.t('window.minimize')" @click="windowAction('minimize')"><Minus /></button>
      <button class="light-window-control" :aria-label="i18n.t('window.maximize')" @click="windowAction('maximize')"><Square /></button>
      <button class="light-window-control hover:!bg-destructive hover:!text-destructive-foreground" :aria-label="i18n.t('window.close')" @click="windowAction('close')"><X /></button>
    </div>
  </div>
</template>

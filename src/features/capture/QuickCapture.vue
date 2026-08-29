<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { DESKTOP_EVENT, emitDesktopEvent, hideCurrentWindow } from '@/core/desktop/events'
import { useWorkspaceStore } from '@/stores/workspace'
import { formatShortcut, isMacPlatform } from '@/core/keyboard/shortcut'
import { useI18nStore } from '@/stores/i18n'
import { useToastStore } from '@/stores/toast'
import ToastHost from '@/components/ui/toast/ToastHost.vue'

/**
 * 速记胶囊：全局快捷键唤起的独立小窗，只做一件事——把脑子里的东西落到磁盘。
 *
 * 它与主窗口是两个 webview，不共享内存状态，因此自己打开一次数据目录。
 * 位置由 `startupLocation()` 决定（localStorage 同源共享，两个窗口看到的一样），
 * 所以哪怕主窗口从没开过，按下快捷键也能立刻写。
 */

const workspace = useWorkspaceStore()
const i18n = useI18nStore()
const toast = useToastStore()
const saveShortcut = formatShortcut('Mod+Enter', isMacPlatform())

const text = ref('')
const saving = ref(false)
const message = ref('')
const input = ref<HTMLTextAreaElement | null>(null)

onMounted(async () => {
  await workspace.restoreLast()
  input.value?.focus()
})

/** 首行当标题，其余当正文——最贴近「随手记一句」的输入习惯 */
function splitInput(raw: string): { title: string; body: string } {
  const lines = raw.split('\n')
  const first = (lines[0] ?? '').replace(/^#+\s*/, '').trim()
  const rest = lines.slice(1).join('\n').trim()

  // 首行太长就不适合当文件名，退回时间戳标题，整段内容都进正文
  if (!first || first.length > 40) return { title: '', body: raw.trim() }
  return { title: first, body: rest }
}

async function save(): Promise<void> {
  const raw = text.value.trim()
  if (!raw || saving.value) return

  if (!workspace.isOpen) {
    message.value = i18n.t('capture.notReady')
    toast.error(message.value)
    return
  }

  saving.value = true
  message.value = ''
  try {
    const { title, body } = splitInput(raw)
    await workspace.createNote('', title, 'note', body)

    // 主窗口的文件树是内存快照，不广播它就看不到这篇新笔记
    await emitDesktopEvent(DESKTOP_EVENT.noteCreated)

    text.value = ''
    await hideCurrentWindow()
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : String(cause)
    toast.error(message.value)
  } finally {
    saving.value = false
    // 窗口只是隐藏没有销毁，下次唤起时焦点得重新给到输入框
    await nextTick()
    input.value?.focus()
  }
}

async function dismiss(): Promise<void> {
  await hideCurrentWindow()
}

function onKeydown(event: KeyboardEvent): void {
  // 单独的 Enter 留给换行：速记也常常是好几句话
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    void save()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    void dismiss()
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl">
    <!-- 无边框窗口没有系统标题栏，这一条就是它的拖动把手 -->
    <div
      data-tauri-drag-region
      class="flex h-8 shrink-0 cursor-default items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground"
    >
      <span data-tauri-drag-region class="font-medium text-foreground">{{ i18n.t('capture.title') }}</span>
      <button class="ml-auto rounded px-1.5 py-0.5 hover:bg-accent" :title="i18n.t('capture.close')" @click="dismiss">✕</button>
    </div>

    <!-- 裸 textarea：它就是这个窗口的主体，四周已有窗口边框，
         再套一层带边框的 Textarea 会出现框中框 -->
    <textarea
      ref="input"
      v-model="text"
      class="light-capture-input m-1 min-h-0 flex-1 resize-none rounded-md bg-transparent px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground"
      :placeholder="i18n.t('capture.placeholder')"
      @keydown="onKeydown"
    />

    <div class="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-xs text-muted-foreground">
      <span v-if="message" class="truncate text-destructive">{{ message }}</span>
      <span v-else class="truncate">{{ i18n.t('capture.hint', { shortcut: saveShortcut }) }}</span>
      <Button class="ml-auto" size="sm" :disabled="!text.trim() || saving" @click="save">
        {{ saving ? i18n.t('capture.saving') : i18n.t('capture.save') }}
      </Button>
    </div>
    <ToastHost />
  </div>
</template>

<style scoped>
/* 全局键盘焦点框使用外描边；速记输入框贴近小窗边缘，外描边会被窗口裁切。
   这里改为等价的内描边，既保留键盘可见焦点，也不会被左右边界吃掉。 */
.light-capture-input:focus,
.light-capture-input:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--ring);
}
</style>

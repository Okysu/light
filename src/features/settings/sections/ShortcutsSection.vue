<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, onBeforeUnmount, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { DESKTOP_SHORTCUT_BINDINGS, SHORTCUT_BINDINGS } from '@/core/keyboard/bindings'
import {
  findShortcutConflict,
  formatShortcut,
  isMacPlatform,
  resolveShortcut,
  shortcutFromKeyPress,
} from '@/core/keyboard/shortcut'
import { usePreferencesStore } from '@/stores/preferences'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18nStore } from '@/stores/i18n'
import SettingRow from '../SettingRow.vue'

const workspace = useWorkspaceStore()
const preferences = usePreferencesStore()
const ui = useUiStore()
const i18n = useI18nStore()
const isMac = isMacPlatform()

const recordingId = ref<string | null>(null)
const feedback = ref('')
const feedbackIsError = ref(false)

const applicationBindings = computed(() =>
  SHORTCUT_BINDINGS.map((binding) => ({
    ...binding,
    keys: resolveShortcut(binding, preferences.shortcutOverrides),
  })),
)

/** 桌面端才注册系统级快捷键；它由 Rust 注册，当前只读。 */
const groups = computed(() => [
  { title: i18n.t('shortcut.group.app'), bindings: applicationBindings.value, editable: true },
  ...(workspace.runtime === 'desktop'
    ? [{ title: i18n.t('shortcut.group.system'), bindings: DESKTOP_SHORTCUT_BINDINGS, editable: false }]
    : []),
])

const customizedCount = computed(() => Object.keys(preferences.shortcutOverrides).length)

function startCapture(bindingId: string): void {
  recordingId.value = bindingId
  ui.shortcutCaptureActive = true
  feedback.value = i18n.t('shortcut.pressNew')
  feedbackIsError.value = false
}

function stopCapture(): void {
  recordingId.value = null
  ui.shortcutCaptureActive = false
  feedback.value = ''
  feedbackIsError.value = false
}

function reset(bindingId: string): void {
  preferences.resetShortcut(bindingId)
  const binding = SHORTCUT_BINDINGS.find((candidate) => candidate.id === bindingId)
  feedback.value = binding
    ? i18n.t('shortcut.restored', { name: i18n.t(binding.labelKey) })
    : i18n.t('shortcut.restoredFallback')
  feedbackIsError.value = false
}

function resetAll(): void {
  preferences.resetShortcuts()
  stopCapture()
  feedback.value = i18n.t('shortcut.restoredAll')
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!recordingId.value) return

  event.preventDefault()
  event.stopImmediatePropagation()

  const keys = shortcutFromKeyPress(event)
  if (!keys) {
    feedback.value = i18n.t('shortcut.invalid')
    feedbackIsError.value = true
    return
  }

  const binding = SHORTCUT_BINDINGS.find((candidate) => candidate.id === recordingId.value)
  if (!binding) return

  const conflict = findShortcutConflict(
    binding.id,
    keys,
    SHORTCUT_BINDINGS,
    preferences.shortcutOverrides,
  )
  if (conflict) {
    feedback.value = i18n.t('shortcut.conflict', {
      keys: formatShortcut(keys, isMac),
      name: i18n.t(conflict.labelKey),
    })
    feedbackIsError.value = true
    return
  }

  preferences.setShortcut(binding.id, keys)
  recordingId.value = null
  ui.shortcutCaptureActive = false
  feedback.value = i18n.t('shortcut.changed', {
    name: i18n.t(binding.labelKey),
    keys: formatShortcut(keys, isMac),
  })
  feedbackIsError.value = false
})

onBeforeUnmount(() => {
  ui.shortcutCaptureActive = false
})
</script>

<template>
  <div class="space-y-6">
    <SettingRow
      v-for="group in groups"
      :key="group.title"
      :label="group.title"
      :description="
        group.editable
          ? i18n.t('shortcut.editableHint')
          : i18n.t('shortcut.systemHint')
      "
    >
      <ul class="divide-y divide-border rounded-md border border-border">
        <li
          v-for="binding in group.bindings"
          :key="binding.id"
          class="flex min-h-11 items-center gap-2 px-3 py-2 text-sm"
        >
          <span class="min-w-0 flex-1 truncate">{{ i18n.t(binding.labelKey) }}</span>
          <span class="hidden shrink-0 text-xs text-muted-foreground sm:inline">{{ i18n.t(binding.scopeKey) }}</span>
          <kbd
            class="shrink-0 rounded border px-1.5 py-0.5 font-mono text-xs"
            :class="
              recordingId === binding.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-muted'
            "
          >
            {{ recordingId === binding.id ? i18n.t('shortcut.waiting') : formatShortcut(binding.keys, isMac) }}
          </kbd>

          <template v-if="group.editable">
            <Button
              v-if="recordingId !== binding.id"
              variant="ghost"
              size="sm"
              :aria-label="i18n.t('shortcut.recordAria', { name: i18n.t(binding.labelKey) })"
              @click="startCapture(binding.id)"
            >
              {{ i18n.t('shortcut.capture') }}
            </Button>
            <Button v-else variant="outline" size="sm" @click="stopCapture">{{ i18n.t('shortcut.cancel') }}</Button>
            <Button
              v-if="preferences.shortcutOverrides[binding.id]"
              variant="ghost"
              size="sm"
              :aria-label="i18n.t('shortcut.resetAria', { name: i18n.t(binding.labelKey) })"
              @click="reset(binding.id)"
            >
              {{ i18n.t('shortcut.reset') }}
            </Button>
          </template>
        </li>
      </ul>
    </SettingRow>

    <div class="flex items-start justify-between gap-3">
      <p
        class="min-h-5 text-xs leading-relaxed"
        :class="feedbackIsError ? 'text-destructive' : 'text-muted-foreground'"
        role="status"
        aria-live="polite"
      >
        {{ feedback || i18n.t('shortcut.defaultHint') }}
      </p>
      <Button v-if="customizedCount" variant="outline" size="sm" @click="resetAll">
        {{ i18n.t('shortcut.resetAll', { count: customizedCount }) }}
      </Button>
    </div>
  </div>
</template>

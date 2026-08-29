<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEditorStore } from '@/stores/editor'
import { useSecurityStore } from '@/stores/security'
import { useI18nStore } from '@/stores/i18n'
import { useToastStore } from '@/stores/toast'
import SettingRow from '../SettingRow.vue'

const security = useSecurityStore()
const editor = useEditorStore()
const i18n = useI18nStore()
const toast = useToastStore()
const password = ref('')
const confirmPassword = ref('')
const currentPassword = ref('')
const sensitive = ref(false)
const message = ref('')

const currentIsNote = computed(() => editor.activeKind === 'note' && !!editor.activePath)
watch(() => editor.activePath, async (path) => { sensitive.value = await security.isSensitive(path) }, { immediate: true })

async function enable(): Promise<void> {
  message.value = ''
  if (password.value !== confirmPassword.value) { message.value = i18n.t('security.mismatch'); toast.error(message.value); return }
  try {
    await security.setup(password.value)
    password.value = ''
    confirmPassword.value = ''
    message.value = i18n.t('security.enabled')
    toast.success(message.value)
  } catch (cause) { message.value = cause instanceof Error ? cause.message : String(cause); toast.error(message.value) }
}

async function toggleSensitive(): Promise<void> {
  if (!editor.activePath) return
  await editor.flush()
  await security.setSensitive(editor.activePath, !sensitive.value)
  sensitive.value = !sensitive.value
  await editor.openNote(editor.activePath)
}

async function disable(): Promise<void> {
  if (await security.disable(currentPassword.value)) {
    currentPassword.value = ''
    sensitive.value = false
    message.value = i18n.t('security.disabled')
    toast.success(message.value)
  } else { message.value = security.error; toast.error(message.value) }
}
</script>

<template>
  <div class="space-y-6">
    <SettingRow v-if="!security.configured" :label="i18n.t('security.enable')" :description="i18n.t('security.enableHint')">
      <div class="w-full space-y-2">
        <Input v-model="password" type="password" autocomplete="new-password" :placeholder="i18n.t('security.passwordMin')" />
        <Input v-model="confirmPassword" type="password" autocomplete="new-password" :placeholder="i18n.t('security.passwordAgain')" />
        <Button :disabled="password.length < 8 || !confirmPassword || security.busy" @click="enable">{{ i18n.t('security.enableButton') }}</Button>
      </div>
    </SettingRow>

    <template v-else>
      <SettingRow :label="i18n.t('security.lockNow')" :description="i18n.t('security.lockNowHint')">
        <Button @click="security.lock()">{{ i18n.t('security.lockApp') }}</Button>
      </SettingRow>
      <SettingRow :label="i18n.t('security.autoLock')" :description="i18n.t('security.autoLockHint')">
        <Input class="w-28" type="number" min="0" max="1440" :model-value="security.config?.autoLockMinutes" @change="security.setAutoLockMinutes(Number(($event.target as HTMLInputElement).value))" />
      </SettingRow>
      <SettingRow :label="i18n.t('security.currentNote')" :description="i18n.t('security.currentNoteHint')">
        <Button :disabled="!currentIsNote || security.locked" @click="toggleSensitive">{{ sensitive ? i18n.t('security.unmarkSensitive') : i18n.t('security.markSensitive') }}</Button>
      </SettingRow>
      <SettingRow :label="i18n.t('security.disable')" :description="i18n.t('security.disableHint')">
        <div class="flex gap-2"><Input v-model="currentPassword" type="password" autocomplete="current-password" :placeholder="i18n.t('security.currentPassword')" /><Button variant="destructive" :disabled="!currentPassword" @click="disable">{{ i18n.t('security.close') }}</Button></div>
      </SettingRow>
    </template>
    <p v-if="message" role="status" class="text-sm text-muted-foreground">{{ message }}</p>
  </div>
</template>

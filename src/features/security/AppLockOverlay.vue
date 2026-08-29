<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEditorStore } from '@/stores/editor'
import { useSecurityStore } from '@/stores/security'
import { useI18nStore } from '@/stores/i18n'

const security = useSecurityStore()
const editor = useEditorStore()
const i18n = useI18nStore()
const password = ref('')

async function unlock(): Promise<void> {
  if (await security.unlock(password.value)) {
    password.value = ''
    await editor.reconcileTabs()
  }
}
</script>

<template>
  <div v-if="security.locked" class="fixed inset-0 z-[100] grid place-items-center bg-background" role="dialog" aria-modal="true" aria-labelledby="app-lock-title">
    <form class="w-[min(22rem,90vw)] space-y-4 rounded-xl border border-border bg-card p-6 shadow-xl" @submit.prevent="unlock">
      <div>
        <h1 id="app-lock-title" class="text-lg font-semibold">{{ i18n.t('lock.title') }}</h1>
        <p class="mt-1 text-sm text-muted-foreground">{{ i18n.t('lock.description') }}</p>
      </div>
      <Input v-model="password" type="password" autocomplete="current-password" autofocus :aria-label="i18n.t('lock.password')" />
      <p v-if="security.error" role="alert" class="text-sm text-destructive">{{ security.error }}</p>
      <Button class="w-full" type="submit" :disabled="!password || security.busy">{{ i18n.t(security.busy ? 'lock.verifying' : 'lock.unlock') }}</Button>
    </form>
  </div>
</template>

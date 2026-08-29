<script setup lang="ts">
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-vue-next'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
const icons = { error: AlertCircle, success: CheckCircle2, info: Info }
</script>

<template>
  <div class="pointer-events-none fixed right-3 top-3 z-[200] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2" role="region" aria-live="polite" aria-label="Notifications">
    <TransitionGroup name="light-toast">
      <div
        v-for="item in toast.items"
        :key="item.id"
        class="pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-popover px-3 py-2.5 text-sm text-popover-foreground shadow-lg"
        :class="item.kind === 'error' ? 'border-destructive/40' : item.kind === 'success' ? 'border-emerald-500/35' : 'border-border'"
        :role="item.kind === 'error' ? 'alert' : 'status'"
      >
        <component
          :is="icons[item.kind]"
          class="mt-0.5 size-4 shrink-0"
          :class="item.kind === 'error' ? 'text-destructive' : item.kind === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-primary'"
        />
        <p class="min-w-0 flex-1 whitespace-pre-wrap break-words leading-relaxed">{{ item.message }}</p>
        <button type="button" class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close notification" @click="toast.remove(item.id)">
          <X class="size-3.5" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.light-toast-enter-active,
.light-toast-leave-active { transition: opacity 160ms ease, transform 160ms ease; }
.light-toast-enter-from,
.light-toast-leave-to { opacity: 0; transform: translateY(-8px) scale(.98); }
</style>

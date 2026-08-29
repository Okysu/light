<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { usePrompt } from '@/composables/use-prompt'
import { useI18nStore } from '@/stores/i18n'

const { request, value, confirm, cancel } = usePrompt()
const i18n = useI18nStore()
/**
 * shadcn 的 Input 是组件，ref 拿到的是实例而不是 DOM；
 * 它的根元素就是 `<input>`，因此取 $el 才能聚焦与全选。
 */
const input = ref<{ $el: HTMLInputElement } | null>(null)

// 打开后自动聚焦并全选，重命名时可直接覆盖输入
watch(request, async (current) => {
  if (!current) return
  await nextTick()
  input.value?.$el.focus()
  input.value?.$el.select()
})

function onOpenChange(open: boolean): void {
  if (!open) cancel()
}
</script>

<template>
  <Dialog
    layer="top"
    :open="request !== null"
    :title="request?.title ?? ''"
    :description="request?.description"
    class="w-[min(26rem,calc(100vw-2rem))]"
    @update:open="onOpenChange"
  >
    <div class="px-5 pb-5 pt-3">
      <Input ref="input" v-model="value" @keydown.enter.prevent="confirm" />

      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="cancel">{{ i18n.t('common.cancel') }}</Button>
        <Button size="sm" :disabled="!value.trim()" @click="confirm">
          {{ request?.confirmLabel }}
        </Button>
      </div>
    </div>
  </Dialog>
</template>

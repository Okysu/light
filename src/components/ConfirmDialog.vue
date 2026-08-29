<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useConfirm } from '@/composables/use-confirm'

const { request, accept, cancel } = useConfirm()

function onOpenChange(open: boolean): void {
  // 点遮罩或按 Esc 关闭，一律当作取消——确认必须是主动的
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
    <div class="flex justify-end gap-2 px-5 pb-5 pt-3">
      <Button variant="ghost" size="sm" @click="cancel">{{ request?.cancelLabel }}</Button>
      <Button :variant="request?.danger ? 'destructive' : 'default'" size="sm" @click="accept">
        {{ request?.confirmLabel }}
      </Button>
    </div>
  </Dialog>
</template>

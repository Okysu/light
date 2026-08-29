<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { cn } from '@/lib/utils'
import { useI18nStore } from '@/stores/i18n'

/**
 * 应用内统一的模态框外壳。
 * 命令面板、回收站、设置、属性等都复用它，避免每处重写一遍遮罩与定位。
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    /** 隐藏标题栏（命令面板这类自带输入框的场景），但仍保留无障碍标签 */
    hideHeader?: boolean
    /**
     * 叠在另一个对话框之上。
     *
     * 确认框常常由某个对话框里的按钮触发（比如卡片详情里的「删除卡片」）。
     * 同为 z-50 时，后挂载的不一定在上面——DOM 顺序说了算，而 Portal 的
     * 挂载顺序取决于组件树，不取决于谁后打开。结果就是确认框被它的
     * 触发者盖住，用户只能看到一层变暗的遮罩，点哪儿都没反应。
     */
    layer?: 'base' | 'top'
    class?: string
  }>(),
  { hideHeader: false, layer: 'base' },
)

const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const i18n = useI18nStore()
</script>

<template>
  <DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay
        :class="
          cn(
            'fixed inset-0 bg-black/40 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in-0',
            props.layer === 'top' ? 'z-[60]' : 'z-50',
          )
        "
      />
      <DialogContent
        :class="
          cn(
            'fixed left-1/2 top-1/2 flex max-h-[85vh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg',
            props.layer === 'top' ? 'z-[60]' : 'z-50',
            props.class,
          )
        "
      >
        <div :class="cn('px-5 pt-5', props.hideHeader && 'sr-only')">
          <DialogTitle class="text-base font-semibold">{{ props.title }}</DialogTitle>
          <DialogDescription
            :class="props.description ? 'mt-1 text-sm text-muted-foreground' : 'sr-only'"
          >
      {{ props.description || i18n.t('dialog.description', { title: props.title }) }}
          </DialogDescription>
        </div>

        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { ScrollAreaScrollbar, ScrollAreaThumb, type ScrollAreaScrollbarProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<ScrollAreaScrollbarProps & { class?: string }>(), {
  orientation: 'vertical',
})
</script>

<template>
  <ScrollAreaScrollbar
    :orientation="props.orientation"
    :force-mount="props.forceMount"
    :class="
      cn(
        'flex touch-none select-none transition-colors duration-150',
        // 边框常态即占位、仅颜色透明：滑块出现时不会挤动内容（见 S2 规范）
        props.orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-[2px]',
        props.orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-[2px]',
        props.class,
      )
    "
  >
    <ScrollAreaThumb
      class="relative flex-1 rounded-full bg-border transition-colors hover:bg-muted-foreground/50"
    />
  </ScrollAreaScrollbar>
</template>

<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

/**
 * 侧边栏的可折叠分区（笔记 / 标签 / 最近）。
 *
 * 折叠状态按分区 id 单独持久化——它是用户对「我常用哪几块」的表达，
 * 每次重开都要重新收起会很烦。
 */
const props = defineProps<{
  id: string
  title: string
  /** 折叠时在标题右侧显示的计数 */
  count?: number
  defaultOpen?: boolean
}>()

const open = useLocalStorage(`light:section-${props.id}`, props.defaultOpen ?? true)
const showCount = computed(() => !open.value && props.count !== undefined && props.count > 0)
</script>

<template>
  <section class="flex min-h-0 flex-col">
    <div class="flex items-center gap-1 px-2 py-1.5">
      <button
        type="button"
        :aria-expanded="open"
        :aria-controls="`sidebar-section-${id}`"
        class="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-transparent px-1 py-0.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
        @click="open = !open"
      >
        <ChevronRight class="size-3 shrink-0 transition-transform" :class="open && 'rotate-90'" />
        <span class="truncate">{{ title }}</span>
        <span v-if="showCount" class="ml-1 shrink-0 normal-case">{{ count }}</span>
      </button>

      <!-- 分区右侧的操作按钮由使用方提供 -->
      <slot name="actions" />
    </div>

    <div v-if="open" :id="`sidebar-section-${id}`" class="min-h-0">
      <slot />
    </div>
  </section>
</template>

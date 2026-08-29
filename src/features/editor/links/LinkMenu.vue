<script setup lang="ts">
import { FileText } from 'lucide-vue-next'
import { watch } from 'vue'
import { cn } from '@/lib/utils'
import type { LinkAutocompleteController } from './link-autocomplete'
import { useI18nStore } from '@/stores/i18n'

const props = defineProps<{ controller: LinkAutocompleteController }>()
const i18n = useI18nStore()

// 键盘移动后把选中项滚进视野
watch(
  () => props.controller.activeIndex.value,
  (index) => {
    requestAnimationFrame(() => {
      props.controller.contentEl
        .querySelector(`[data-link-index="${index}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  },
)

/** 路径里的目录部分，用来区分同名笔记 */
function directoryOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}
</script>

<template>
  <div
    v-show="controller.visible.value"
    class="z-50 max-h-72 w-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
    role="listbox"
    :aria-label="i18n.t('editor.linkNote')"
  >
    <!-- 没有匹配不等于走投无路：直接把 `]]` 打完就是一条指向待建笔记的链接 -->
    <p v-if="controller.items.value.length === 0" class="px-2 py-3 text-center text-xs text-muted-foreground">
      {{ i18n.t('editor.linkMissingBefore') }} <span class="font-mono">]]</span>{{ i18n.t('editor.linkMissingAfter') }}
    </p>

    <button
      v-for="(item, index) in controller.items.value"
      :key="item.path"
      type="button"
      role="option"
      :data-link-index="index"
      :aria-selected="index === controller.activeIndex.value"
      :class="
        cn(
          'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
          index === controller.activeIndex.value && 'bg-accent text-accent-foreground',
        )
      "
      @mouseenter="controller.activeIndex.value = index"
      @mousedown.prevent="controller.runItem(item)"
    >
      <FileText class="size-4 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
      <span v-if="directoryOf(item.path)" class="shrink-0 truncate text-xs text-muted-foreground">
        {{ directoryOf(item.path) }}
      </span>
    </button>
  </div>
</template>

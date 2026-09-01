<script setup lang="ts">
import { computed } from 'vue'
import { parseOutline } from '@/core/markdown/outline'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useEditorStore } from '@/stores/editor'
import { useI18nStore } from '@/stores/i18n'

const store = useEditorStore()
const i18n = useI18nStore()

// 用合并后的完整文档：标题在界面上被拆了出去，但它仍是大纲的第一层
const headings = computed(() => parseOutline(store.fullContent))

/**
 * 按序号定位到渲染出的标题元素。
 *
 * 用「第 n 个标题」而不是给标题注入 id：正文是用户的 Markdown 文件，
 * 我们不该为了导航往里塞锚点属性。解析顺序与渲染顺序天然一致，
 * 序号足以对应，也不会污染文件内容。
 */
function scrollTo(index: number): void {
  const nodes = document.querySelectorAll<HTMLElement>('.light-prose h1, .light-prose h2, .light-prose h3, .light-prose h4, .light-prose h5, .light-prose h6')
  nodes[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <p class="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ i18n.t('app.outline') }}</p>

    <ScrollArea class="min-h-0 flex-1" viewport-class="px-1 pb-2">
      <p v-if="headings.length === 0" class="px-3 py-6 text-center text-xs text-muted-foreground">
        {{ i18n.t('outline.empty') }}<br />
        {{ i18n.t('outline.hint') }}
      </p>

      <button
        v-for="heading in headings"
        :key="heading.index"
        type="button"
        :class="
          cn(
            'block min-w-0 w-full whitespace-normal break-words rounded-md px-2 py-1 text-left text-sm leading-5 text-muted-foreground',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            heading.level === 1 && 'font-medium text-foreground',
          )
        "
        :style="{ paddingLeft: `${(heading.level - 1) * 0.7 + 0.5}rem` }"
        :title="heading.text"
        @click="scrollTo(heading.index)"
      >
        {{ heading.text }}
      </button>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { cn } from '@/lib/utils'
import type { SlashController } from './controller'
import type { SlashItem } from './items'
import { useI18nStore } from '@/stores/i18n'
import type { MessageKey } from '@/core/i18n/messages'

const props = defineProps<{ controller: SlashController }>()
const i18n = useI18nStore()
const ITEM_KEYS: Record<string, MessageKey> = {
  text: 'slash.text', h1: 'slash.h1', h2: 'slash.h2', h3: 'slash.h3', 'bullet-list': 'slash.bullet',
  'ordered-list': 'slash.ordered', 'task-list': 'slash.task', blockquote: 'slash.quote', 'code-block': 'slash.code',
  table: 'slash.table', hr: 'slash.hr', math: 'slash.math', mermaid: 'slash.mermaid', image: 'slash.image', audio: 'slash.audio',
  video: 'slash.video', 'embed-board': 'slash.board', 'embed-canvas': 'slash.canvas', 'ai-write': 'slash.aiWrite',
}
const GROUP_KEYS: Record<string, MessageKey> = { 基础: 'slash.basic', 列表: 'slash.list', 块: 'slash.block', 媒体: 'slash.media', 嵌入: 'slash.embed' }

/** 按 group 分节，同时保留全局索引以便高亮与键盘导航对齐 */
const sections = computed(() => {
  const groups = new Map<string, Array<{ item: SlashItem; index: number }>>()
  props.controller.items.value.forEach((item, index) => {
    const list = groups.get(item.group) ?? []
    list.push({ item, index })
    groups.set(item.group, list)
  })
  return [...groups.entries()].map(([name, entries]) => ({ name, entries }))
})

// 键盘移动后把选中项滚进视野
watch(
  () => props.controller.activeIndex.value,
  (index) => {
    requestAnimationFrame(() => {
      props.controller.contentEl
        .querySelector(`[data-slash-index="${index}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  },
)
</script>

<template>
  <div
    v-show="controller.visible.value"
    class="z-50 max-h-72 w-60 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
    role="listbox"
    :aria-label="i18n.t('editor.insert')"
  >
    <p v-if="controller.items.value.length === 0" class="px-2 py-3 text-center text-xs text-muted-foreground">
      {{ i18n.t('slash.none') }}
    </p>

    <template v-for="section in sections" :key="section.name">
      <p class="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {{ GROUP_KEYS[section.name] ? i18n.t(GROUP_KEYS[section.name]!) : section.name }}
      </p>
      <button
        v-for="{ item, index } in section.entries"
        :key="item.id"
        type="button"
        role="option"
        :data-slash-index="index"
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
        <component :is="item.icon" class="size-4 shrink-0 text-muted-foreground" />
        {{ ITEM_KEYS[item.id] ? i18n.t(ITEM_KEYS[item.id]!) : item.label }}
      </button>
    </template>
  </div>
</template>

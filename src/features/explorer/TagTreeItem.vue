<script setup lang="ts">
import { ChevronRight, Tags } from 'lucide-vue-next'
import { ref } from 'vue'
import type { TagTreeNode } from '@/core/tags/hierarchy'
import { cn } from '@/lib/utils'
import { useI18nStore } from '@/stores/i18n'

defineOptions({ name: 'TagTreeItem' })

defineProps<{
  node: TagTreeNode
  activeTag: string | null
  depth?: number
}>()

const emit = defineEmits<{ select: [tag: string] }>()
const i18n = useI18nStore()
const expanded = ref(true)
</script>

<template>
  <div>
    <div
      :class="
        cn(
          'group flex items-center rounded-md border border-transparent text-sm',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          activeTag === node.tag &&
            'border-border bg-sidebar-accent font-medium text-sidebar-accent-foreground',
        )
      "
      :style="{ paddingLeft: `${(depth ?? 0) * 0.85 + 0.25}rem` }"
    >
      <button
        v-if="node.children.length > 0"
        type="button"
        class="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
        :title="expanded ? i18n.t('tree.collapseTag', { name: node.label }) : i18n.t('tree.expandTag', { name: node.label })"
        @click.stop="expanded = !expanded"
      >
        <ChevronRight class="size-3.5 transition-transform" :class="expanded && 'rotate-90'" />
      </button>
      <span v-else class="block w-6 shrink-0" />

      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-left"
        :title="node.tag"
        @click="emit('select', node.tag)"
      >
        <Tags class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="truncate">{{ node.label }}</span>
        <span class="ml-auto shrink-0 text-xs text-muted-foreground">{{ node.paths.length }}</span>
      </button>
    </div>

    <div v-if="expanded && node.children.length > 0">
      <TagTreeItem
        v-for="child in node.children"
        :key="child.tag"
        :node="child"
        :active-tag="activeTag"
        :depth="(depth ?? 0) + 1"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>

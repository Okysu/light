<script setup lang="ts">
import { ChevronRight, Link2, Link2Off } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { stem } from '@/core/path'
import { useEditorStore } from '@/stores/editor'
import { useLinksStore } from '@/stores/links'
import { useI18nStore } from '@/stores/i18n'

/**
 * 反向链接：谁提到了当前这篇笔记（需求 2.3，并为 11.2 图谱铺路）。
 *
 * 放在正文下方而不是侧栏：它是「读完这篇之后」才关心的信息，
 * 常驻侧栏会一直占着宽度，而多数时候用户并不看它。
 */

const editor = useEditorStore()
const links = useLinksStore()
const i18n = useI18nStore()

const expanded = ref(true)

// 图是懒建的；打开笔记时才需要知道谁引用了它
watch(
  () => editor.activePath,
  async (path) => {
    if (path) await links.ensureGraph()
  },
  { immediate: true },
)

interface BacklinkGroup {
  path: string
  title: string
  /** 引用处的显示文本，同一篇里多处引用就有多条 */
  mentions: string[]
  /** 本篇引用了自己。标出来，否则列表里会出现一条看着像重复的条目 */
  self: boolean
}

const groups = computed<BacklinkGroup[]>(() => {
  const path = editor.activePath
  if (!path) return []

  return links.backlinks(path).map((from) => ({
    path: from,
    title: stem(from),
    mentions: links.edges(from, path).map((edge) => edge.ref.label),
    self: from === path,
  }))
})

const total = computed(() => groups.value.length)
</script>

<template>
  <section v-if="editor.activePath" class="light-print-hide mt-10 border-t border-border pt-4">
    <button
      class="flex w-full items-center gap-1.5 rounded-md border border-transparent px-1 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
      @click="expanded = !expanded"
    >
      <ChevronRight class="size-3.5 shrink-0 transition-transform" :class="expanded && 'rotate-90'" />
      <Link2 class="size-3.5 shrink-0" />
      <span>{{ i18n.t('backlinks.title') }}</span>
      <span class="rounded bg-muted px-1.5 text-xs">{{ total }}</span>
    </button>

    <div v-if="expanded" class="mt-2 space-y-1">
      <!-- 没有反向链接是常态，不是缺陷，所以说明写得平淡些 -->
      <p v-if="total === 0" class="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 py-2 text-xs leading-relaxed text-muted-foreground">
        <Link2Off class="size-3.5 shrink-0" />
        <span>{{ i18n.t('backlinks.emptyBefore') }}</span>
        <span class="max-w-full break-all rounded bg-muted px-1 font-mono">[[{{ links.targetFor(editor.activePath) }}]]</span>
        <span>{{ i18n.t('backlinks.emptyAfter') }}</span>
      </p>

      <button
        v-for="group in groups"
        :key="group.path"
        class="flex w-full flex-col gap-0.5 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-accent"
        @click="editor.openNote(group.path)"
      >
        <span class="flex items-center gap-1.5 truncate text-sm">
          {{ group.title }}
          <span v-if="group.self" class="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
            {{ i18n.t('backlinks.self') }}
          </span>
        </span>
        <span class="truncate text-xs text-muted-foreground">
          <template v-for="(mention, index) in group.mentions" :key="index">
            <span v-if="index > 0"> · </span>{{ mention }}
          </template>
        </span>
      </button>
    </div>
  </section>
</template>

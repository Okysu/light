<script setup lang="ts">
import { Maximize2 } from 'lucide-vue-next'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { buildGraphView, isMissingNode } from '@/core/links/graph-view'
import { useEditorStore } from '@/stores/editor'
import { useLinksStore } from '@/stores/links'
import { useUiStore } from '@/stores/ui'
import { useI18nStore } from '@/stores/i18n'

/**
 * 知识图谱面板（需求 11.2）。
 *
 * 渲染层按需加载：cytoscape 有几百 KB，而多数会话根本不会打开图谱。
 * 这与编辑器的处理是同一条原则——首屏只装必需品。
 */
const GraphView = defineAsyncComponent(() => import('./GraphView.vue'))

const ui = useUiStore()
const links = useLinksStore()
const editor = useEditorStore()
const i18n = useI18nStore()

const includeOrphans = ref(true)
const includeMissing = ref(false)
const scope = ref<'global' | 'local'>('global')
const depth = ref<1 | 2 | 3>(1)
const canvas = ref<{ fit: () => void } | null>(null)

const currentNote = computed(() =>
  editor.activeKind === 'note' ? editor.activePath : null,
)

// 图谱是懒建的入口之一：打开面板时才需要全库链接图
watch(
  () => ui.graphOpen,
  async (open) => {
    if (!open) return
    if (scope.value === 'local' && !currentNote.value) scope.value = 'global'
    await links.ensureGraph()
  },
)

const view = computed(() =>
  buildGraphView(links.graph, {
    paths: links.notePaths,
    // 局部模式必须保留中心笔记，即使它暂时没有任何关系。
    includeOrphans: scope.value === 'local' ? true : includeOrphans.value,
    includeMissing: includeMissing.value,
    center: scope.value === 'local' ? (currentNote.value ?? undefined) : undefined,
    depth: depth.value,
  }),
)

const summary = computed(() => {
  const { nodes, edges, selfLinks } = view.value
  const prefix = scope.value === 'local' ? i18n.t('graph.localSummary', { count: depth.value }) : ''
  const base = `${prefix}${i18n.t('graph.summary', { nodes: nodes.length, edges: edges.length })}`

  // 只有自引用时会得到「N 篇 · 0 条链接」，不解释一句用户会以为图谱坏了
  return selfLinks > 0 ? i18n.t('graph.selfLinks', { base, count: selfLinks }) : base
})

function onSelect(id: string): void {
  // 未创建的笔记没有文件可打开，点它只是看看
  if (isMissingNode(id)) return

  ui.graphOpen = false
  void editor.openNote(id)
}
</script>

<template>
  <Dialog v-model:open="ui.graphOpen" :title="i18n.t('graph.title')" :description="i18n.t('graph.description')"
    class="h-[85vh] w-[64rem] max-w-[96vw]">
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-y border-border px-5 py-2">
        <span class="text-xs text-muted-foreground">{{ summary }}</span>

        <div class="flex items-center rounded-md border border-border p-0.5" :aria-label="i18n.t('graph.scope')">
          <Button class="h-6 px-2 text-xs" size="sm" :variant="scope === 'global' ? 'secondary' : 'ghost'"
            @click="scope = 'global'">
            {{ i18n.t('graph.global') }}
          </Button>
          <Button class="h-6 px-2 text-xs" size="sm" :variant="scope === 'local' ? 'secondary' : 'ghost'"
            :disabled="!currentNote" :title="currentNote ? i18n.t('graph.localTitle') : i18n.t('graph.openFirst')"
            @click="scope = 'local'">
            {{ i18n.t('graph.local') }}
          </Button>
        </div>

        <div v-if="scope === 'local'" class="flex items-center gap-0.5" :aria-label="i18n.t('graph.depth')">
          <span class="mr-1 text-xs text-muted-foreground">{{ i18n.t('graph.range') }}</span>
          <Button v-for="item in ([1, 2, 3] as const)" :key="item" class="h-7 px-2 text-xs" size="sm"
            :variant="depth === item ? 'secondary' : 'ghost'" @click="depth = item">
            {{ i18n.t('graph.hops', { count: item }) }}
          </Button>
        </div>

        <Label v-if="scope === 'global'" class="flex cursor-pointer items-center gap-1.5 text-xs font-normal">
          <Checkbox v-model="includeOrphans" />
          {{ i18n.t('graph.orphans') }}
        </Label>
        <Label class="flex cursor-pointer items-center gap-1.5 text-xs font-normal">
          <Checkbox v-model="includeMissing" />
          {{ i18n.t('graph.missing') }}
        </Label>
        <Button class="ml-auto" size="sm" variant="ghost" :title="i18n.t('graph.fit')" @click="canvas?.fit()">
          <Maximize2 />
        </Button>
      </div>

      <div class="min-h-0 flex-1">
        <p v-if="links.building" class="flex h-full items-center justify-center text-sm text-muted-foreground">
          {{ i18n.t('graph.scanning') }}
        </p>
        <p v-else-if="view.nodes.length === 0"
          class="flex h-full items-center justify-center text-sm text-muted-foreground">
          {{ i18n.t('graph.empty') }}
        </p>
        <GraphView v-else ref="canvas" :view="view" :active-id="editor.activePath" @select="onSelect" />
      </div>
    </div>
  </Dialog>
</template>

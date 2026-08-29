<script setup lang="ts">
import cytoscape, { type Core, type ElementDefinition, type StylesheetJsonBlock } from 'cytoscape'
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { GraphView } from '@/core/links/graph-view'
import { isMissingNode } from '@/core/links/graph-view'
import { useThemeStore } from '@/stores/theme'

/**
 * 知识图谱的渲染层（需求 11.2）。
 *
 * 只负责画：数据怎么算在 `core/links/graph-view.ts`，这里不做任何图论判断。
 * 用 cytoscape 是因为它已经随 mermaid 进了依赖树（同一个 3.34.x），
 * 显式登记为直接依赖后体积零增量——而不是因为它比别的库好。
 */

const props = defineProps<{
  view: GraphView
  /** 当前打开的笔记，在图上高亮 */
  activeId: string | null
}>()

const emit = defineEmits<{ (e: 'select', id: string): void }>()
const theme = useThemeStore()

const host = ref<HTMLElement | null>(null)
// 实例不需要响应式，深层代理反而会拖慢 cytoscape 的内部读写
const cy = shallowRef<Core | null>(null)

/** 节点大小随连接数增长，但增速要压住：度数高的节点否则会大到盖住旁边 */
function sizeOf(degree: number): number {
  return 18 + Math.min(degree, 12) * 2.5
}

function toElements(view: GraphView): ElementDefinition[] {
  return [
    ...view.nodes.map((node) => ({
      data: {
        id: node.id,
        label: node.label,
        size: sizeOf(node.degree),
        missing: node.missing ? 1 : 0,
      },
    })),
    ...view.edges.map((edge) => ({
      data: { id: edge.id, source: edge.source, target: edge.target },
    })),
  ]
}

/**
 * 把任意 CSS 颜色实际画一个像素再读回 RGB。
 *
 * 本项目的主题变量是 `oklch(...)`。canvas 的 `fillStyle` 认它，但 cytoscape
 * 在需要与不透明度混合时（`text-background-opacity` 等）会用**自己**的颜色解析器，
 * 那个解析器不认 oklch，解析失败就退成黑色——表现为标签垫成一片黑，字全看不见。
 * 让浏览器渲染一遍再取值，是唯一不依赖颜色语法的做法。
 */
function toRgb(value: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1

  const ctx = canvas.getContext('2d')
  if (!ctx) return value

  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data

  return `rgb(${r}, ${g}, ${b})`
}

/**
 * 颜色全部从 CSS 变量读。
 * cytoscape 画在 canvas 上，拿不到 CSS 变量，只能在创建时把当前值取出来；
 * 因此主题切换后需要重建（见下面的 watch）。
 */
function readTheme(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string): string =>
    toRgb(styles.getPropertyValue(name).trim() || fallback)

  return {
    node: read('--primary', '#3b82f6'),
    nodeText: read('--foreground', '#111827'),
    muted: read('--muted-foreground', '#6b7280'),
    edge: read('--border', '#d1d5db'),
    active: read('--destructive', '#ef4444'),
    // 标签垫底色，避免与边线、其它标签叠在一起看不清
    labelBackdrop: read('--background', '#ffffff'),
  }
}

function graphStyle(theme: Record<string, string>): StylesheetJsonBlock[] {
  return [
    {
      selector: 'node',
      style: {
        'background-color': theme.node,
        width: 'data(size)',
        height: 'data(size)',
        label: 'data(label)',
        color: theme.nodeText,
        'font-size': 10,
        'text-valign': 'bottom',
        'text-margin-y': 4,
        // 标签太长会糊成一片，截断并给出省略号
        'text-max-width': '90px',
        'text-wrap': 'ellipsis',
        // 垫一层背景：节点密集时标签会互相压住，光靠间距压不住
        'text-background-color': theme.labelBackdrop,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      // 尚未创建的笔记画成空心，一眼能看出「这篇还不存在」。
      // 用 background-opacity 而不是 `transparent` 色值——cytoscape 的颜色解析器
      // 不认关键字，会当成解析失败退回实心。
      selector: 'node[missing = 1]',
      style: {
        'background-opacity': 0,
        'border-width': 1.5,
        'border-color': theme.muted,
        color: theme.muted,
      },
    },
    {
      selector: 'node.active',
      style: { 'background-color': theme.active, 'border-width': 3, 'border-color': theme.active },
    },
    {
      selector: 'edge',
      style: {
        width: 1,
        'line-color': theme.edge,
        'target-arrow-color': theme.edge,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.7,
        'curve-style': 'bezier',
      },
    },
  ]
}

function render(): void {
  if (!host.value) return

  cy.value?.destroy()

  const theme = readTheme()
  const instance = cytoscape({
    container: host.value,
    elements: toElements(props.view),
    // 关掉框选：图谱是用来看和跳转的，多选没有对应的动作
    boxSelectionEnabled: false,
    style: graphStyle(theme),
    /**
     * 斥力与边长都调得比默认大不少：默认参数下标签会挤成一团，
     * 而图谱的价值恰恰在于「一眼看出谁和谁有关」，读不清标签就没意义了。
     * componentSpacing 负责把互不相连的子图推开。
     */
    layout: {
      name: 'cose',
      animate: false,
      nodeRepulsion: () => 20000,
      idealEdgeLength: () => 120,
      componentSpacing: 120,
      padding: 40,
      nodeDimensionsIncludeLabels: true,
    },
  })

  instance.on('tap', 'node', (event) => {
    emit('select', event.target.id() as string)
  })

  cy.value = instance
  highlightActive()
}

function highlightActive(): void {
  const instance = cy.value
  if (!instance) return

  instance.nodes().removeClass('active')
  if (props.activeId) instance.getElementById(props.activeId).addClass('active')
}

/** 只替换样式并请求 canvas 重绘，保留用户当前的节点位置、缩放与平移。 */
function redrawTheme(): void {
  cy.value?.style(graphStyle(readTheme())).update()
}

onMounted(render)

onBeforeUnmount(() => {
  cy.value?.destroy()
  cy.value = null
})

// 数据变了要重画；只换高亮则不必重跑布局，否则节点会整体跳一次
watch(() => props.view, render, { deep: false })
watch(() => props.activeId, highlightActive)
// cytoscape 绘制在 canvas 上，不会随 CSS 变量自动换色。等主题样式节点更新完再重绘，
// 同时覆盖明暗模式、内置配色和自定义 CSS 对颜色变量的修改，但不重跑布局。
watch(
  () => [theme.isDark, theme.preset, theme.customCss] as const,
  async () => {
    await nextTick()
    redrawTheme()
  },
  { flush: 'post' },
)

defineExpose({
  /** 重置视野，供外部的「适应画布」按钮调用 */
  fit: () => cy.value?.fit(undefined, 40),
  isMissing: isMissingNode,
})
</script>

<template>
  <div ref="host" class="size-full" />
</template>

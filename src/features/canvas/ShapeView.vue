<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { anchorOn, boundsOf, pointsToPath } from '@/core/canvas/geometry'
import { isLine, type Shape } from '@/core/canvas/types'
import { stem } from '@/core/path'
import { useAttachmentsStore } from '@/stores/attachments'
import { useI18nStore } from '@/stores/i18n'

/**
 * 单个图元的渲染。
 *
 * 用 SVG 而非 Canvas：图元就是 DOM 节点，命中测试与 hover 交给浏览器，
 * 颜色能直接用主题变量（深色模式自动跟随）。理由详见 ADR-0002。
 */

const props = defineProps<{
  shape: Shape
  selected: boolean
  /** 全部图元，连线要用它查两端的位置 */
  all: readonly Shape[]
  documentPath: string
}>()

const attachments = useAttachmentsStore()
const i18n = useI18nStore()
const imageUrl = ref('')
let ownedUrl = ''
let imageRequest = 0
let destroyed = false

watch(
  () => [props.shape.kind === 'imageRef' ? props.shape.src : '', props.documentPath] as const,
  async ([src]) => {
    const request = ++imageRequest
    if (ownedUrl) attachments.release(ownedUrl)
    ownedUrl = ''
    imageUrl.value = ''
    if (!src) return
    const url = await attachments.resolve(src, props.documentPath)
    if (!url) return
    if (destroyed || request !== imageRequest) {
      attachments.release(url)
      return
    }
    ownedUrl = url
    imageUrl.value = url
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  destroyed = true
  imageRequest += 1
  if (ownedUrl) attachments.release(ownedUrl)
})

const box = computed(() => boundsOf(props.shape))

/**
 * 连线的实际端点。
 *
 * 绑了图形就从对方中心方向求边界交点，这样图形移动时线自动跟随，
 * 且永远停在边上而不是插进图形里。没绑就用记录的坐标。
 */
const linePoints = computed(() => {
  const shape = props.shape
  if (!isLine(shape)) return null

  const fromShape = shape.fromId ? props.all.find((item) => item.id === shape.fromId) : null
  const toShape = shape.toId ? props.all.find((item) => item.id === shape.toId) : null

  const fromCenter = fromShape ? centerOf(fromShape) : shape.from
  const toCenter = toShape ? centerOf(toShape) : shape.to

  return {
    from: fromShape ? anchorOn(boundsOf(fromShape), toCenter) : shape.from,
    to: toShape ? anchorOn(boundsOf(toShape), fromCenter) : shape.to,
  }
})

function centerOf(shape: Shape): { x: number; y: number } {
  const bounds = boundsOf(shape)
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

/** 文本在图形中垂直居中，便利贴则靠上——便利贴常写好几行 */
const textY = computed(() =>
  props.shape.kind === 'note' ? box.value.y + 20 : box.value.y + box.value.height / 2,
)
</script>

<template>
  <g :data-shape-id="shape.id" :class="shape.locked && 'pointer-events-none'">
    <!--
      透明的命中区域，画在最底下。
      没有它，纯文本只有笔画本身可点、细线要精确点在 1px 上——
      用户以为「点不中」是程序卡了，其实是命中范围就那么大。
      线用一条加粗的透明副本，其余用包围盒。
    -->
    <line
      v-if="linePoints"
      :x1="linePoints.from.x"
      :y1="linePoints.from.y"
      :x2="linePoints.to.x"
      :y2="linePoints.to.y"
      stroke="transparent"
      :stroke-width="Math.max(shape.strokeWidth + 12, 14)"
    />
    <rect
      v-else
      :x="box.x"
      :y="box.y"
      :width="box.width"
      :height="box.height"
      fill="transparent"
    />

    <!-- 矩形 / 便利贴 -->
    <rect
      v-if="shape.kind === 'rect' || shape.kind === 'note'"
      :x="box.x"
      :y="box.y"
      :width="box.width"
      :height="box.height"
      :rx="shape.kind === 'note' ? 4 : 2"
      :fill="shape.kind === 'note' ? (shape.fill || 'var(--light-note-bg)') : (shape.fill || 'transparent')"
      :stroke="shape.stroke"
      :stroke-width="shape.strokeWidth"
    />

    <ellipse
      v-else-if="shape.kind === 'ellipse'"
      :cx="box.x + box.width / 2"
      :cy="box.y + box.height / 2"
      :rx="box.width / 2"
      :ry="box.height / 2"
      :fill="shape.fill || 'transparent'"
      :stroke="shape.stroke"
      :stroke-width="shape.strokeWidth"
    />

    <!-- 线与箭头 -->
    <line
      v-else-if="linePoints"
      :x1="linePoints.from.x"
      :y1="linePoints.from.y"
      :x2="linePoints.to.x"
      :y2="linePoints.to.y"
      :stroke="shape.stroke"
      :stroke-width="shape.strokeWidth"
      :marker-end="shape.kind === 'arrow' ? 'url(#light-arrowhead)' : undefined"
    />

    <path
      v-else-if="shape.kind === 'draw'"
      :d="pointsToPath(shape.points)"
      fill="none"
      :stroke="shape.stroke"
      :stroke-width="shape.strokeWidth"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <!-- 嵌入的笔记卡片（4.5）：只画标题，内容始终以文件为准 -->
    <g v-else-if="shape.kind === 'noteRef'">
      <rect
        :x="box.x"
        :y="box.y"
        :width="box.width"
        :height="box.height"
        rx="4"
        fill="var(--card)"
        :stroke="shape.stroke"
        :stroke-width="shape.strokeWidth"
      />
      <text
        :x="box.x + 10"
        :y="box.y + 24"
        fill="var(--foreground)"
        font-size="13"
        class="select-none"
      >
        {{ shape.path ? stem(shape.path) : i18n.t('canvas.unlinkedNote') }}
      </text>
      <text :x="box.x + 10" :y="box.y + 42" fill="var(--muted-foreground)" font-size="11" class="select-none">
        {{ i18n.t('canvas.open') }}
      </text>
    </g>

    <g v-else-if="shape.kind === 'imageRef'">
      <rect :x="box.x" :y="box.y" :width="box.width" :height="box.height" rx="4" fill="var(--muted)" />
      <image
        v-if="imageUrl"
        :href="imageUrl"
        :x="box.x"
        :y="box.y"
        :width="box.width"
        :height="box.height"
        preserveAspectRatio="xMidYMid meet"
      />
      <text v-else :x="box.x + 10" :y="box.y + 24" fill="var(--muted-foreground)" font-size="12">
        {{ shape.alt || i18n.t('canvas.imageUnavailable') }}
      </text>
    </g>

    <g v-else-if="shape.kind === 'boardCardRef'">
      <rect
        :x="box.x" :y="box.y" :width="box.width" :height="box.height" rx="6"
        fill="var(--card)" :stroke="shape.stroke" :stroke-width="shape.strokeWidth"
      />
      <text :x="box.x + 10" :y="box.y + 22" fill="var(--muted-foreground)" font-size="10">
        {{ stem(shape.boardPath) }}
      </text>
      <text :x="box.x + 10" :y="box.y + 44" fill="var(--foreground)" font-size="13">
        {{ shape.title || i18n.t('board.untitledCard') }}
      </text>
      <text :x="box.x + 10" :y="box.y + 64" fill="var(--muted-foreground)" font-size="11">{{ i18n.t('canvas.openBoard') }}</text>
    </g>

    <!--
      文本层：矩形、椭圆、便利贴、纯文本共用。
      颜色跟随描边色，这样改一次颜色整个图形（含里面的字）都变；
      便利贴例外——它的描边是透明的，跟着走就成了看不见的字。
    -->
    <text
      v-if="'text' in shape && shape.text"
      :x="shape.kind === 'text' ? box.x : box.x + box.width / 2"
      :y="shape.kind === 'text' ? box.y + (shape.kind === 'text' ? shape.fontSize : 16) : textY"
      :text-anchor="shape.kind === 'text' ? 'start' : 'middle'"
      :dominant-baseline="shape.kind === 'note' ? 'hanging' : 'middle'"
      :font-size="shape.kind === 'text' ? shape.fontSize : 13"
      :fill="shape.kind === 'note' ? 'var(--foreground)' : shape.stroke"
      class="select-none"
    >
      {{ shape.text }}
    </text>

    <!-- 选中框：画在最外层，且不吃鼠标事件，免得挡住图形本身 -->
    <rect
      v-if="selected"
      :x="box.x - 4"
      :y="box.y - 4"
      :width="box.width + 8"
      :height="box.height + 8"
      fill="none"
      stroke="var(--ring)"
      stroke-width="1.5"
      stroke-dasharray="4 3"
      class="pointer-events-none"
    />
  </g>
</template>

<script setup lang="ts">
import { ScrollAreaCorner, ScrollAreaRoot, ScrollAreaViewport, type ScrollAreaRootProps } from 'reka-ui'
import { cn } from '@/lib/utils'
import ScrollBar from './ScrollBar.vue'

/**
 * 统一滚动容器。
 *
 * 不用浏览器原生滚动条：各平台样式不一致，暗色主题下尤其突兀，且无法跟随主题变量。
 * 这里用 reka-ui 的 ScrollArea 渲染自绘滚动条，颜色走 `--border` / `--muted-foreground`，
 * 因此明暗主题与用户自定义 CSS 都能自动生效。
 *
 * viewport 用 `absolute inset-0` 而不是 `h-full` 撑满。
 *
 * `h-full` 是 `height: 100%`，而百分比高度要求父级有**确定**的高度。
 * 当 ScrollArea 是 `flex-1` 且它的 flex 容器本身高度由内容决定（比如对话框只写了
 * `max-h-[74vh]`），父级高度对百分比而言就是不确定的，`height: 100%` 会算成 0 或
 * 退化成 auto——viewport 于是长得和内容一样高，`scrollHeight === clientHeight`，
 * 滚动条永远不出现，内容被外层的 `overflow-hidden` 直接切掉。
 *
 * 绝对定位不走百分比那条路：它相对的是定位祖先的 padding box，用的是布局算完的
 * **实际**尺寸，因此不管父级高度是写死的、flex 分配的还是 max-height 截出来的都成立。
 * ScrollAreaRoot 自带 `position: relative`，正好是那个定位祖先。
 *
 * 父级仍需给 `min-h-0`：flex 项默认 `min-height: auto`，不放开的话它根本不会被压缩。
 */
const props = defineProps<ScrollAreaRootProps & { class?: string; viewportClass?: string }>()
</script>

<template>
  <ScrollAreaRoot
    :type="props.type ?? 'hover'"
    :scroll-hide-delay="props.scrollHideDelay ?? 600"
    :dir="props.dir"
    :class="cn('relative flex flex-col overflow-hidden', props.class)"
  >
    <ScrollAreaViewport :class="cn('min-h-0 flex-1 rounded-[inherit]', props.viewportClass)">
      <slot />
    </ScrollAreaViewport>

    <ScrollBar />
    <ScrollBar orientation="horizontal" />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>

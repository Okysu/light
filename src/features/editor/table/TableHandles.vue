<script setup lang="ts">
import type { Ctx } from '@milkdown/kit/ctx'
import { onBeforeUnmount, onMounted } from 'vue'
import type { TableMenuState } from './controller'
import { HANDLE_GAP, HANDLE_LONG, HANDLE_SHORT, type TableHandlesState } from './handles'
import { useI18nStore } from '@/stores/i18n'

const props = defineProps<{
  handles: TableHandlesState
  menu: TableMenuState
  getCtx: () => Ctx | null
}>()
const i18n = useI18nStore()

let uninstall: (() => void) | null = null

onMounted(() => {
  uninstall = props.handles.install()
})

onBeforeUnmount(() => {
  uninstall?.()
  props.handles.clear()
})

/**
 * 点击把手 → 选中整行/整列并弹菜单。
 *
 * 用 pointerdown 而非 click：编辑器会在 pointerdown 时移动光标，
 * 等到 click 触发时选区已经变了。同时阻止默认行为，避免焦点被抢走。
 *
 * 这里只传**坐标**，行列由 controller 对当前文档解析：
 * 增删行列会让表格整体重渲染，缓存的单元格引用随即失效，
 * 表现为「第二次操作时菜单项全部置灰、移动无效」。
 */
/** 从把手向表格内侧取一个探测点，落在它所对应的那个单元格里 */
function probePoint(anchor: DOMRect, kind: 'row' | 'col'): { x: number; y: number } {
  const inset = HANDLE_GAP + 8
  return kind === 'col'
    ? { x: anchor.left + anchor.width / 2, y: anchor.bottom + inset }
    : { x: anchor.right + inset, y: anchor.top + anchor.height / 2 }
}

function activate(event: PointerEvent, kind: 'row' | 'col'): void {
  event.preventDefault()
  event.stopPropagation()

  const ctx = props.getCtx()
  if (!ctx) return

  const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect()
  props.menu.openForPoint(ctx, probePoint(anchor, kind), kind, anchor)
}
</script>

<template>
  <Teleport to="body">
    <button
      v-if="handles.colPos.value"
      type="button"
      class="light-table-handle light-table-handle-col"
      :title="i18n.t('table.selectColumn')"
      :style="{
        left: `${handles.colPos.value.x}px`,
        top: `${handles.colPos.value.y}px`,
        width: `${HANDLE_LONG}px`,
        height: `${HANDLE_SHORT}px`,
      }"
      @pointerdown="activate($event, 'col')"
    />

    <button
      v-if="handles.rowPos.value"
      type="button"
      class="light-table-handle light-table-handle-row"
      :title="i18n.t('table.selectRow')"
      :style="{
        left: `${handles.rowPos.value.x}px`,
        top: `${handles.rowPos.value.y}px`,
        width: `${HANDLE_SHORT}px`,
        height: `${HANDLE_LONG}px`,
      }"
      @pointerdown="activate($event, 'row')"
    />
  </Teleport>
</template>

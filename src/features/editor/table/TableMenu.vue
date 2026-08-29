<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ctx } from '@milkdown/kit/ctx'
import { cn } from '@/lib/utils'
import type { TableMenuState } from './controller'

const props = defineProps<{ menu: TableMenuState; getCtx: () => Ctx | null }>()

const root = ref<HTMLElement | null>(null)

/** 贴边时把菜单翻到另一侧，避免超出视口被裁掉 */
watch(
  () => props.menu.visible.value,
  async (visible) => {
    if (!visible) return
    await new Promise((resolve) => requestAnimationFrame(resolve))

    const element = root.value
    if (!element) return

    const rect = element.getBoundingClientRect()
    if (rect.right > window.innerWidth - 8) {
      element.style.left = `${Math.max(8, props.menu.x.value - rect.width)}px`
    }
    if (rect.bottom > window.innerHeight - 8) {
      element.style.top = `${Math.max(8, props.menu.y.value - rect.height)}px`
    }
  },
)

function onPointerDown(event: MouseEvent): void {
  if (root.value?.contains(event.target as Node)) return
  props.menu.close()
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') props.menu.close()
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKeyDown)
})

function activate(item: (typeof props.menu.items.value)[number]): void {
  const ctx = props.getCtx()
  if (ctx) props.menu.run(item, ctx)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="menu.visible.value"
      ref="root"
      class="fixed z-50 min-w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      :style="{ left: `${menu.x.value}px`, top: `${menu.y.value}px` }"
      role="menu"
    >
      <template v-for="item in menu.items.value" :key="item.id">
        <div v-if="item.separatorBefore" class="my-1 h-px bg-border" />
        <button
          type="button"
          role="menuitem"
          :disabled="item.disabled?.(menu.context.value) ?? false"
          :class="
            cn(
              'flex w-full items-center rounded-sm border border-transparent px-2 py-1.5 text-left text-sm',
              'hover:bg-accent hover:text-accent-foreground',
              'disabled:pointer-events-none disabled:opacity-40',
              item.danger && 'text-destructive hover:bg-destructive/10 hover:text-destructive',
            )
          "
          @click="activate(item)"
        >
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from 'reka-ui'
import type { Component } from 'vue'

/**
 * 一条普通的菜单项。
 */
export interface MenuAction {
  label: string
  icon?: Component
  /** 分组分隔线画在此项之前 */
  separatorBefore?: boolean
  /** 危险操作（删除类）用警示色 */
  danger?: boolean
  disabled?: boolean
  action: () => void | Promise<void>
}

/**
 * 带子菜单的项。
 *
 * 之前「移动到某一列」是拿一个 disabled 的标题项加上缩进的兄弟项拼出来的——
 * 看着像分组，实际上键盘导航会停在那个假标题上，屏幕阅读器也读不出层级。
 * 用真正的 Sub 菜单表达从属关系，这些就都是免费的。
 */
export interface MenuSubmenu {
  label: string
  icon?: Component
  separatorBefore?: boolean
  disabled?: boolean
  /** 子项为空时整条不渲染——空的子菜单点开是一片空白，比不给更让人困惑 */
  items: MenuAction[]
}

export type MenuItem = MenuAction | MenuSubmenu

function isSubmenu(item: MenuItem): item is MenuSubmenu {
  return 'items' in item
}

defineProps<{ items: MenuItem[] }>()

/** 菜单项与子菜单项共用同一套外观，避免两处样式各自演化 */
const ITEM_CLASS =
  'flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50'

const DANGER_CLASS =
  'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive'

const PANEL_CLASS =
  'z-50 min-w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <ContextMenuContent :class="PANEL_CLASS" :collision-padding="8">
        <template v-for="(item, index) in items" :key="index">
          <ContextMenuSeparator v-if="item.separatorBefore" class="my-1 h-px bg-border" />

          <ContextMenuSub v-if="isSubmenu(item)">
            <ContextMenuSubTrigger v-if="item.items.length > 0" :class="ITEM_CLASS" :disabled="item.disabled">
              <component :is="item.icon" v-if="item.icon" class="size-4" />
              {{ item.label }}
              <ChevronRight class="ml-auto size-3.5 text-muted-foreground" />
            </ContextMenuSubTrigger>

            <ContextMenuPortal>
              <ContextMenuSubContent :class="PANEL_CLASS" :collision-padding="8" :side-offset="2">
                <ContextMenuItem
                  v-for="(child, childIndex) in item.items"
                  :key="childIndex"
                  :disabled="child.disabled"
                  :class="[ITEM_CLASS, child.danger && DANGER_CLASS]"
                  @select="child.action()"
                >
                  <component :is="child.icon" v-if="child.icon" class="size-4" />
                  {{ child.label }}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>

          <ContextMenuItem
            v-else
            :disabled="item.disabled"
            :class="[ITEM_CLASS, item.danger && DANGER_CLASS]"
            @select="item.action()"
          >
            <component :is="item.icon" v-if="item.icon" class="size-4" />
            {{ item.label }}
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>

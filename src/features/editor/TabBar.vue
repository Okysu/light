<script setup lang="ts">
import { FileText, Kanban, PencilRuler, X, type LucideIcon } from 'lucide-vue-next'
import { computed } from 'vue'
import ContextMenu, { type MenuItem } from '@/components/ContextMenu.vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import { stem } from '@/core/path'
import { kindOf } from '@/core/workspace/tree'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/editor'
import { useI18nStore } from '@/stores/i18n'

/**
 * 标签页栏（需求 S11）。
 *
 * 只显示已打开文档的路径列表，内容仍由编辑器按当前激活路径读取——
 * 标签页不缓存内容，避免出现「哪份才是最新」的第二真相。
 */
const editor = useEditorStore()
const i18n = useI18nStore()

const ICONS: Record<string, LucideIcon> = { note: FileText, board: Kanban, canvas: PencilRuler }

const items = computed(() =>
  editor.tabs.map((path) => ({
    path,
    label: stem(path),
    icon: ICONS[kindOf(path) ?? 'note'] ?? FileText,
    active: editor.activePath === path,
    // 未保存的改动只可能发生在当前激活的那篇
    dirty: editor.activePath === path && editor.dirty,
  })),
)

function menuFor(path: string): MenuItem[] {
  return [
    { label: i18n.t('common.close'), action: () => editor.closeTab(path) },
    { label: i18n.t('tabs.closeOthers'), action: () => editor.closeOthers(path) },
    { label: i18n.t('tabs.closeAll'), separatorBefore: true, danger: true, action: () => editor.closeAll() },
  ]
}

/** 中键关闭，与浏览器标签页一致 */
function onAuxClick(event: MouseEvent, path: string): void {
  if (event.button !== 1) return
  event.preventDefault()
  void editor.closeTab(path)
}
</script>

<template>
  <div
    v-if="items.length > 0"
    class="light-print-hide flex h-9 shrink-0 items-stretch border-b border-border bg-sidebar"
  >
    <ScrollArea class="min-w-0 flex-1" viewport-class="flex h-full">
      <div class="flex h-full items-stretch">
        <ContextMenu v-for="item in items" :key="item.path" :items="menuFor(item.path)">
          <div
            :class="
              cn(
                'group flex h-full max-w-52 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-sm',
                // 边框常驻、仅换颜色（S2）：激活态用顶部色条标识，不改变尺寸
                'border-t-2 border-t-transparent',
                item.active
                  ? 'border-t-primary bg-background text-foreground'
                  : 'text-muted-foreground hover:bg-background/60',
              )
            "
            @click="editor.openNote(item.path)"
            @auxclick="onAuxClick($event, item.path)"
          >
            <component :is="item.icon" class="size-3.5 shrink-0" />
            <span class="truncate">{{ item.label }}</span>

            <!-- 有未保存改动时以圆点提示，悬停后让位给关闭按钮 -->
            <span
              v-if="item.dirty"
              class="size-1.5 shrink-0 rounded-full bg-primary group-hover:hidden"
              :title="i18n.t('tabs.unsaved')"
            />
            <button
              type="button"
              :class="cn('shrink-0 rounded-sm p-0.5 hover:bg-muted', item.dirty && 'hidden group-hover:block')"
              :title="i18n.t('common.close')"
              @click.stop="editor.closeTab(item.path)"
            >
              <X class="size-3" />
            </button>
          </div>
        </ContextMenu>
      </div>
    </ScrollArea>
  </div>
</template>

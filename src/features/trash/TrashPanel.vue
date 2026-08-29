<script setup lang="ts">
import { FileText, FolderClosed, Kanban, PencilRuler, RotateCcw, type LucideIcon } from 'lucide-vue-next'
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { stem } from '@/core/path'
import type { NodeKind } from '@/core/workspace/types'
import { formatRelativeTime } from '@/lib/utils'
import { useConfirm } from '@/composables/use-confirm'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18nStore } from '@/stores/i18n'

const ui = useUiStore()
const workspace = useWorkspaceStore()
const editor = useEditorStore()
const i18n = useI18nStore()
const { confirm } = useConfirm()

const ICONS: Record<NodeKind, LucideIcon> = {
  folder: FolderClosed,
  note: FileText,
  board: Kanban,
  canvas: PencilRuler,
}

/**
 * 永久删除与清空都不可撤销，一律走确认对话框。
 *
 * 此前用的是「点两次、按钮变成确认删除」的轻量确认。换掉是因为它在这里不够：
 * 按钮原地变字，视线不一定跟得上，手快的人两下就点完了；而这两个操作删掉的
 * 是回收站里最后一份副本，没有下一个后悔的机会。
 */
const busy = ref(false)

// 每次打开都重新拉一次：其它设备同步过来的删除也应体现
watch(
  () => ui.trashOpen,
  (open) => {
    if (open) void workspace.refresh()
  },
)

async function restore(archivedPath: string): Promise<void> {
  busy.value = true
  try {
    await workspace.restoreFromTrash(archivedPath)
  } finally {
    busy.value = false
  }
}

async function purge(archivedPath: string, name: string): Promise<void> {
  const ok = await confirm({
    title: i18n.t('trash.purgeConfirmTitle'),
    description: i18n.t('trash.purgeConfirmDescription', { name }),
    confirmLabel: i18n.t('trash.purge'),
    danger: true,
  })
  if (!ok) return

  busy.value = true
  try {
    await workspace.purgeFromTrash(archivedPath)
  } finally {
    busy.value = false
  }
}

async function empty(): Promise<void> {
  const ok = await confirm({
    title: i18n.t('trash.emptyConfirmTitle'),
    description: i18n.t('trash.emptyConfirmDescription', { count: workspace.trashItems.length }),
    confirmLabel: i18n.t('trash.emptyAction'),
    danger: true,
  })
  if (!ok) return

  busy.value = true
  try {
    await workspace.emptyTrash()
  } finally {
    busy.value = false
  }
}

/** 还原后若正编辑的就是它，路径已变，这里不做处理；删除时才需要关掉编辑器 */
function isEditing(originalPath: string): boolean {
  return editor.activePath === originalPath
}
</script>

<template>
  <Dialog v-model:open="ui.trashOpen" :title="i18n.t('trash.panelTitle')" class="max-h-[70vh]">
    <div class="flex items-center justify-between border-b border-border px-5 pb-3 pt-2">
      <p class="text-xs text-muted-foreground">
        {{
          workspace.config.trashRetentionDays > 0
            ? i18n.t('trash.autoDays', { count: workspace.config.trashRetentionDays })
            : i18n.t('trash.never')
        }}
      </p>
      <Button
        v-if="workspace.trashItems.length > 0"
        size="sm"
        variant="ghost"
        :disabled="busy"
        @click="empty"
      >
        {{ i18n.t('trash.emptyAction') }}
      </Button>
    </div>

    <ScrollArea class="min-h-0 flex-1" viewport-class="p-2">
      <p v-if="workspace.trashItems.length === 0" class="px-3 py-10 text-center text-sm text-muted-foreground">
        {{ i18n.t('trash.empty') }}
      </p>

      <div
        v-for="item in workspace.trashItems"
        :key="item.archivedPath"
        class="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent/50"
      >
        <component :is="ICONS[item.kind]" class="size-4 shrink-0 text-muted-foreground" />

        <div class="min-w-0 flex-1">
          <p class="truncate text-sm">{{ item.originalPath.split('/').pop() }}</p>
          <p class="truncate text-xs text-muted-foreground">
            {{ item.originalPath }} · {{ i18n.t('trash.deleted', { time: formatRelativeTime(item.deletedAt, i18n.locale) }) }}
            <span v-if="isEditing(item.originalPath)"> · {{ i18n.t('trash.editing') }}</span>
          </p>
        </div>

        <Button size="sm" variant="ghost" :disabled="busy" :title="i18n.t('trash.restoreTitle')" @click="restore(item.archivedPath)">
          <RotateCcw />
          {{ i18n.t('trash.restore') }}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          :disabled="busy"
          @click="purge(item.archivedPath, stem(item.originalPath))"
        >
          {{ i18n.t('trash.purge') }}
        </Button>
      </div>
    </ScrollArea>
  </Dialog>
</template>

<script setup lang="ts">
import { Clock, FileText, History, RotateCw, Star, StarOff, X } from 'lucide-vue-next'
import { onMounted, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { stem } from '@/core/path'
import { formatRelativeTime } from '@/lib/utils'
import { useCollectionsStore } from '@/stores/collections'
import { useEditorStore } from '@/stores/editor'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18nStore } from '@/stores/i18n'
import FileTree from './FileTree.vue'
import SidebarSection from './SidebarSection.vue'
import SidebarStatus from './SidebarStatus.vue'
import TagTreeItem from './TagTreeItem.vue'

/**
 * 侧边栏。
 *
 * 四个分区各自折叠：收藏夹（1.3）、笔记树、标签（1.6）、最近（1.7）。
 *
 * 收藏夹、标签、最近编辑都是**由内容推导的视图**，不是真实目录，
 * 因此它们不能被重命名或删除——这也是「文件即真源」的自然结果：
 * 收藏状态就是 frontmatter 里的 `favorite`，在别的工具里改了这里立刻跟着变。
 */
const workspace = useWorkspaceStore()
const collections = useCollectionsStore()
const editor = useEditorStore()
const i18n = useI18nStore()

// 文件树变化后重算派生视图；标签与更新时间都随内容变
watch(() => workspace.tree, () => void collections.refresh(), { deep: true })

onMounted(() => void collections.refresh())

async function open(path: string): Promise<void> {
  if (!(await editor.openNote(path))) {
    collections.forget(path)
    await collections.refresh()
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 收藏夹是自带层级，置顶且不可增删 -->
    <div class="shrink-0 border-b border-border">
      <SidebarSection id="favorites" :title="i18n.t('sidebar.favorites')" :count="collections.favorites.length">
        <ScrollArea class="max-h-40" viewport-class="px-1 pb-2">
          <p v-if="collections.favorites.length === 0" class="px-3 py-2 text-xs text-muted-foreground">
            {{ i18n.t('sidebar.noFavorites') }}<br />
            {{ i18n.t('sidebar.favoriteHint') }}
          </p>

          <div
            v-for="note in collections.favorites"
            :key="note.path"
            class="group flex items-center rounded-md border border-transparent hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-sm"
              :style="{ paddingBlock: 'calc(0.2rem * var(--light-density))' }"
              @click="open(note.path)"
            >
              <Star class="size-3.5 shrink-0 fill-current text-muted-foreground" />
              <span class="truncate">{{ note.title }}</span>
            </button>
            <button
              type="button"
              class="mr-1 hidden shrink-0 rounded-sm p-1 text-muted-foreground hover:text-destructive group-hover:block"
              :title="i18n.t('sidebar.removeFavorite')"
              @click="collections.toggleFavorite(note.path)"
            >
              <StarOff class="size-3.5" />
            </button>
          </div>
        </ScrollArea>
      </SidebarSection>
    </div>

    <!-- 笔记树占据主要空间，标签与最近固定在下方 -->
    <div class="flex min-h-0 flex-1 flex-col">
      <FileTree />
    </div>

    <div class="max-h-[55%] shrink-0 overflow-y-auto border-t border-border">
      <SidebarSection id="tags" :title="i18n.t('sidebar.tags')" :count="collections.tags.length">
        <template #actions>
          <Button
            v-if="collections.activeTag"
            variant="ghost"
            size="icon-sm"
            :title="i18n.t('sidebar.clearFilter')"
            @click="collections.clearFilter()"
          >
            <X />
          </Button>
        </template>

        <ScrollArea class="max-h-40" viewport-class="px-1 pb-2">
          <p v-if="collections.tags.length === 0" class="px-3 py-2 text-xs text-muted-foreground">
            {{ i18n.t('sidebar.noTags') }}<br />
            {{ i18n.t('sidebar.tagHint') }}
          </p>

          <TagTreeItem
            v-for="node in collections.tagTree"
            :key="node.tag"
            :node="node"
            :active-tag="collections.activeTag"
            @select="collections.toggleTag($event)"
          />
        </ScrollArea>
      </SidebarSection>

      <SidebarSection id="recent" :title="i18n.t('sidebar.recent')" :default-open="false">
        <template #actions>
          <Button variant="ghost" size="icon-sm" :title="i18n.t('common.refresh')" @click="collections.refresh()">
            <RotateCw />
          </Button>
        </template>

        <ScrollArea class="max-h-56" viewport-class="px-1 pb-2">
          <p class="flex items-center gap-1 px-2 pb-0.5 pt-1 text-[10px] uppercase text-muted-foreground">
            <History class="size-3" />
            {{ i18n.t('sidebar.recentVisited') }}
          </p>
          <p
            v-if="collections.recentlyVisited.length === 0"
            class="px-3 py-1 text-xs text-muted-foreground"
          >
            {{ i18n.t('sidebar.noRecent') }}
          </p>
          <button
            v-for="path in collections.recentlyVisited"
            :key="`visited-${path}`"
            type="button"
            class="flex w-full items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            @click="open(path)"
          >
            <FileText class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate">{{ stem(path) }}</span>
          </button>

          <p class="flex items-center gap-1 px-2 pb-0.5 pt-2 text-[10px] uppercase text-muted-foreground">
            <Clock class="size-3" />
            {{ i18n.t('sidebar.recentEdited') }}
          </p>
          <button
            v-for="note in collections.recentlyEdited"
            :key="`edited-${note.path}`"
            type="button"
            class="flex w-full items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            @click="open(note.path)"
          >
            <FileText class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate">{{ note.title }}</span>
            <span class="ml-auto shrink-0 text-[10px] text-muted-foreground">
              {{ note.updatedAt ? formatRelativeTime(note.updatedAt, i18n.locale) : '' }}
            </span>
          </button>
        </ScrollArea>
      </SidebarSection>

      <SidebarStatus />
    </div>
  </div>
</template>

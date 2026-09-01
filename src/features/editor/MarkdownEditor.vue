<script setup lang="ts">
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/tables/style/tables.css'
import '@milkdown/kit/prose/gapcursor/style/gapcursor.css'
import 'katex/dist/katex.min.css'
// 官方组件只提供结构与行为，样式必须由使用方提供，否则工具栏会散成纯文本
import './styles/milkdown-components.css'

import type { Ctx } from '@milkdown/kit/ctx'
import { Milkdown, useEditor } from '@milkdown/vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AiSelectionBar from './ai/AiSelectionBar.vue'
import { createSelectionBridge } from './ai/selection-bridge'
import { useEditorStore } from '@/stores/editor'
import { useAttachmentsStore } from '@/stores/attachments'
import { useLinksStore } from '@/stores/links'
import { useWorkspaceStore } from '@/stores/workspace'
import { usePreferencesStore } from '@/stores/preferences'
import { useI18nStore } from '@/stores/i18n'
import { useToastStore } from '@/stores/toast'
import { RemoteImageError } from '@/core/attachments/remote-image'
import { createLightEditor } from './create-editor'
import LinkMenu from './links/LinkMenu.vue'
import SlashMenu from './slash/SlashMenu.vue'
import { createLinkAutocomplete } from './links/link-autocomplete'
import { createSlashController } from './slash/controller'
import BacklinksPanel from '@/features/links/BacklinksPanel.vue'
import PropertyForm from '@/features/properties/PropertyForm.vue'
import TableHandles from './table/TableHandles.vue'
import TableMenu from './table/TableMenu.vue'
import { createTableMenu } from './table/controller'
import { createTableHandles } from './table/handles'
import { installTableEdgeButtons } from './table/edge-buttons'

const store = useEditorStore()
const preferences = usePreferencesStore()
const i18n = useI18nStore()
const links = useLinksStore()
const attachments = useAttachmentsStore()
const workspace = useWorkspaceStore()
const toast = useToastStore()
// 编辑器实例随笔记重建；异步下载必须使用发起时的路径，而不是稍后激活的标签页。
const notePath = store.activePath ?? ''

const titleInput = ref<HTMLTextAreaElement | null>(null)

/** 标题用 textarea 以便长标题自动换行；高度随内容增长 */
function onTitleInput(event: Event): void {
  const element = event.target as HTMLTextAreaElement
  store.updateTitle(element.value)
  autoGrow(element)
}

function autoGrow(element: HTMLTextAreaElement): void {
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}

/** 在标题里按回车应当跳到正文，而不是给标题插入换行 */
function focusBody(): void {
  const editable = host.value?.querySelector<HTMLElement>('.light-prose')
  editable?.focus()
}

// 每个编辑器实例一个控制器；切换笔记时组件重建，控制器随之重建
const slash = createSlashController()
// 候选来源注入而不是让编辑器层直接读 store——保持编辑器与应用状态解耦
const linkAutocomplete = createLinkAutocomplete({
  paths: () => links.notePaths,
  targetFor: (path) => links.targetFor(path),
})
const tableMenu = createTableMenu()
const tableHandles = createTableHandles()

/**
 * 编辑器内部持有 ProseMirror 文档，Markdown 只在两个边界出现：
 * 载入时的 defaultValue，以及 listener 抛出的 markdownUpdated。
 * 转换全部由 Milkdown 的 remark 管道负责，我们不自己拼接 Markdown 字符串。
 *
 * 切换笔记由外层的 :key 触发整体重建（见 App.vue），因此这里不需要
 * 监听 draft 变化去回填内容——那样会把光标顶回开头，也会串掉撤销历史。
 */
const { get } = useEditor((root) =>
  createLightEditor({
    root,
    defaultValue: store.draft,
    onMarkdownUpdated: (markdown) => store.updateContent(markdown),
    slash,
    linkAutocomplete,
    // 附件的相对链接是**相对当前笔记**的，因此桥要闭包住笔记路径
    attachments: {
      save: (data, mime, name) => attachments.save(data, mime, notePath, name),
      resolve: (src) => attachments.resolve(src, notePath),
      release: (url) => attachments.release(url),
      shouldLocalizeRemoteImages: () => preferences.localizeRemoteImages,
      importRemoteImage: (src, signal) => attachments.importRemoteImage(src, notePath, signal),
      onRemoteImageImported: () => toast.success(i18n.t('editor.remoteImageImported')),
      onRemoteImageError: (cause) => toast.error(i18n.t(
        cause instanceof RemoteImageError && cause.reason === 'size'
          ? 'editor.remoteImageTooLarge'
          : 'editor.remoteImageFailed',
      )),
    },
  }),
)

/**
 * 同步取出编辑器 ctx。
 * `action` 的回调是立即执行的，因此可以借它把 ctx 捞出来给表格菜单用，
 * 无需把 ctx 存成响应式状态（它不是数据，是编辑器实例的一部分）。
 */
function getCtx(): Ctx | null {
  const editor = get()
  if (!editor) return null

  let captured: Ctx | null = null
  editor.action((ctx) => {
    captured = ctx
  })
  return captured
}

// 把选区桥交给 store，AI 面板据此读取选中内容并写回结果。
// 卸载时清空：编辑器没了还留着一个指向死实例的桥，调用它只会静默失败
onMounted(() => {
  store.selectionBridge = createSelectionBridge(getCtx)
})
onBeforeUnmount(() => {
  store.selectionBridge = null
})

/**
 * 双向链接的跳转。
 *
 * 用事件委托而不是在 NodeView 里挂 listener：ProseMirror 每次重渲染都会重建
 * 链接的 DOM，逐个绑定既会重复挂载，也会在节点被替换后留下失效的引用。
 * 委托挂在容器上，链接来去都不用管。
 */
async function onClick(event: MouseEvent): Promise<void> {
  const anchor = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-wikilink]')
  if (!anchor) return

  event.preventDefault()
  const target = anchor.dataset['url'] ?? ''
  if (!target) return

  const path = links.resolve(target)
  // 指向尚未创建的笔记时就地创建：先写链接后建笔记是常见写法，
  // 让用户点一下就能补上，比弹一句「不存在」有用
  await (path ? store.openNote(path) : createFromLink(target))
}

async function createFromLink(target: string): Promise<void> {
  const slash = target.lastIndexOf('/')
  const dir = slash === -1 ? '' : target.slice(0, slash)
  const title = slash === -1 ? target : target.slice(slash + 1)

  const path = await workspace.createNote(dir, title)
  await links.touch(path)
  await store.openNote(path)
}

/** 右键落在表格单元格内才接管，其余位置保持浏览器默认行为 */
function onContextMenu(event: MouseEvent): void {
  const ctx = getCtx()
  if (ctx) tableMenu.handleContextMenu(event, ctx)
}

/** 表格的边缘加号按钮，随表格增减自动装配 */
const host = ref<HTMLElement | null>(null)
const tableEnhancements: Array<{ destroy: () => void }> = []

onMounted(() => {
  if (titleInput.value) autoGrow(titleInput.value)
  if (!host.value) return
  tableEnhancements.push(installTableEdgeButtons(host.value, getCtx))

  // 开发期诊断出口：表格交互出问题时，多半要看「把手指向哪个单元格」
  // 与「菜单拿到的行列上下文」是否一致，从控制台直接读比反复加日志快。
  // 生产构建会被摇掉。
  if (import.meta.env.DEV) {
    Reflect.set(window, '__light', { handles: tableHandles, menu: tableMenu, getCtx })
  }
})

onBeforeUnmount(() => {
  tableEnhancements.forEach((handle) => handle.destroy())
  void store.flush()
})
</script>

<template>
  <div
    ref="host"
    class="relative h-full overflow-y-auto"
    @click="onClick"
    @contextmenu="onContextMenu"
  >
    <!-- 划词 AI 工具条。挂在这一层是为了 absolute 定位有个参照，
         且跟着编辑区一起滚动——固定在视口里的话，滚动后它会指着别的地方 -->
    <AiSelectionBar :container="host" />

    <!-- spellcheck 可继承，设在这一层就同时管住标题与正文，改设置立即生效 -->
    <div
      class="mx-auto w-full px-4 py-6 md:px-8 md:py-10"
      :spellcheck="preferences.spellcheck"
      :style="{ maxWidth: 'var(--light-editor-width)' }"
    >
      <!-- 标题 → 属性 → 正文 三层。标题在文件里仍是正文开头的 H1，
           只是在界面上被提到了编辑区之外（见 core/markdown/title.ts） -->
      <textarea
        ref="titleInput"
        class="light-doc-title"
        rows="1"
        :placeholder="i18n.t('editor.untitled')"
        :value="store.docTitle ?? ''"
        @input="onTitleInput"
        @keydown.enter.prevent="focusBody"
      />

      <PropertyForm />
      <Milkdown />
      <BacklinksPanel />
    </div>

    <TableHandles :handles="tableHandles" :menu="tableMenu" :get-ctx="getCtx" />
    <TableMenu :menu="tableMenu" :get-ctx="getCtx" />

    <!-- 菜单渲染进 SlashProvider 管理的挂载点：定位归它，样式与交互归我们 -->
    <Teleport :to="slash.contentEl">
      <SlashMenu :controller="slash" />
    </Teleport>

    <Teleport :to="linkAutocomplete.contentEl">
      <LinkMenu :controller="linkAutocomplete" />
    </Teleport>
  </div>
</template>

<style>
/* 编辑区排版：全部走 --light-* 变量，用户自定义 CSS 覆盖这些变量即可整体改版 */
.light-prose {
  font-size: var(--light-editor-font-size);
  line-height: var(--light-editor-line-height);
  outline: none;
}

.light-prose > * + * {
  margin-top: 0.75em;
}

.light-prose h1,
.light-prose h2,
.light-prose h3,
.light-prose h4 {
  font-weight: 600;
  line-height: 1.3;
  margin-top: 1.6em;
}

.light-prose h1 {
  font-size: 1.75em;
}
.light-prose h2 {
  font-size: 1.4em;
}
.light-prose h3 {
  font-size: 1.2em;
}

.light-prose ul,
.light-prose ol {
  padding-left: 1.5em;
}

.light-prose ul {
  list-style: disc;
}

.light-prose ol {
  list-style: decimal;
}

.light-prose li > ul,
.light-prose li > ol {
  margin-top: 0.25em;
}

.light-prose blockquote {
  border-left: 3px solid var(--border);
  padding-left: 1em;
  color: var(--muted-foreground);
}

.light-prose code {
  font-family: var(--light-font-mono);
  font-size: 0.9em;
  background: var(--muted);
  padding: 0.15em 0.35em;
  border-radius: var(--radius-sm);
}

.light-prose pre {
  background: var(--muted);
  border-radius: var(--radius-md);
  padding: 0.9em 1em;
  overflow-x: auto;
}

.light-prose pre code {
  background: transparent;
  padding: 0;
}

.light-prose hr {
  border-top: 1px solid var(--border);
  margin: 1.5em 0;
}

.light-prose a {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.light-prose img {
  max-width: 100%;
  border-radius: var(--radius-md);
}

/* 双向链接：与普通链接区分开——它指向库内，不会把人带走。
   因此用底部虚线而不是实线下划线，视觉上更"内部引用"一些。 */
.light-wikilink {
  padding: 0 0.1em;
  border: 1px solid transparent; /* 边框常驻，选中时只换颜色（S2） */
  border-bottom: 1px dashed var(--primary);
  border-radius: var(--radius-sm);
  color: var(--primary);
  text-decoration: none;
  cursor: pointer;
}

.light-wikilink:hover {
  background: var(--muted);
  border-bottom-style: solid;
}

.light-wikilink.is-selected {
  border-color: var(--ring);
}

.light-prose table {
  width: 100%;
  border-collapse: collapse;
}

.light-prose th,
.light-prose td {
  border: 1px solid var(--border);
  padding: 0.4em 0.6em;
  text-align: left;
}

.light-prose th {
  background: var(--muted);
  font-weight: 600;
}

/* 尚未建模的语法：只读展示，视觉上明确区分，避免用户以为它坏了 */
.light-raw-block {
  margin: 0.75em 0;
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--muted) 60%, transparent);
  padding: 0.6em 0.8em;
  font-family: var(--light-font-mono);
  font-size: 0.85em;
  white-space: pre-wrap;
  color: var(--muted-foreground);
}

.light-raw-inline {
  border-bottom: 1px dashed var(--border);
  font-family: var(--light-font-mono);
  font-size: 0.9em;
  color: var(--muted-foreground);
}

/* --- 文档标题 --------------------------------------------------------- */

.light-doc-title {
  display: block;
  width: 100%;
  margin-bottom: 0.5rem;
  border: none;
  background: transparent;
  padding: 0;
  font-family: var(--light-font-sans);
  font-size: 2em;
  font-weight: 700;
  line-height: 1.25;
  color: var(--foreground);
  outline: none;
  resize: none;
  overflow: hidden;
}

.light-doc-title::placeholder {
  color: var(--muted-foreground);
  opacity: 0.5;
}

/* --- 数学公式 --------------------------------------------------------- */

.light-math-inline {
  display: inline-block;
  padding: 0 0.15em;
  border: 1px solid transparent; /* 边框常驻，选中时只换颜色（S2） */
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.light-math-block {
  display: block;
  margin: 0.75em 0;
  padding: 0.75em;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  text-align: center;
  cursor: pointer;
}

.light-math-inline:hover,
.light-math-block:hover {
  background: var(--muted);
}

.light-math-inline.is-selected,
.light-math-block.is-selected {
  border-color: var(--ring);
}

.light-math-error {
  color: var(--destructive);
  font-family: var(--light-font-mono);
  font-size: 0.9em;
}

/* 就地编辑公式源码时的输入框 */
.light-math-input {
  width: 100%;
  min-width: 8rem;
  border: 1px solid var(--input);
  border-radius: var(--radius-sm);
  background: var(--background);
  padding: 0.25em 0.4em;
  font-family: var(--light-font-mono);
  font-size: 0.9em;
  color: var(--foreground);
  outline: none;
  resize: vertical;
}

.light-math-input:focus {
  border-color: var(--ring);
}

/* --- Mermaid ---------------------------------------------------------- */

.light-mermaid {
  display: flex;
  justify-content: center;
  padding: 0.5em 0;
}

.light-mermaid svg {
  max-width: 100%;
  height: auto;
}

.light-mermaid-error {
  color: var(--destructive);
  font-family: var(--light-font-mono);
  font-size: 0.85em;
  padding: 0.5em;
}

/* SlashProvider 只写 left/top 与 data-show，其余定位职责在使用方（floating-ui 惯例）：
   这里补上定位方式与隐藏行为，并让挂载点 .milkdown 成为定位上下文 */
.milkdown {
  position: relative;
}

/* 两个打字触发的菜单共用同一套定位：SlashProvider 通过 data-show 控制显隐 */
.light-slash-root,
.light-link-autocomplete-root {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 50;
}

.light-slash-root[data-show='false'],
.light-link-autocomplete-root[data-show='false'] {
  display: none;
}
</style>

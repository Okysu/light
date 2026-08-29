<script setup lang="ts">
import { MilkdownProvider } from '@milkdown/vue'
import MarkdownEditor from './MarkdownEditor.vue'

/**
 * 编辑器外壳。
 *
 * 单独成组件是为了让它整体成为一个**异步加载的边界**：
 * Milkdown、ProseMirror、CodeMirror、KaTeX 加起来超过 1 MB，
 * 但用户在打开第一篇笔记之前完全不需要它们。
 * App 通过 defineAsyncComponent 引入本组件，首屏只需加载外壳与文件树。
 */
</script>

<template>
  <MilkdownProvider>
    <MarkdownEditor />
  </MilkdownProvider>
</template>

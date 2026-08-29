<script setup lang="ts">
import { ref, watch } from 'vue'
import { stabilize } from '@/core/ai/stabilize'

/**
 * 流式 Markdown 渲染。
 *
 * 边收边渲染有两个坑，这里都躲开了：
 *
 * 1. **语法不完整**。刚吐出 `**` 还没闭合、表格只写了一行——直接渲染
 *    会让页面在下一段到达时整个变形，看着像界面在抽搐。
 *    做法是给未闭合的粗体/斜体/代码块补上收尾再渲染，只影响最后几个字符。
 * 2. **每来一个字就跑一遍完整管线**太贵。用 rAF 合并：一帧最多渲染一次，
 *    肉眼看到的仍是连续增长，CPU 少烧一个数量级。
 *
 * 渲染走的是与「复制为富文本」同一条 unified 管线（见 core/clipboard），
 * 因此这里显示成什么样，复制出去就是什么样。
 */

const props = defineProps<{ source: string }>()

const html = ref('')
let pending = false
let latest = ''

async function render(markdown: string): Promise<void> {
  const { documentHtml } = await import('@/core/clipboard/copy-document')
  // trusted: false —— 这是模型生成的内容，不是用户自己写的。
  // 结果要进 v-html，必须先过白名单剥掉脚本与事件属性
  const rendered = await documentHtml(stabilize(markdown), { trusted: false })

  // 渲染是异步的，回来时可能已经有更新的内容了——丢弃过期结果，
  // 否则画面会在新旧之间跳
  if (latest === markdown) html.value = rendered
}

watch(
  () => props.source,
  (source) => {
    latest = source
    if (!source) {
      html.value = ''
      return
    }
    if (pending) return

    pending = true
    requestAnimationFrame(() => {
      pending = false
      void render(latest)
    })
  },
  { immediate: true },
)
</script>

<template>
  <!--
    v-html 的输入是模型生成的内容，不是可信来源，因此渲染时走了
    `trusted: false` 这条路：管线里接上 rehype-sanitize，
    脚本、事件属性、javascript: 链接都会被白名单剥掉。
    用上游的 sanitize 而不是自己写正则——安全过滤是最不该自建的那类东西。
  -->
  <div class="light-ai-output text-sm leading-relaxed" v-html="html" />
</template>

<style>
/* 与编辑器正文的排版对齐，但更紧凑——面板空间有限 */
.light-ai-output > :first-child {
  margin-top: 0;
}
.light-ai-output > :last-child {
  margin-bottom: 0;
}
.light-ai-output h1,
.light-ai-output h2,
.light-ai-output h3 {
  margin: 0.8em 0 0.4em;
  font-weight: 600;
  line-height: 1.3;
}
.light-ai-output h1 { font-size: 1.25em; }
.light-ai-output h2 { font-size: 1.15em; }
.light-ai-output h3 { font-size: 1.05em; }
.light-ai-output p,
.light-ai-output ul,
.light-ai-output ol,
.light-ai-output blockquote,
.light-ai-output pre {
  margin: 0.5em 0;
}
.light-ai-output ul,
.light-ai-output ol {
  padding-left: 1.4em;
}
.light-ai-output ul { list-style: disc; }
.light-ai-output ol { list-style: decimal; }
.light-ai-output li { margin: 0.15em 0; }
.light-ai-output blockquote {
  border-left: 2px solid var(--border);
  padding-left: 0.8em;
  color: var(--muted-foreground);
}
.light-ai-output code {
  background: var(--muted);
  border-radius: 3px;
  padding: 0.1em 0.3em;
  font-family: var(--light-font-mono);
  font-size: 0.9em;
}
.light-ai-output pre {
  background: var(--muted);
  border-radius: 6px;
  padding: 0.7em 0.9em;
  overflow-x: auto;
}
.light-ai-output pre code {
  background: none;
  padding: 0;
}
.light-ai-output table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.6em 0;
}
.light-ai-output th,
.light-ai-output td {
  border: 1px solid var(--border);
  padding: 0.3em 0.6em;
  text-align: left;
}
.light-ai-output a {
  color: var(--primary);
  text-decoration: underline;
}
.light-ai-output hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 0.8em 0;
}
</style>

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('递归文件树事件契约', () => {
  it('把子级导出事件逐层转发到 FileTree', () => {
    const source = readFileSync(fileURLToPath(new URL('./TreeItem.vue', import.meta.url)), 'utf8')

    // Vue 的组件事件不会像 DOM 事件那样冒泡。少了这条转发，只有根级条目
    // 能导出，文件夹内任意深度的单文件点击导出都会静默无响应。
    expect(source).toContain(`@export="emit('export', $event)"`)
  })
})

// @vitest-environment jsdom
import { editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createLightEditor } from '../create-editor'
import { SLASH_ITEMS, filterSlashItems } from './items'

/**
 * 逐条执行斜杠命令的回归测试。
 *
 * 起因是一个只在运行时暴露的缺陷：`$command` 的 `plugin.key` 直到插件被 use 后
 * 才赋值，因此在模块顶层提前读取 `cmd.key` 会固化成 undefined，
 * 点击时才报 `Cannot read properties of undefined (reading 'id')`。
 * 类型检查与「菜单能弹出」都发现不了，只有真的把每一条都执行一遍才能拦住。
 */

const editors: Array<{ destroy: () => void }> = []

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy()
})

async function runItems(ids: string[], initial = '文字'): Promise<{ markdown: string; nodes: string[] }> {
  const root = document.createElement('div')
  document.body.append(root)

  const editor = await createLightEditor({ root, defaultValue: initial }).create()
  editors.push({ destroy: () => void editor.destroy() })

  for (const id of ids) {
    const item = SLASH_ITEMS.find((candidate) => candidate.id === id)
    if (!item) throw new Error(`未知的斜杠命令：${id}`)

    editor.action((ctx: Ctx) => {
      // 命令作用于光标所在块，先把光标放进正文
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    })
    editor.action((ctx: Ctx) => item.run(ctx))
  }

  return editor.action((ctx: Ctx) => {
    const view = ctx.get(editorViewCtx)
    const nodes = new Set<string>()
    view.state.doc.descendants((node) => {
      nodes.add(node.type.name)
      return true
    })
    return { markdown: ctx.get(serializerCtx)(view.state.doc), nodes: [...nodes] }
  })
}

describe('每条斜杠命令都能真正执行', () => {
  // 覆盖全部条目：新增命令若忘了走 command() 的运行时取值，这里会直接失败
  for (const item of SLASH_ITEMS) {
    it(`${item.label}（${item.id}）执行后不抛错`, async () => {
      await expect(runItems([item.id])).resolves.toBeDefined()
    })
  }
})

describe('斜杠命令的产出结构', () => {
  const cases: Array<[string, string, string]> = [
    ['一级标题', 'h1', '# 文字'],
    ['二级标题', 'h2', '## 文字'],
    ['三级标题', 'h3', '### 文字'],
    ['引用', 'blockquote', '> 文字'],
  ]

  for (const [name, id, expected] of cases) {
    it(name, async () => {
      const { markdown } = await runItems([id])
      expect(markdown.trim()).toBe(expected)
    })
  }

  it('无序列表', async () => {
    const { nodes } = await runItems(['bullet-list'])
    expect(nodes).toContain('bullet_list')
  })

  it('有序列表', async () => {
    const { nodes } = await runItems(['ordered-list'])
    expect(nodes).toContain('ordered_list')
  })

  it('待办事项产出可勾选的任务项', async () => {
    const { markdown } = await runItems(['task-list'])
    expect(markdown).toContain('[ ]')
  })

  it('代码块', async () => {
    const { nodes } = await runItems(['code-block'])
    expect(nodes).toContain('code_block')
  })

  it('表格', async () => {
    const { nodes } = await runItems(['table'])
    expect(nodes).toContain('table')
  })

  it('分割线', async () => {
    const { nodes } = await runItems(['hr'])
    expect(nodes).toContain('hr')
  })

  it('正文把标题转回普通段落', async () => {
    const { markdown } = await runItems(['h1', 'text'])
    expect(markdown.trim()).toBe('文字')
  })
})

describe('filterSlashItems', () => {
  it('空查询返回全部', () => {
    expect(filterSlashItems('')).toHaveLength(SLASH_ITEMS.length)
  })

  it('按中文标签匹配', () => {
    expect(filterSlashItems('标题').map((item) => item.id)).toEqual(['h1', 'h2', 'h3'])
  })

  it('按英文关键词匹配', () => {
    expect(filterSlashItems('table').map((item) => item.id)).toEqual(['table'])
  })

  it('按拼音首字母匹配', () => {
    expect(filterSlashItems('bt').map((item) => item.id)).toEqual(['h1', 'h2', 'h3'])
  })

  it('无匹配时返回空', () => {
    expect(filterSlashItems('zzzz')).toEqual([])
  })
})

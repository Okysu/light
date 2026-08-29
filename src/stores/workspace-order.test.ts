// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { SIDEBAR_ORDER_PATH } from '@/core/workspace/sidebar-order'
import { findNode } from '@/core/workspace/tree'
import { useWorkspaceStore } from './workspace'

describe('workspace 侧边栏排序编排', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('同级排序落盘并在重新扫描后保持', async () => {
    const workspace = useWorkspaceStore()
    await workspace.open({ kind: 'memory' })
    const a = await workspace.createNote('', '甲')
    const b = await workspace.createNote('', '乙')
    const c = await workspace.createNote('', '丙')

    await workspace.reorder(c, a, 'before')
    const ordered = workspace.tree.map((node) => node.path)
    expect(ordered.indexOf(c)).toBeLessThan(ordered.indexOf(a))
    expect(ordered.indexOf(a)).toBeLessThan(ordered.indexOf(b))
    expect(JSON.parse(await workspace.storage!.readText(SIDEBAR_ORDER_PATH))).toMatchObject({ version: 1 })

    await workspace.refresh()
    expect(workspace.tree.map((node) => node.path)).toEqual(ordered)
  })

  it('拖到另一目录的兄弟旁边会同时移动并定位', async () => {
    const workspace = useWorkspaceStore()
    await workspace.open({ kind: 'memory' })
    const folder = await workspace.createFolder('', '项目')
    const target = await workspace.createNote(folder, '目标')
    const source = await workspace.createNote('', '来源')

    const next = await workspace.reorder(source, target, 'before')

    expect(next).toBe('项目/来源.md')
    expect(findNode(workspace.tree, folder)?.children?.map((node) => node.path)).toEqual([
      '项目/来源.md',
      '项目/目标.md',
    ])
    expect(await workspace.storage!.exists(source)).toBe(false)
  })

  it('拖回所在目录时保持原路径且不制造同名副本', async () => {
    const workspace = useWorkspaceStore()
    await workspace.open({ kind: 'memory' })
    const folder = await workspace.createFolder('', '项目')
    const source = await workspace.createNote(folder, '来源')

    expect(await workspace.move(source, folder)).toBe(source)
    expect(await workspace.storage!.exists(source)).toBe(true)
    expect(await workspace.storage!.exists('项目/来源 (2).md')).toBe(false)
  })

  it('已排序条目改名后仍留在原位置', async () => {
    const workspace = useWorkspaceStore()
    await workspace.open({ kind: 'memory' })
    const a = await workspace.createNote('', '甲')
    const b = await workspace.createNote('', '乙')
    await workspace.reorder(b, a, 'before')

    const renamed = await workspace.rename(b, '重命名')

    expect(workspace.tree.map((node) => node.path)).toEqual([renamed, a])
  })
})

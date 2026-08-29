// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCollectionsStore } from './collections'
import { useEditorStore } from './editor'
import { useWorkspaceStore } from './workspace'

describe('collections store 的失效路径清理', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('移入回收站并刷新后，最近访问不再保留该文件', async () => {
    const workspace = useWorkspaceStore()
    const collections = useCollectionsStore()
    await workspace.open({ kind: 'memory' })
    const path = await workspace.createNote('', '临时笔记')

    collections.markVisited(path)
    await collections.refresh()
    expect(collections.recentlyVisited).toContain(path)

    await workspace.moveToTrash(path)
    await collections.refresh()

    expect(collections.visited).not.toContain(path)
    expect(collections.recentlyVisited).not.toContain(path)
  })

  it('空工作区不会放行旧目录的最近访问记录', async () => {
    const workspace = useWorkspaceStore()
    const collections = useCollectionsStore()
    collections.visited = ['旧目录.md']

    await workspace.open({ kind: 'memory' })
    await collections.refresh()

    expect(collections.recentlyVisited).toEqual([])
    expect(collections.visited).toEqual([])
  })

  it('选择父标签分组会筛出直接标签和全部后代标签', async () => {
    const workspace = useWorkspaceStore()
    const collections = useCollectionsStore()
    await workspace.open({ kind: 'memory' })
    const root = await workspace.createNote('', '根标签')
    const sync = await workspace.createNote('', '同步')
    const editor = await workspace.createNote('', '编辑器')
    const life = await workspace.createNote('', '生活')

    await workspace.notes!.write(root, { tags: ['工作'] })
    await workspace.notes!.write(sync, { tags: ['工作/Light/同步'] })
    await workspace.notes!.write(editor, { tags: ['工作/Light/编辑器'] })
    await workspace.notes!.write(life, { tags: ['生活'] })
    await collections.refresh()

    collections.toggleTag('工作')
    expect([...collections.filteredPaths!].sort()).toEqual([editor, root, sync].sort())
    expect(collections.tagTree[0]?.children[0]?.tag).toBe('工作/Light')
  })

  it('当前标签从磁盘消失后自动清除无效筛选', async () => {
    const workspace = useWorkspaceStore()
    const collections = useCollectionsStore()
    await workspace.open({ kind: 'memory' })
    const note = await workspace.createNote('', '临时标签')
    await workspace.notes!.write(note, { tags: ['临时/分组'] })
    await collections.refresh()
    collections.toggleTag('临时')

    await workspace.notes!.write(note, { tags: [] })
    await collections.refresh()

    expect(collections.activeTag).toBeNull()
    expect(collections.filteredPaths).toBeNull()
  })

  it('通过编辑器属性修改标签后立即刷新侧边栏层级', async () => {
    const workspace = useWorkspaceStore()
    const collections = useCollectionsStore()
    const editor = useEditorStore()
    await workspace.open({ kind: 'memory' })
    const note = await workspace.createNote('', '属性标签')
    await editor.openNote(note)

    await editor.setProperty('tags', ['工作/Light/同步'])

    expect(collections.tagTree[0]?.tag).toBe('工作')
    expect(collections.tagTree[0]?.children[0]?.tag).toBe('工作/Light')
    expect(collections.tagTree[0]?.children[0]?.children[0]?.tag).toBe('工作/Light/同步')
  })
})

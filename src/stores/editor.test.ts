// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { watch } from 'vue'
import { useEditorStore } from './editor'
import { useWorkspaceStore } from './workspace'

/**
 * 编辑器 store 的时序不变量。
 *
 * 这里测的不是「功能对不对」，而是**状态什么时候变**——因为界面靠
 * `activePath` 驱动编辑器重建，它一旦早于内容更新，编辑器就会拿上一篇的
 * 正文建起来，而用户随后敲的每一个字都会把那份旧正文写进新笔记。
 */
describe('editor store 的打开时序', () => {
  let editor: ReturnType<typeof useEditorStore>
  let workspace: ReturnType<typeof useWorkspaceStore>

  beforeEach(async () => {
    localStorage.clear()
    setActivePinia(createPinia())
    workspace = useWorkspaceStore()
    editor = useEditorStore()

    await workspace.open({ kind: 'memory' })
    await workspace.notes!.create('', '甲', 'note', '甲的正文')
    await workspace.notes!.create('', '乙', 'note', '乙的正文')
    await workspace.refresh()
  })

  it('打开后 draft 是这篇笔记的正文', async () => {
    await editor.openNote('甲.md')
    expect(editor.draft).toContain('甲的正文')
    expect(editor.activePath).toBe('甲.md')
  })

  it('分屏返回所见即所得时只递增视图版本，不改写 Markdown', async () => {
    await editor.openNote('甲.md')
    editor.updateContent('## 分屏正文\n\n- 保留源码')
    const before = editor.contentRevision

    editor.rebuildContentView()

    expect(editor.contentRevision).toBe(before + 1)
    expect(editor.draft).toBe('## 分屏正文\n\n- 保留源码')
  })

  /**
   * 核心不变量：`activePath` 每次变化时，`draft` 必须已经是那一篇的内容。
   *
   * 曾经把 activePath 提前到 `await read()` 之前赋值，于是切换笔记时
   * 编辑器用上一篇的正文重建——界面显示与字数统计对不上只是表象，
   * 真正的后果是用户在那个错的编辑器里一敲键，旧正文就被写进了新笔记。
   */
  it('activePath 变化的那一刻，draft 已经是对应笔记的内容', async () => {
    await editor.openNote('甲.md')

    const observed: Array<{ path: string | null; draft: string }> = []
    watch(
      () => editor.activePath,
      (path) => observed.push({ path, draft: editor.draft }),
      { flush: 'sync' },
    )

    await editor.openNote('乙.md')

    expect(observed).toHaveLength(1)
    expect(observed[0]?.path).toBe('乙.md')
    // 若时序错了，这里拿到的会是「甲的正文」
    expect(observed[0]?.draft).toContain('乙的正文')
    expect(observed[0]?.draft).not.toContain('甲的正文')
  })

  it('切换笔记后字数与正文来自同一篇', async () => {
    await editor.openNote('甲.md')
    await editor.openNote('乙.md')

    expect(editor.draft).toContain('乙的正文')
    // 字数由 fullContent 推导，与 draft 必须同源
    expect(editor.wordCount).toBeGreaterThan(0)
    expect(editor.note?.path).toBe('乙.md')
  })

  /**
   * 删掉一个文件再新建同名的，路径一样但内容已是另一份。
   * 只比路径就短路的话，下一次自动保存会把旧内容写回新文件。
   */
  it('同名文件被重建后重新读取，而不是复用内存里的旧内容', async () => {
    await editor.openNote('甲.md')
    expect(editor.draft).toContain('甲的正文')

    await workspace.storage!.remove('甲.md')
    await workspace.notes!.create('', '甲', 'note', '换了一份全新的内容')
    await workspace.refresh()

    await editor.openNote('甲.md')
    expect(editor.draft).toContain('换了一份全新的内容')
    expect(editor.draft).not.toContain('甲的正文')
  })

  it('正在编辑时重复打开同一篇不会丢掉未保存的改动', async () => {
    await editor.openNote('甲.md')
    editor.updateContent('正在写的内容')
    expect(editor.dirty).toBe(true)

    await editor.openNote('甲.md')
    expect(editor.draft).toBe('正在写的内容')
  })

  /** 看板与画板不是 Markdown，编辑器只记路径，不该留着上一篇的正文 */
  it('打开看板时清空笔记状态', async () => {
    await editor.openNote('甲.md')
    await workspace.createNote('', '看板', 'board')
    await editor.openNote('看板.board')

    expect(editor.activePath).toBe('看板.board')
    expect(editor.activeKind).toBe('board')
    expect(editor.note).toBeNull()
    expect(editor.draft).toBe('')
  })

  it('不存在的路径不会创建标签页，并给出可见错误', async () => {
    const opened = await editor.openNote('已经删除.md')

    expect(opened).toBe(false)
    expect(editor.tabs).not.toContain('已经删除.md')
    expect(editor.activePath).toBeNull()
    expect(editor.loadError).toContain('文件不存在或已被移动')
    expect(workspace.error).toContain('已经删除.md')
  })

  it('切换到新数据目录后清理旧目录的标签和活动文档', async () => {
    workspace.onBeforeOpen(editor.flush)
    workspace.onOpened(editor.reconcileTabs)
    await editor.openNote('甲.md')

    await workspace.open({ kind: 'memory' })

    expect(workspace.tree).toEqual([])
    expect(editor.tabs).toEqual([])
    expect(editor.activePath).toBeNull()
    expect(await workspace.storage!.exists('.light/workspace.json')).toBe(true)
    expect(await workspace.storage!.exists('attachments')).toBe(true)
  })
})

describe('editor store 的写入安全', () => {
  let editor: ReturnType<typeof useEditorStore>
  let workspace: ReturnType<typeof useWorkspaceStore>

  beforeEach(async () => {
    localStorage.clear()
    setActivePinia(createPinia())
    workspace = useWorkspaceStore()
    editor = useEditorStore()

    await workspace.open({ kind: 'memory' })
    await workspace.notes!.create('', '甲', 'note', '甲的正文')
    await workspace.notes!.create('', '乙', 'note', '乙的正文')
    await workspace.refresh()
  })

  /**
   * 切换笔记时，上一篇的改动必须落到**上一篇的文件**里。
   * 写错文件比不写更糟：用户会发现另一篇笔记莫名其妙多了段内容。
   */
  it('切换前的改动写进原来那篇，不会污染新打开的笔记', async () => {
    await editor.openNote('甲.md')
    editor.updateContent('甲被改过了')

    await editor.openNote('乙.md')

    expect(await workspace.storage!.readText('甲.md')).toContain('甲被改过了')
    expect(await workspace.storage!.readText('乙.md')).not.toContain('甲被改过了')
    expect(editor.draft).toContain('乙的正文')
  })

  it('flush 之后内容确实在磁盘上', async () => {
    await editor.openNote('甲.md')
    editor.updateContent('立刻落盘的内容')
    await editor.flush()

    expect(await workspace.storage!.readText('甲.md')).toContain('立刻落盘的内容')
    expect(editor.dirty).toBe(false)
  })

  it('自动保存前记录将被覆盖的上一版', async () => {
    await editor.openNote('甲.md')
    const original = editor.note!.content
    editor.updateContent('第二版正文')
    await editor.flush()

    const entries = await workspace.history!.list(editor.note!.id)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.reason).toBe('auto')
    expect((await workspace.history!.read(editor.note!.id, entries[0]!.id)).content).toBe(original)
    expect(await workspace.storage!.readText('甲.md')).toContain('第二版正文')
  })

  it('恢复旧版前备份当前内容，并让同路径编辑器修订号变化', async () => {
    await editor.openNote('甲.md')
    editor.updateContent('第二版正文')
    await editor.flush()
    const oldEntry = (await workspace.history!.list(editor.note!.id))[0]!

    editor.updateContent('第三版正文')
    await editor.flush()
    const revisionBefore = editor.contentRevision
    await editor.restoreHistoryVersion(oldEntry.id)

    expect(editor.draft).toContain('甲的正文')
    expect(editor.draft).not.toContain('第三版正文')
    expect(editor.contentRevision).toBe(revisionBefore + 1)
    const entries = await workspace.history!.list(editor.note!.id)
    const backup = entries.find((entry) => entry.reason === 'before-restore')!
    expect((await workspace.history!.read(editor.note!.id, backup.id)).content).toContain('第三版正文')
  })

  it('历史索引损坏不阻断正文保存，但会暴露历史错误', async () => {
    await editor.openNote('甲.md')
    editor.updateContent('第二版正文')
    await editor.flush()
    const historyRoot = (await workspace.storage!.list('.light/history/v1'))[0]!.path
    await workspace.storage!.writeText(`${historyRoot}/index.json`, '{broken')

    editor.updateContent('历史坏了也要保存正文')
    await editor.flush()

    expect(await workspace.storage!.readText('甲.md')).toContain('历史坏了也要保存正文')
    expect(editor.historyError).toContain('索引损坏')
  })

  it('移入回收站后清理标签不会把原路径重新创建', async () => {
    await editor.openNote('甲.md')
    editor.updateContent('删除前最后一次保存')
    await editor.flush()

    await workspace.moveToTrash('甲.md')
    await editor.forgetTab('甲.md')

    expect(await workspace.storage!.exists('甲.md')).toBe(false)
    expect(editor.tabs).not.toContain('甲.md')
    expect(editor.activePath).toBeNull()
  })
})

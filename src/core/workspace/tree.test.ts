import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { findNode, flattenTree, kindOf, scanTree } from './tree'

describe('kindOf', () => {
  it('按扩展名判定类型，大小写不敏感', () => {
    expect(kindOf('a.md')).toBe('note')
    expect(kindOf('a.MD')).toBe('note')
    expect(kindOf('a.board')).toBe('board')
    expect(kindOf('a.canvas')).toBe('canvas')
    expect(kindOf('a.png')).toBeNull()
  })
})

describe('scanTree', () => {
  let fs: MemoryAdapter

  beforeEach(() => {
    fs = new MemoryAdapter()
  })

  it('树完全由磁盘现状推导，外部放入的 md 直接出现', async () => {
    await fs.writeText('notes/手动放入.md', '')
    const tree = await scanTree(fs)
    expect(findNode(tree, 'notes/手动放入.md')).toMatchObject({ kind: 'note', name: '手动放入' })
  })

  it('过滤 .light 等元数据目录与非笔记文件', async () => {
    await fs.writeText('.light/workspace.json', '{}')
    await fs.writeText('.obsidian/app.json', '{}')
    await fs.writeText('attachments/图片.png', '')
    await fs.writeText('a.md', '')

    const paths = flattenTree(await scanTree(fs)).map((node) => node.path)
    expect(paths).toContain('a.md')
    expect(paths).toContain('attachments') // 目录本身保留，仅过滤非笔记文件
    expect(paths).not.toContain('attachments/图片.png')
    expect(paths.some((path) => path.startsWith('.light'))).toBe(false)
    expect(paths.some((path) => path.startsWith('.obsidian'))).toBe(false)
  })

  it('目录排在文件前，同类按中文本地化顺序', async () => {
    await fs.writeText('b.md', '')
    await fs.writeText('a.md', '')
    await fs.mkdir('z目录')

    expect((await scanTree(fs)).map((node) => node.name)).toEqual(['z目录', 'a', 'b'])
  })

  it('maxDepth 截断异常深的结构，防止递归失控', async () => {
    await fs.writeText('a/b/c/d.md', '')
    const tree = await scanTree(fs, '', { maxDepth: 2 })
    expect(findNode(tree, 'a/b')).not.toBeNull()
    expect(findNode(tree, 'a/b/c')).toBeNull()
  })
})

describe('排除目录', () => {
  it('附件目录不进文档树——它有自己的管理面板', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText('笔记.md', '正文')
    await fs.writeBinary('attachments/图.png', new Uint8Array([1]))

    const tree = await scanTree(fs, '', { exclude: ['attachments'] })

    expect(tree.map((node) => node.name)).toEqual(['笔记'])
  })

  it('嵌套的附件目录同样排除', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText('资源/说明.md', '正文')
    await fs.writeBinary('资源/文件/图.png', new Uint8Array([1]))

    const tree = await scanTree(fs, '', { exclude: ['资源/文件'] })
    const 资源 = tree.find((node) => node.name === '资源')

    expect(资源?.children?.map((node) => node.name)).toEqual(['说明'])
  })

  it('排除项是空串时不会把整棵树排干净', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText('目录/笔记.md', '正文')

    // 调用方传入空排除项时也不能让文件树彻底空掉
    const tree = await scanTree(fs, '', { exclude: [''] })

    expect(tree).toHaveLength(1)
  })

  it('排除只作用于展示，不传时一切照旧', async () => {
    const fs = new MemoryAdapter()
    await fs.writeText('attachments/其实是笔记.md', '正文')

    const tree = await scanTree(fs)

    expect(tree[0]?.children?.[0]?.name).toBe('其实是笔记')
  })
})

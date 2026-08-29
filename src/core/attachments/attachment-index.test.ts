import { describe, expect, it } from 'vitest'
import { buildAttachmentIndex, extractAssetRefs } from './attachment-index'

describe('extractAssetRefs', () => {
  it('提取 Markdown 图片', () => {
    expect(extractAssetRefs('![图](attachments/a.png)')).toEqual(['attachments/a.png'])
  })

  it('普通链接指向工作区内文件时也算引用', () => {
    expect(extractAssetRefs('[附件](attachments/报告.pdf)')).toEqual(['attachments/报告.pdf'])
  })

  /**
   * 从别处粘贴过来的内容常常是原始 HTML。
   * 只认 Markdown 语法的话，那些图片会被误判成「没人引用」，
   * 按提示删掉之后笔记里就是一片裂图。
   */
  it('原始 HTML 的 src 同样认', () => {
    expect(extractAssetRefs('<img src="attachments/b.png" alt="x">')).toEqual(['attachments/b.png'])
    expect(extractAssetRefs('<video src="attachments/c.mp4"></video>')).toEqual(['attachments/c.mp4'])
    expect(extractAssetRefs('<audio controls src="attachments/d.mp3"></audio>')).toEqual(['attachments/d.mp3'])
  })

  it('外部链接不算', () => {
    expect(extractAssetRefs('![](https://x.com/a.png) ![](data:image/png;base64,xx)')).toEqual([])
  })

  it('代码块里的引用不算', () => {
    const markdown = ['![真的](attachments/a.png)', '```', '![假的](attachments/b.png)', '```'].join('\n')
    expect(extractAssetRefs(markdown)).toEqual(['attachments/a.png'])
  })

  it('一行里的多个引用都提取', () => {
    expect(extractAssetRefs('![](a.png) 与 ![](b.png)')).toEqual(['a.png', 'b.png'])
  })

  it('没有引用时返回空', () => {
    expect(extractAssetRefs('普通文字')).toEqual([])
  })
})

describe('buildAttachmentIndex', () => {
  const SOURCES = [
    { path: '笔记.md', content: '![](attachments/a.png)' },
    { path: '项目/计划.md', content: '![](../attachments/a.png) 与 ![](../attachments/b.png)' },
    { path: '空的.md', content: '什么也没有' },
  ]
  const ATTACHMENTS = ['attachments/a.png', 'attachments/b.png', 'attachments/没人用.png']

  it('标注每个附件的引用来源', () => {
    const index = buildAttachmentIndex(SOURCES, ATTACHMENTS)
    const a = index.items.find((item) => item.path === 'attachments/a.png')
    expect(a?.usedBy).toEqual(['笔记.md', '项目/计划.md'])
  })

  /** 子目录里的笔记用 `../` 引用，解析不对就会把它算成另一个附件 */
  it('跨目录的相对引用被解析到同一个附件', () => {
    const index = buildAttachmentIndex(SOURCES, ATTACHMENTS)
    expect(index.items.find((item) => item.path === 'attachments/b.png')?.usedBy).toEqual(['项目/计划.md'])
  })

  it('找出孤立附件', () => {
    expect(buildAttachmentIndex(SOURCES, ATTACHMENTS).orphans).toEqual(['attachments/没人用.png'])
  })

  it('同一篇里重复引用只记一次来源', () => {
    const index = buildAttachmentIndex(
      [{ path: 'a.md', content: '![](x.png) 又 ![](x.png)' }],
      ['x.png'],
    )
    expect(index.items[0]?.usedBy).toEqual(['a.md'])
  })

  it('没有附件时产出空索引', () => {
    expect(buildAttachmentIndex(SOURCES, [])).toEqual({ items: [], orphans: [] })
  })

  it('引用了不存在的文件不会凭空造出附件条目', () => {
    const index = buildAttachmentIndex([{ path: 'a.md', content: '![](attachments/幽灵.png)' }], ['x.png'])
    expect(index.items.map((item) => item.path)).toEqual(['x.png'])
  })
})

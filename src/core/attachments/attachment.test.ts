import { describe, expect, it } from 'vitest'
import {
  attachmentFileName,
  attachmentHref,
  embeddableKind,
  extensionForMime,
  isImageMime,
  isInternalAttachment,
  resolveAttachmentPath,
} from './attachment'

describe('extensionForMime', () => {
  it('常见图片类型', () => {
    expect(extensionForMime('image/png')).toBe('png')
    expect(extensionForMime('image/jpeg')).toBe('jpg')
    expect(extensionForMime('image/svg+xml')).toBe('svg')
  })

  it('大小写不敏感', () => {
    expect(extensionForMime('IMAGE/PNG')).toBe('png')
  })

  it('未知类型有兜底', () => {
    expect(extensionForMime('application/octet-stream')).toBe('bin')
  })
})

describe('isImageMime', () => {
  it('识别图片', () => {
    expect(isImageMime('image/png')).toBe(true)
    expect(isImageMime('text/plain')).toBe(false)
  })
})

describe('embeddableKind', () => {
  it('识别图片、音频与视频 MIME', () => {
    expect(embeddableKind('image/png', 'a.png')).toBe('image')
    expect(embeddableKind('audio/mpeg', 'a.mp3')).toBe('audio')
    expect(embeddableKind('video/mp4', 'a.mp4')).toBe('video')
  })

  it('系统未提供 MIME 时按扩展名识别音视频', () => {
    expect(embeddableKind('', '录音.M4A')).toBe('audio')
    expect(embeddableKind('', '演示.webm')).toBe('video')
  })

  it('不把普通文件误当作可嵌入媒体', () => {
    expect(embeddableKind('application/pdf', '报告.pdf')).toBeNull()
  })
})

describe('attachmentFileName', () => {
  const at = new Date(2026, 7, 29, 14, 5, 9)

  it('剪贴板图片用「粘贴-时间戳」命名', () => {
    expect(attachmentFileName('image/png', at, new Set())).toBe('粘贴-20260829140509.png')
  })

  it('有原名时保留它——拖入的文件名通常是有意义的', () => {
    expect(attachmentFileName('image/png', at, new Set(), '架构图.png')).toBe('架构图.png')
  })

  /** 覆盖用户已有的附件是最不该发生的事 */
  it('冲突时追加序号而不是覆盖', () => {
    const taken = new Set(['架构图.png', '架构图-2.png'])
    expect(attachmentFileName('image/png', at, taken, '架构图.png')).toBe('架构图-3.png')
  })

  it('原名的扩展名优先于 MIME 推断', () => {
    expect(attachmentFileName('application/octet-stream', at, new Set(), '图.webp')).toBe('图.webp')
  })

  it('清洗原名里的非法字符', () => {
    expect(attachmentFileName('image/png', at, new Set(), 'a/b:c.png')).toBe('a_b_c.png')
  })

  it('原名只有扩展名时有兜底', () => {
    expect(attachmentFileName('image/png', at, new Set(), '.png')).toBe('附件.png')
  })
})

describe('isInternalAttachment', () => {
  it('相对路径算内部', () => {
    expect(isInternalAttachment('attachments/图.png')).toBe(true)
    expect(isInternalAttachment('../图.png')).toBe(true)
  })

  /** 外部链接是用户自己写的，我们没有理由改写它 */
  it('外部链接一律不算', () => {
    for (const src of ['https://x.com/a.png', 'http://x/a.png', 'data:image/png;base64,xx', 'file:///c:/a.png', '//cdn/a.png']) {
      expect(isInternalAttachment(src)).toBe(false)
    }
  })

  it('站内绝对路径不算——工作区里没有这个概念', () => {
    expect(isInternalAttachment('/attachments/图.png')).toBe(false)
  })

  it('空串不算', () => {
    expect(isInternalAttachment('')).toBe(false)
  })
})

describe('resolveAttachmentPath', () => {
  it('根目录的笔记', () => {
    expect(resolveAttachmentPath('attachments/图.png', '笔记.md')).toBe('attachments/图.png')
  })

  /** 写死成从根目录找，会让子目录里的笔记全部断链 */
  it('子目录的笔记按相对位置解析', () => {
    expect(resolveAttachmentPath('图.png', '项目/笔记.md')).toBe('项目/图.png')
  })

  it('处理 ..', () => {
    expect(resolveAttachmentPath('../attachments/图.png', '项目/笔记.md')).toBe('attachments/图.png')
  })

  it('处理 ./', () => {
    expect(resolveAttachmentPath('./图.png', '项目/笔记.md')).toBe('项目/图.png')
  })

  it('百分号编码会被还原', () => {
    expect(resolveAttachmentPath('attachments/%E5%9B%BE.png', '笔记.md')).toBe('attachments/图.png')
  })

  it('坏的编码不抛错', () => {
    expect(resolveAttachmentPath('attachments/%E5%9B.png', '笔记.md')).toContain('attachments/')
  })
})

describe('attachmentHref', () => {
  it('根目录的笔记直接用路径', () => {
    expect(attachmentHref('attachments/图.png', '笔记.md')).toBe('attachments/%E5%9B%BE.png')
  })

  it('子目录的笔记退回上级', () => {
    expect(attachmentHref('attachments/a.png', '项目/笔记.md')).toBe('../attachments/a.png')
  })

  it('深层目录退回多级', () => {
    expect(attachmentHref('attachments/a.png', '项目/归档/笔记.md')).toBe('../../attachments/a.png')
  })

  /** 空格不编码会把 Markdown 链接截断 */
  it('空格与中文都会被编码', () => {
    expect(attachmentHref('attachments/我 的图.png', '笔记.md')).toBe('attachments/%E6%88%91%20%E7%9A%84%E5%9B%BE.png')
  })

  /** 往返自洽：生成的链接必须能解析回原路径 */
  it('生成的链接能被 resolveAttachmentPath 解析回同一个文件', () => {
    for (const note of ['笔记.md', '项目/笔记.md', '项目/归档/笔记.md']) {
      const href = attachmentHref('attachments/我 的图.png', note)
      expect(resolveAttachmentPath(href, note)).toBe('attachments/我 的图.png')
    }
  })
})

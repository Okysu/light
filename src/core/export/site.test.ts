import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { buildSite } from './site'

describe('静态站点导出', () => {
  it('保留任意扩展名和嵌套目录的附件', async () => {
    const storage = new MemoryAdapter()
    await storage.writeText('笔记.md', '# 笔记\n\n![图](attachments/图片.png)')
    await storage.writeBinary('attachments/图片.png', new Uint8Array([1, 2, 3]))
    await storage.writeBinary('attachments/media/声音.mp3', new Uint8Array([4, 5]))
    const site = await buildSite(storage, 'Light')
    const paths = site.entries.map((entry) => entry.path)
    expect(paths).toContain('attachments/图片.png')
    expect(paths).toContain('attachments/media/声音.mp3')
  })

  it('公式使用离线 MathML 层，不依赖远端字体', async () => {
    const storage = new MemoryAdapter()
    await storage.writeText('公式.md', '# 公式\n\n$$E=mc^2$$')
    const site = await buildSite(storage, 'Light')
    const page = site.entries.find((entry) => entry.path === '公式.html')!
    const css = new TextDecoder().decode(site.entries.find((entry) => entry.path === 'style.css')!.data)
    expect(new TextDecoder().decode(page.data)).toContain('katex-mathml')
    expect(css).toContain('.katex .katex-html { display: none; }')
  })
})

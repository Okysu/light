// @vitest-environment jsdom
import { editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { AllSelection } from '@milkdown/kit/prose/state'
import { undo } from '@milkdown/kit/prose/history'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLightEditor } from '../create-editor'
import { insertAttachmentFiles, type AttachmentBridge } from './attachment'

const editors: Array<{ destroy: () => Promise<unknown> }> = []

afterEach(async () => {
  while (editors.length > 0) await editors.pop()?.destroy()
  vi.unstubAllGlobals()
})

describe('粘贴网络图片本地化', () => {
  beforeEach(() => {
    // jsdom 未实现 ClipboardEvent；仍使用真实的 ProseMirror pasteHTML 管道。
    vi.stubGlobal('ClipboardEvent', class extends Event { clipboardData = null })
  })
  async function setup(overrides: Partial<AttachmentBridge> = {}, markdown = '') {
    const bridge: AttachmentBridge = {
      save: vi.fn(), resolve: async () => null, release: vi.fn(),
      shouldLocalizeRemoteImages: () => true,
      importRemoteImage: vi.fn(async () => 'attachments/local.png'),
      onRemoteImageImported: vi.fn(), onRemoteImageError: vi.fn(),
      ...overrides,
    }
    const root = document.createElement('div')
    document.body.append(root)
    const onUpdated = vi.fn()
    const editor = await createLightEditor({ root, defaultValue: markdown, attachments: bridge, onMarkdownUpdated: onUpdated }).create()
    editors.push({ destroy: () => editor.destroy() })
    const view = editor.action((ctx) => ctx.get(editorViewCtx)) as EditorView
    const source = () => editor.action((ctx) => ctx.get(serializerCtx)(view.state.doc)) as string
    return { bridge, editor, view, source, onUpdated }
  }

  it('真实粘贴入口下载图片并更新引用，保留混合富文本的结构与图片属性', async () => {
    const { view, bridge, source, onUpdated } = await setup()
    view.pasteHTML('<h2>标题</h2><p><strong>粗体</strong><img src="https://cdn.example/a.png" alt="图片说明" title="标题说明"></p>')
    await vi.waitFor(() => expect(source()).toContain('attachments/local.png'))
    expect(bridge.importRemoteImage).toHaveBeenCalledWith('https://cdn.example/a.png', expect.any(AbortSignal))
    expect(source()).toContain('## 标题')
    expect(source()).toContain('**粗体**')
    expect(source()).toContain('![图片说明](attachments/local.png "标题说明")')
    expect(bridge.onRemoteImageImported).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(onUpdated).toHaveBeenLastCalledWith(source()))
  })

  it('慢速下载在原外链已通知保存后，仍再次通知保存本地引用', async () => {
    let finish!: (href: string) => void
    const { view, source, onUpdated } = await setup({ importRemoteImage: () => new Promise((resolve) => { finish = resolve }) })
    view.pasteHTML('<p><img src="https://cdn.example/slow.png"></p>')
    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.stringContaining('https://cdn.example/slow.png')))
    finish('attachments/slow.png')
    await vi.waitFor(() => expect(onUpdated).toHaveBeenLastCalledWith(expect.stringContaining('attachments/slow.png')))
    expect(onUpdated).toHaveBeenLastCalledWith(source())
  })

  it('关闭选项时保留外链，修改偏好立即作用于下一次粘贴', async () => {
    let enabled = false
    const { view, bridge, source } = await setup({ shouldLocalizeRemoteImages: () => enabled })
    view.pasteHTML('<p><img src="https://cdn.example/a.png"></p>')
    await Promise.resolve()
    expect(bridge.importRemoteImage).not.toHaveBeenCalled()
    expect(source()).toContain('https://cdn.example/a.png')
    enabled = true
    view.pasteHTML('<p><img src="https://cdn.example/b.png"></p>')
    await vi.waitFor(() => expect(bridge.importRemoteImage).toHaveBeenCalledOnce())
  })

  it('纯 Markdown 剪贴板解析后的图片同样下载并通知保存', async () => {
    const { view, source, onUpdated, bridge } = await setup()
    const markdown = '![Markdown 图片](https://cdn.example/markdown.png)'
    const event = new Event('paste') as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: {
      files: [], getData: (type: string) => type === 'text/plain' ? markdown : '',
    } })
    view.pasteText(markdown, event)
    await vi.waitFor(() => expect(source()).toContain('attachments/local.png'))
    expect(bridge.importRemoteImage).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(onUpdated).toHaveBeenLastCalledWith(source()))
  })

  it('同一粘贴内相同 URL 只下载一次，不改写文档中原有的同名外链', async () => {
    const { view, bridge, source } = await setup({}, '![原图](https://cdn.example/a.png)\n\n正文')
    view.pasteHTML('<p><img src="https://cdn.example/a.png" alt="图一"><img src="https://cdn.example/a.png" alt="图二"></p>')
    await vi.waitFor(() => expect(source()).toContain('![图二](attachments/local.png "图二")'))
    expect(source()).toContain('![原图](https://cdn.example/a.png)')
    expect(source()).toContain('![图一](attachments/local.png "图一")')
    expect(bridge.importRemoteImage).toHaveBeenCalledOnce()
  })

  it('下载期间输入文字后仍更新正确的节点', async () => {
    let finish!: (href: string) => void
    const { view, source } = await setup({ importRemoteImage: vi.fn(() => new Promise<string>((resolve) => { finish = resolve })) })
    view.pasteHTML('<p><img src="https://cdn.example/a.png"></p>')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    view.dispatch(view.state.tr.insertText('前置文字', 1))
    finish('attachments/arrived.png')
    await vi.waitFor(() => expect(source()).toContain('attachments/arrived.png'))
    expect(source()).toContain('前置文字')
  })

  it('下载失败保留原外链并给出反馈，其它图片仍继续处理', async () => {
    const { view, bridge, source } = await setup({ importRemoteImage: vi.fn()
      .mockRejectedValueOnce(new Error('cors')).mockResolvedValueOnce('attachments/ok.png') })
    view.pasteHTML('<p><img src="https://cdn.example/a.png"><img src="https://cdn.example/b.png"></p>')
    await vi.waitFor(() => expect(source()).toContain('attachments/ok.png'))
    expect(source()).toContain('https://cdn.example/a.png')
    expect(bridge.onRemoteImageError).toHaveBeenCalledOnce()
  })

  it('下载途中删除粘贴内容，不会把图片重新插回来', async () => {
    let finish!: (href: string) => void
    const { view, bridge, source } = await setup({ importRemoteImage: () => new Promise((resolve) => { finish = resolve }) })
    view.pasteHTML('<p><img src="https://cdn.example/a.png"></p>')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)).deleteSelection())
    finish('attachments/late.png')
    await Promise.resolve()
    await Promise.resolve()
    expect(source().trim()).toBe('')
    expect(bridge.onRemoteImageImported).not.toHaveBeenCalled()
  })

  it('本地化不额外占用撤销步骤，撤销一次就撤销整次粘贴', async () => {
    const { view, source } = await setup()
    view.pasteHTML('<p><img src="https://cdn.example/a.png"></p>')
    await vi.waitFor(() => expect(source()).toContain('attachments/local.png'))
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(source().trim()).toBe('')
  })

  it('本地图片不下载，编辑器销毁会取消正在下载的任务', async () => {
    let signal!: AbortSignal
    const { view, bridge } = await setup({ importRemoteImage: vi.fn((_src: string, value: AbortSignal) => {
      signal = value
      return new Promise<string>(() => {})
    }) })
    view.pasteHTML('<p><img src="attachments/local.png"></p>')
    await Promise.resolve()
    expect(bridge.importRemoteImage).not.toHaveBeenCalled()
    view.pasteHTML('<p><img src="https://cdn.example/a.png"></p>')
    await vi.waitFor(() => expect(signal).toBeDefined())
    await editors.pop()?.destroy()
    expect(signal.aborted).toBe(true)
  })
})

function file(name: string, type: string, bytes = [1, 2, 3]): File {
  return { name, type, arrayBuffer: async () => Uint8Array.from(bytes).buffer } as File
}

describe('音视频附件导入', () => {
  it('保存到附件桥并插入可往返的媒体节点', async () => {
    const save = vi.fn(async (_data: Uint8Array, _mime: string, name?: string) => `attachments/${name}`)
    const bridge: AttachmentBridge = { save, resolve: async () => null, release: vi.fn() }
    const root = document.createElement('div')
    const editor = await createLightEditor({ root, defaultValue: '', attachments: bridge }).create()
    editors.push({ destroy: () => editor.destroy() })

    const view = editor.action((ctx) => ctx.get(editorViewCtx)) as EditorView
    await insertAttachmentFiles(view, [file('录音.mp3', 'audio/mpeg'), file('演示.mp4', 'video/mp4')], bridge, 1)

    const result = editor.action((ctx) => {
      const nodes: string[] = []
      ctx.get(editorViewCtx).state.doc.descendants((node) => {
        nodes.push(node.type.name)
        return true
      })
      return { nodes, markdown: ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc) }
    })
    expect(save).toHaveBeenCalledTimes(2)
    expect(result.nodes.filter((name) => name === 'media')).toHaveLength(2)
    expect(result.markdown).toContain('<audio')
    expect(result.markdown).toContain('<video')
    expect(result.markdown).toContain('attachments/录音.mp3')
  })

  it('MIME 为空时按扩展名导入，普通文件不误保存', async () => {
    const save = vi.fn(async (_data: Uint8Array, _mime: string, name?: string) => `attachments/${name}`)
    const bridge: AttachmentBridge = { save, resolve: async () => null, release: vi.fn() }
    const root = document.createElement('div')
    const editor = await createLightEditor({ root, defaultValue: '', attachments: bridge }).create()
    editors.push({ destroy: () => editor.destroy() })

    const view = editor.action((ctx) => ctx.get(editorViewCtx)) as EditorView
    await insertAttachmentFiles(view, [file('无类型.webm', ''), file('报告.pdf', 'application/pdf')], bridge, 1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(expect.any(Uint8Array), '', '无类型.webm')
  })
})

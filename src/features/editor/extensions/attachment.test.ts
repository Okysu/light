// @vitest-environment jsdom
import { editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLightEditor } from '../create-editor'
import { insertAttachmentFiles, type AttachmentBridge } from './attachment'

const editors: Array<{ destroy: () => void }> = []

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy()
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
    editors.push({ destroy: () => void editor.destroy() })

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
    editors.push({ destroy: () => void editor.destroy() })

    const view = editor.action((ctx) => ctx.get(editorViewCtx)) as EditorView
    await insertAttachmentFiles(view, [file('无类型.webm', ''), file('报告.pdf', 'application/pdf')], bridge, 1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(expect.any(Uint8Array), '', '无类型.webm')
  })
})

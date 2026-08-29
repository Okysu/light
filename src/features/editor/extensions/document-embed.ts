import type { RemarkPluginRaw } from '@milkdown/kit/transformer'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { $command, $nodeSchema, $remark, $view } from '@milkdown/kit/utils'
import { SKIP, visit } from 'unist-util-visit'
import { stem } from '@/core/path'

export const DOCUMENT_EMBED = 'document_embed'
export type DocumentEmbedKind = 'board' | 'canvas'

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function parse(value: string): { type: typeof DOCUMENT_EMBED; kind: DocumentEmbedKind; path: string } | null {
  const match = value.trim().match(/^<light-embed\s+kind=["'](board|canvas)["']\s+src=["'](.*?)["']\s*>\s*<\/light-embed>$/is)
  if (!match) return null
  return { type: DOCUMENT_EMBED, kind: match[1] as DocumentEmbedKind, path: match[2]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&') }
}

const remarkDocumentEmbed: RemarkPluginRaw<never> = function () {
  return (tree) => {
    visit(tree, 'paragraph', (node, index, parent) => {
      if (index === undefined || !parent) return
      const children = node.children as Array<{ type: string; value?: string }>
      if (!children.length || children.some((item) => item.type !== 'html')) return
      const embed = parse(children.map((item) => item.value ?? '').join(''))
      if (!embed) return
      parent.children.splice(index, 1, embed as unknown as typeof parent.children[number])
      return [SKIP, index]
    })
    visit(tree, 'html', (node, index, parent) => {
      if (index === undefined || !parent || typeof node.value !== 'string') return
      const embed = parse(node.value)
      if (embed) parent.children.splice(index, 1, embed as unknown as typeof parent.children[number])
    })
  }
}

export const remarkDocumentEmbedPlugin = $remark('remarkDocumentEmbed', () => remarkDocumentEmbed)

export const documentEmbedSchema = $nodeSchema(DOCUMENT_EMBED, () => ({
  group: 'block', atom: true, selectable: true, isolating: true,
  attrs: { kind: { default: 'board' }, path: { default: '' } },
  parseDOM: [{
    tag: '[data-document-embed]',
    getAttrs: (dom) => ({
      kind: (dom as HTMLElement).dataset['kind'] === 'canvas' ? 'canvas' : 'board',
      path: (dom as HTMLElement).dataset['path'] ?? '',
    }),
  }],
  toDOM: (node) => ['div', {
    'data-document-embed': '', 'data-kind': node.attrs['kind'], 'data-path': node.attrs['path'],
    class: 'light-document-embed',
  }, `${node.attrs['kind'] === 'canvas' ? '画板' : '看板'}：${node.attrs['path'] ? stem(node.attrs['path'] as string) : '双击创建'}`],
  parseMarkdown: {
    match: (node) => node.type === DOCUMENT_EMBED,
    runner: (state, node, type) => state.addNode(type, { kind: node['kind'], path: node['path'] }),
  },
  toMarkdown: {
    match: (node) => node.type.name === DOCUMENT_EMBED,
    runner: (state, node) => {
      const kind = node.attrs['kind'] === 'canvas' ? 'canvas' : 'board'
      state.addNode('html', undefined, `<light-embed kind="${kind}" src="${escapeAttribute(node.attrs['path'] as string)}"></light-embed>`)
    },
  },
}))

export const insertDocumentEmbedCommand = $command(
  'InsertDocumentEmbed',
  (ctx) => (payload?: { kind: DocumentEmbedKind; path?: string }) => (state, dispatch) => {
    const node = documentEmbedSchema.type(ctx).create({ kind: payload?.kind ?? 'board', path: payload?.path ?? '' })
    dispatch?.(state.tr.replaceSelectionWith(node).scrollIntoView())
    return true
  },
)

function createEmbedView() {
  return () => (initialNode: ProseNode, view: EditorView, getPos: () => number | undefined): NodeView => {
    const dom = document.createElement('button')
    dom.type = 'button'
    dom.className = 'light-document-embed'
    let node = initialNode

    const paint = () => {
      const kind = node.attrs['kind'] === 'canvas' ? '画板' : '看板'
      const path = node.attrs['path'] as string
      dom.dataset['documentEmbed'] = ''
      dom.dataset['kind'] = node.attrs['kind'] as string
      dom.dataset['path'] = path
      dom.innerHTML = `<span class="light-document-embed-kind">${kind}</span><strong>${path ? stem(path) : `双击创建${kind}`}</strong><small>${path || '创建后会作为独立文件保存，可单独打开'}</small>`
    }
    paint()

    dom.addEventListener('dblclick', async (event) => {
      event.preventDefault()
      const { useEditorStore } = await import('@/stores/editor')
      let path = node.attrs['path'] as string
      if (!path) {
        const { useWorkspaceStore } = await import('@/stores/workspace')
        const kind = node.attrs['kind'] as DocumentEmbedKind
        path = await useWorkspaceStore().createNote('', kind === 'board' ? '内嵌看板' : '内嵌画板', kind)
        const pos = getPos()
        if (pos !== undefined) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, path }))
      }
      await useEditorStore().openNote(path)
    })

    return {
      dom,
      update: (updated) => {
        if (updated.type !== node.type) return false
        node = updated
        paint()
        return true
      },
      selectNode: () => dom.classList.add('is-selected'),
      deselectNode: () => dom.classList.remove('is-selected'),
      stopEvent: () => true,
    }
  }
}

export const documentEmbedView = $view(documentEmbedSchema.node, createEmbedView())
export const documentEmbed = [remarkDocumentEmbedPlugin, documentEmbedSchema, insertDocumentEmbedCommand, documentEmbedView].flat()

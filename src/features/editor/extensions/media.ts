import type { RemarkPluginRaw } from '@milkdown/kit/transformer'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { NodeView } from '@milkdown/kit/prose/view'
import { $nodeSchema, $remark, $view } from '@milkdown/kit/utils'
import { SKIP, visit } from 'unist-util-visit'
import { isInternalAttachment } from '@/core/attachments/attachment'
import type { AttachmentBridge } from './attachment'

export const MEDIA = 'media'
export type MediaKind = 'audio' | 'video'

interface MediaMdastNode {
  type: typeof MEDIA
  kind: MediaKind
  src: string
  title: string
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function attributeOf(source: string, name: string): string {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return decodeAttribute(match?.[2] ?? '')
}

/** 只接管 Light 生成的、结构单一的媒体 HTML；其它 HTML 继续交给原有兜底。 */
function parseMediaHtml(value: string): MediaMdastNode | null {
  const match = value.trim().match(/^<(audio|video)\b([^>]*)>\s*<\/\1\s*>$/is)
  if (!match) return null
  const src = attributeOf(match[2] ?? '', 'src')
  if (!src) return null
  return {
    type: MEDIA,
    kind: match[1]!.toLowerCase() as MediaKind,
    src,
    title: attributeOf(match[2] ?? '', 'title'),
  }
}

const remarkMedia: RemarkPluginRaw<never> = function () {
  return (tree) => {
    // CommonMark 会把同一行的 `<audio></audio>` 拆成段落里的两个 html 节点；
    // 先合并这个形态，再处理独立的块级 html 节点。
    visit(tree, 'paragraph', (node, index, parent) => {
      if (index === undefined || !parent || !Array.isArray(node.children)) return
      const children = node.children as Array<{ type: string; value?: string }>
      if (children.length === 0 || children.some((child) => child.type !== 'html')) return
      const media = parseMediaHtml(children.map((child) => child.value ?? '').join(''))
      if (!media) return
      parent.children.splice(index, 1, media as unknown as typeof parent.children[number])
      return [SKIP, index]
    })

    visit(tree, 'html', (node, index, parent) => {
      if (index === undefined || !parent || typeof node.value !== 'string') return
      const media = parseMediaHtml(node.value)
      if (media) parent.children.splice(index, 1, media as unknown as typeof parent.children[number])
    })
  }
}

export const remarkMediaPlugin = $remark('remarkMedia', () => remarkMedia)

export const mediaSchema = $nodeSchema(MEDIA, () => ({
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,
  attrs: {
    kind: { default: 'audio' },
    src: { default: '' },
    title: { default: '' },
  },

  parseDOM: [
    {
      tag: '[data-light-media]',
      getAttrs: (dom) => {
        const element = dom as HTMLElement
        return {
          kind: element.dataset['kind'] === 'video' ? 'video' : 'audio',
          src: element.dataset['src'] ?? '',
          title: element.dataset['title'] ?? '',
        }
      },
    },
  ],

  toDOM: (node) => [
    'div',
    {
      'data-light-media': '',
      'data-kind': node.attrs['kind'],
      'data-src': node.attrs['src'],
      'data-title': node.attrs['title'],
      class: `light-media-shell light-${node.attrs['kind']}`,
    },
  ],

  parseMarkdown: {
    match: (node) => node.type === MEDIA,
    runner: (state, node, type) => {
      state.addNode(type, {
        kind: (node['kind'] as MediaKind) ?? 'audio',
        src: (node['src'] as string) ?? '',
        title: (node['title'] as string) ?? '',
      })
    },
  },

  toMarkdown: {
    match: (node) => node.type.name === MEDIA,
    runner: (state, node) => {
      const kind = node.attrs['kind'] === 'video' ? 'video' : 'audio'
      const src = escapeAttribute(node.attrs['src'] as string)
      const title = node.attrs['title'] as string
      const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : ''
      state.addNode('html', undefined, `<${kind} controls preload="metadata" src="${src}"${titleAttribute}></${kind}>`)
    },
  },
}))

function fileLabel(src: string): string {
  const decoded = (() => {
    try { return decodeURI(src) } catch { return src }
  })()
  return decoded.split('/').at(-1) || src
}

/** 工作区相对路径需要先由 AttachmentBridge 转成 blob URL。 */
export function createMediaView(bridge: AttachmentBridge) {
  return $view(mediaSchema.node, () => (node: ProseNode): NodeView => {
    const kind: MediaKind = node.attrs['kind'] === 'video' ? 'video' : 'audio'
    const src = (node.attrs['src'] as string) ?? ''
    const title = (node.attrs['title'] as string) || fileLabel(src)
    const dom = document.createElement('figure')
    const player = document.createElement(kind)
    const missing = document.createElement('figcaption')

    dom.dataset['lightMedia'] = ''
    dom.dataset['kind'] = kind
    dom.dataset['src'] = src
    dom.dataset['title'] = title
    dom.className = `light-media-shell light-${kind}`
    player.controls = true
    player.preload = 'metadata'
    player.setAttribute('aria-label', `${kind === 'audio' ? '音频' : '视频'}：${title}`)
    if (kind === 'video') (player as HTMLVideoElement).playsInline = true
    missing.className = 'light-media-missing'
    missing.hidden = true
    dom.append(player, missing)

    let objectUrl: string | null = null
    let destroyed = false
    if (isInternalAttachment(src)) {
      void bridge.resolve(src).then((url) => {
        if (destroyed) {
          if (url?.startsWith('blob:')) bridge.release(url)
          return
        }
        if (!url) {
          missing.textContent = `无法读取${kind === 'audio' ? '音频' : '视频'}：${title}`
          missing.hidden = false
          dom.dataset['missing'] = ''
          return
        }
        objectUrl = url.startsWith('blob:') ? url : null
        player.src = url
      })
    } else {
      player.src = src
    }

    return {
      dom,
      selectNode: () => dom.classList.add('is-selected'),
      deselectNode: () => dom.classList.remove('is-selected'),
      stopEvent: (event) => event.target === player || player.contains(event.target as globalThis.Node),
      ignoreMutation: () => true,
      destroy: () => {
        destroyed = true
        player.removeAttribute('src')
        if (objectUrl) bridge.release(objectUrl)
      },
    }
  })
}

export const media = [remarkMediaPlugin, mediaSchema].flat()

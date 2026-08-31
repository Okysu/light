import { imageSchema } from '@milkdown/kit/preset/commonmark'
import { editorViewOptionsCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Fragment, Slice, type Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { $prose, $view } from '@milkdown/kit/utils'
import { embeddableKind, isInternalAttachment } from '@/core/attachments/attachment'
import { createMediaView } from './media'

/**
 * 图片、音频与视频附件的编辑器接入。
 *
 * 两件事：
 * 1. **选择、粘贴或拖入媒体时存进数据目录**，插入相对链接
 * 2. **显示工作区内的媒体**——`![](attachments/x.png)` 这样的相对路径，
 *    浏览器无从加载（OPFS 里的文件没有 URL），必须读出字节再转成 blob URL
 *
 * 不做第 2 件事的话，第 1 件事等于没做：存下去了，但看到的是破图。
 *
 * 这也是用户遇到 `Not allowed to load local resource: file:///…` 的根因——
 * 从 Windows 剪贴板历史粘贴时，剪贴板里是一段指向本地文件的 HTML，
 * Milkdown 照单全收地把 `file://` 当成了图片地址，而浏览器拒绝加载它。
 * 拦截粘贴并改存进工作区之后，这条路径就不会再产生了。
 */

/** 由外部注入的附件读写能力，让编辑器层不直接依赖 store */
export interface AttachmentBridge {
  /** 保存二进制，返回写进 Markdown 的相对链接 */
  save: (data: Uint8Array, mime: string, name?: string) => Promise<string>
  /** 把相对链接解析成可显示的 URL；解析不了返回 null */
  resolve: (src: string) => Promise<string | null>
  /**
   * 交还一个不再需要的 URL。
   *
   * 桥不提供「自己 revoke」这条路是有意的：URL 的所有权在 store 手里，
   * 让调用方能绕开它释放，等于把那个 bug 的入口重新开出来。
   */
  release: (url: string) => void
  /** 设备偏好在粘贴时读取，切换设置无需重建编辑器。 */
  shouldLocalizeRemoteImages?: () => boolean
  importRemoteImage?: (src: string, signal: AbortSignal) => Promise<string>
  onRemoteImageImported?: () => void
  onRemoteImageError?: (cause: unknown) => void
}

export const attachmentPluginKey = new PluginKey('LIGHT_ATTACHMENT')

/**
 * 从粘贴 / 拖放事件里挑出浏览器可直接显示或播放的媒体文件。
 *
 * 只认 `files`：剪贴板里同时存在 HTML 与文件时，我们要的是文件本身。
 * 单看 HTML 会拿到 `file://` 之类没法加载的地址，那正是要避开的情况。
 */
function embeddableFilesOf(transfer: DataTransfer | null): File[] {
  if (!transfer) return []
  return [...transfer.files].filter((file) => embeddableKind(file.type, file.name) !== null)
}

export function createAttachmentPlugin(bridge: AttachmentBridge) {
  const controllers = new WeakMap<EditorView, AbortController>()
  return $prose(
    (ctx) => {
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        handlePaste: (view, event, slice) => {
          if (bridge.shouldLocalizeRemoteImages?.() && bridge.importRemoteImage) {
            const signal = controllers.get(view)?.signal
            const before = view.state.doc
            if (signal) void Promise.resolve().then(() => {
              if (signal.aborted) return
              // Markdown 纯文本会被 clipboard 插件在 transformPasted 之后重新解析。
              // 观察实际插入的新节点，才能同时覆盖 HTML 与 Markdown，不碰原有图片。
              const existing = new Set<ProseNode>()
              before.descendants((node) => { existing.add(node) })
              const inserted: ProseNode[] = []
              view.state.doc.descendants((node) => {
                if (node.type.name === 'image' && !existing.has(node)) inserted.push(node)
              })
              return localizePastedImages(view, new Slice(Fragment.fromArray(inserted), 0, 0), bridge, signal)
            })
          }
          return prev.handlePaste?.call(view, view, event, slice) ?? false
        },
      }))
      return new Plugin({
        key: attachmentPluginKey,
        view: (view) => {
          const controller = new AbortController()
          controllers.set(view, controller)
          return { destroy: () => controller.abort() }
        },
        props: {
          handlePaste: (view, event) => handleFiles(view, embeddableFilesOf(event.clipboardData), bridge),
          handleDrop: (view, event) => {
            const dragEvent = event as DragEvent
            return handleFiles(view, embeddableFilesOf(dragEvent.dataTransfer), bridge, dragEvent)
          },
        },
      })
    },
  )
}

/**
 * @returns 是否已接管这次事件。返回 false 时交还给 Milkdown 的默认处理，
 *   否则粘贴纯文本也会被吞掉
 */
function handleFiles(
  view: EditorView,
  files: File[],
  bridge: AttachmentBridge,
  dropEvent?: DragEvent,
): boolean {
  if (files.length === 0) return false

  // 位置要在异步之前算好：等文件读完，选区可能已经变了
  const at = dropEvent
    ? (view.posAtCoords({ left: dropEvent.clientX, top: dropEvent.clientY })?.pos ?? view.state.selection.from)
    : view.state.selection.from

  void insertAttachmentFiles(view, files, bridge, at)
  return true
}

export async function insertAttachmentFiles(
  view: EditorView,
  files: File[],
  bridge: AttachmentBridge,
  at: number,
): Promise<void> {
  const imageType = view.state.schema.nodes['image']
  const mediaType = view.state.schema.nodes['media']

  let position = at

  for (const file of files) {
    try {
      const kind = embeddableKind(file.type, file.name)
      if (!kind) continue
      const data = new Uint8Array(await file.arrayBuffer())
      const href = await bridge.save(data, file.type, file.name || undefined)

      const node = kind === 'image'
        ? imageType?.create({ src: href, alt: file.name ?? '', title: null })
        : mediaType?.create({ kind, src: href, title: file.name ?? '' })
      if (!node) continue

      // 块级媒体让 ProseMirror 自动拆分光标所在段落；图片仍按 inline 节点插入。
      const safePosition = Math.min(position, view.state.doc.content.size)
      const tr = kind === 'image'
        ? view.state.tr.insert(safePosition, node)
        : view.state.tr.replaceRangeWith(safePosition, safePosition, node)
      view.dispatch(tr)
      position = Math.min(tr.mapping.map(safePosition, 1) + node.nodeSize, view.state.doc.content.size)
    } catch {
      // 一个文件存不下不该让其余的也进不来
      continue
    }
  }
}

/**
 * 图片 NodeView：把工作区内的相对路径换成可显示的 URL。
 *
 * 外部链接（http/data）原样交给浏览器——那是用户自己写的地址，
 * 我们既没有理由改写它，也无从把它解析成工作区里的文件。
 */
export function createAttachmentView(bridge: AttachmentBridge) {
  return $view(imageSchema.node, () => (node): NodeView => {
    const dom = document.createElement('img')
    const src = (node.attrs['src'] as string) ?? ''

    dom.alt = (node.attrs['alt'] as string) ?? ''
    if (node.attrs['title']) dom.title = node.attrs['title'] as string

    let objectUrl: string | null = null

    if (isInternalAttachment(src)) {
      void bridge.resolve(src).then((url) => {
        if (!url) {
          // 断链就让 alt 顶上，比一个破图图标更能说明发生了什么
          dom.dataset['missing'] = ''
          return
        }
        objectUrl = url.startsWith('blob:') ? url : null
        dom.src = url
      })
    } else {
      dom.src = src
    }

    return {
      dom,
      /**
       * 交还给 store，而**不是**自己 `revokeObjectURL`。
       *
       * 那个 URL 由 store 缓存并共享（同一张图可能出现在多处）。
       * 在这里直接 revoke，缓存里还留着那个已经失效的字符串，
       * 下次解析会把它原样发出来——切一次标签页图片就全裂了。
       */
      destroy: () => {
        if (objectUrl) bridge.release(objectUrl)
      },
    }
  })
}

export function attachment(bridge: AttachmentBridge) {
  return [createAttachmentPlugin(bridge), createAttachmentView(bridge), createMediaView(bridge)].flat()
}

/** 只跟踪本次粘贴的节点身份；下载期间移动光标或编辑文字，不会改到别处的同名外链。 */
export async function localizePastedImages(
  view: EditorView,
  slice: Slice,
  bridge: AttachmentBridge,
  signal: AbortSignal,
): Promise<void> {
  if (!bridge.importRemoteImage || signal.aborted) return
  const groups = new Map<string, Set<ProseNode>>()
  slice.content.descendants((node) => {
    const src = node.attrs['src'] as string | undefined
    if (node.type.name !== 'image' || !src || !/^https?:\/\//i.test(src)) return
    const nodes = groups.get(src) ?? new Set<ProseNode>()
    nodes.add(node)
    groups.set(src, nodes)
  })

  for (const [src, targets] of groups) {
    if (signal.aborted) return
    let present = false
    view.state.doc.descendants((node) => { if (targets.has(node)) present = true })
    if (!present) continue
    try {
      const href = await bridge.importRemoteImage(src, signal)
      if (signal.aborted) return
      const transaction = view.state.tr
      view.state.doc.descendants((node, pos) => {
        if (targets.has(node)) transaction.setNodeMarkup(pos, undefined, { ...node.attrs, src: href })
      })
      if (transaction.docChanged) {
        view.dispatch(transaction.setMeta('addToHistory', false))
        bridge.onRemoteImageImported?.()
      }
    } catch (cause) {
      if (signal.aborted) return
      // 下载失败保留原外链；不能吞掉图片，也不能让未处理 rejection 打断后续图片。
      bridge.onRemoteImageError?.(cause)
    }
  }
}

import { boundsOfAll } from '@/core/canvas/geometry'
import type { Shape } from '@/core/canvas/types'
import { saveFile } from '@/core/export/download'
import { stem } from '@/core/path'

/**
 * 导出画板为图片（4.7）。
 *
 * SVG 是直接序列化 DOM——这是选 SVG 渲染的一份红利，不必重画一遍。
 * PNG 则把那份 SVG 交给浏览器渲染一次再截取。
 *
 * 两者都要先做一件事：**把 CSS 变量换成具体色值**。导出的文件会离开这个页面，
 * 而 `var(--foreground)` 在别处解析不了，画出来会是一片黑或者干脆不显示。
 */

/** 导出时四周留白，否则图形会贴着边被切到 */
const PADDING = 24

export async function exportCanvas(
  svg: SVGSVGElement,
  shapes: readonly Shape[],
  path: string,
  format: 'png' | 'svg',
): Promise<void> {
  const bounds = boundsOfAll(shapes)
  if (!bounds) return

  const width = Math.max(bounds.width + PADDING * 2, 1)
  const height = Math.max(bounds.height + PADDING * 2, 1)
  const source = serialize(svg, bounds.x - PADDING, bounds.y - PADDING, width, height)

  const name = stem(path) || '画板'

  if (format === 'svg') {
    await saveFile(`${name}.svg`, new TextEncoder().encode(source), {
      filters: [{ name: 'SVG 图片', extensions: ['svg'] }],
    })
    return
  }

  const png = await toPng(source, width, height)
  await saveFile(`${name}.png`, png, { filters: [{ name: 'PNG 图片', extensions: ['png'] }] })
}

/**
 * 克隆一份 SVG 并整理成可独立打开的文档。
 *
 * 在克隆体上操作而不是原地改：原图还在用户眼前，导出时闪一下颜色是很糟的体验。
 */
function serialize(svg: SVGSVGElement, x: number, y: number, width: number, height: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  // 画布上的视口变换属于「我在看哪儿」，不该带进导出文件
  const root = clone.querySelector('g[transform]')
  root?.removeAttribute('transform')

  // 选中框与预览是交互反馈，不是内容
  clone.querySelectorAll('.pointer-events-none').forEach((element) => element.remove())

  resolveCssVariables(clone, svg)

  // 背景色：导出的图片默认应当有底，否则贴到深色文档里就看不见了
  const background = readVariable(svg, '--background') || '#ffffff'
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('x', String(x))
  rect.setAttribute('y', String(y))
  rect.setAttribute('width', String(width))
  rect.setAttribute('height', String(height))
  rect.setAttribute('fill', background)
  clone.insertBefore(rect, clone.firstChild)

  return new XMLSerializer().serializeToString(clone)
}

const COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color']

/** 把 `var(--x)` 形式的属性换成当前主题下的实际色值 */
function resolveCssVariables(clone: SVGSVGElement, source: SVGSVGElement): void {
  const cache = new Map<string, string>()

  for (const element of clone.querySelectorAll('*')) {
    for (const attr of COLOR_ATTRS) {
      const value = element.getAttribute(attr)
      if (!value?.startsWith('var(')) continue

      const name = value.slice(4, -1).trim()
      const resolved = cache.get(name) ?? readVariable(source, name)
      cache.set(name, resolved)

      element.setAttribute(attr, resolved || 'currentColor')
    }
  }
}

/**
 * 读取 CSS 变量并**归一成 RGB**。
 *
 * 本项目的主题变量是 `oklch(...)`。导出的 SVG 可能被老浏览器或图片工具打开，
 * 它们未必认 oklch。让浏览器实际渲染一遍再取值，是唯一不依赖颜色语法的做法
 * ——与知识图谱那边踩过的是同一个坑。
 */
function readVariable(element: Element, name: string): string {
  const raw = getComputedStyle(element).getPropertyValue(name).trim()
  if (!raw) return ''

  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return raw

  ctx.fillStyle = raw
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data

  return `rgb(${r}, ${g}, ${b})`
}

/** 用两倍分辨率渲染：导出的图多半会被放大看，1x 会糊 */
async function toPng(source: string, width: number, height: number): Promise<Uint8Array> {
  const scale = 2
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布上下文')
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!png) throw new Error('导出 PNG 失败')

    return new Uint8Array(await png.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('无法渲染 SVG'))
    image.src = url
  })
}

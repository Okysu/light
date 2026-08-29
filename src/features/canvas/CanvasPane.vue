<script setup lang="ts">
import {
  ArrowUpRight,
  BringToFront,
  Circle,
  Download,
  Hand,
  Group as GroupIcon,
  Lock,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Image as ImageIcon,
  FileText,
  LayoutDashboard,
  SendToBack,
  Square,
  StickyNote,
  Trash2,
  Type,
  Ungroup as UngroupIcon,
  Unlock,
} from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ContextMenu, { type MenuItem } from '@/components/ContextMenu.vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  boundsOf,
  intersects,
  normalizeBox,
  pointsToPath,
  simplifyPoints,
  toCanvas,
  toScreen,
  zoomAt,
} from '@/core/canvas/geometry'
import { hasText, type Point, type Shape, type ShapeKind } from '@/core/canvas/types'
import { contextUnit, expandGroupedSelection, selectionUnit } from '@/core/canvas/groups'
import { useCanvasStore } from '@/stores/canvas'
import { useEditorStore } from '@/stores/editor'
import { useAttachmentsStore } from '@/stores/attachments'
import { useWorkspaceStore } from '@/stores/workspace'
import { flattenTree } from '@/core/workspace/tree'
import { BoardService } from '@/core/board/board-service'
import { cn } from '@/lib/utils'
import ShapeView from './ShapeView.vue'
import { exportCanvas } from './export'
import { useI18nStore } from '@/stores/i18n'
import { formatShortcut, isMacPlatform } from '@/core/keyboard/shortcut'

/**
 * 画板视图（模块 4）。
 *
 * 交互全部围绕一个状态机：当前工具 + 当前手势。把它写成显式的 `gesture`
 * 而不是散落的布尔标记，是因为「正在框选」「正在拖图形」「正在画线」
 * 三者必须互斥——用布尔标记表达互斥，迟早会出现两个同时为真的中间态。
 */

const props = defineProps<{ path: string }>()
const i18n = useI18nStore()
const groupShortcut = formatShortcut('Mod+G', isMacPlatform())
const ungroupShortcut = formatShortcut('Mod+Shift+G', isMacPlatform())

const canvas = useCanvasStore()
const editor = useEditorStore()
const attachments = useAttachmentsStore()
const workspace = useWorkspaceStore()

type Tool = 'select' | 'pan' | ShapeKind

const tool = ref<Tool>('select')
const svg = ref<SVGSVGElement | null>(null)

/** 当前手势。null 表示空闲 */
type Gesture =
  | { type: 'pan'; origin: Point; viewportStart: Point }
  | { type: 'marquee'; from: Point; to: Point }
  | { type: 'move'; origin: Point; starts: Map<string, Point> }
  | { type: 'create'; from: Point; to: Point }
  | { type: 'draw'; points: Point[] }
  | null

const gesture = ref<Gesture>(null)

const TOOLS = computed<Array<{ value: Tool; icon: typeof Square; label: string }>>(() => [
  { value: 'select', icon: MousePointer2, label: i18n.t('canvas.select') }, { value: 'pan', icon: Hand, label: i18n.t('canvas.pan') },
  { value: 'rect', icon: Square, label: i18n.t('canvas.rect') }, { value: 'ellipse', icon: Circle, label: i18n.t('canvas.ellipse') },
  { value: 'line', icon: Minus, label: i18n.t('canvas.line') }, { value: 'arrow', icon: ArrowUpRight, label: i18n.t('canvas.arrow') },
  { value: 'text', icon: Type, label: i18n.t('canvas.text') }, { value: 'note', icon: StickyNote, label: i18n.t('canvas.note') },
  { value: 'draw', icon: Pencil, label: i18n.t('canvas.draw') },
])

const noteCandidates = computed(() => flattenTree(workspace.tree).filter((node) => node.kind === 'note'))
const boardCards = ref<Array<{ boardPath: string; cardId: string; title: string }>>([])

async function loadBoardCards(): Promise<void> {
  if (!workspace.storage) return
  const service = new BoardService(workspace.storage)
  const boards = flattenTree(workspace.tree).filter((node) => node.kind === 'board')
  const result: typeof boardCards.value = []
  for (const boardNode of boards) {
    const board = await service.read(boardNode.path)
    for (const column of board.columns) {
      for (const card of column.cards) result.push({ boardPath: boardNode.path, cardId: card.id, title: card.title })
    }
  }
  boardCards.value = result
}

function insertionPoint(): Point {
  const element = svg.value
  if (!element) return { x: 40, y: 40 }
  const rect = element.getBoundingClientRect()
  return toCanvas({ x: rect.width / 2, y: rect.height / 2 }, canvas.viewport)
}

function addNoteRef(path: string): void {
  const at = insertionPoint()
  canvas.addShape({ ...BASE.value, id: newId(), kind: 'noteRef', path, x: at.x - 100, y: at.y - 45, width: 200, height: 90 })
}

function addBoardCard(item: { boardPath: string; cardId: string; title: string }): void {
  const at = insertionPoint()
  canvas.addShape({ ...BASE.value, id: newId(), kind: 'boardCardRef', ...item, x: at.x - 110, y: at.y - 45, width: 220, height: 90 })
}

function pickImage(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return
    const href = await attachments.save(new Uint8Array(await file.arrayBuffer()), file.type, props.path, file.name)
    const at = insertionPoint()
    canvas.addShape({ ...BASE.value, id: newId(), kind: 'imageRef', src: href, alt: file.name, x: at.x - 160, y: at.y - 100, width: 320, height: 200 })
  })
  input.click()
}

watch(() => props.path, (next) => void canvas.open(next), { immediate: true })

onBeforeUnmount(() => void canvas.flush())

/** 选中项是否全部锁定，决定锁按钮显示哪个图标 */
const allLocked = computed(
  () => canvas.selected.length > 0 && canvas.selected.every((shape) => shape.locked),
)

function pointerOf(event: PointerEvent): Point {
  const rect = svg.value!.getBoundingClientRect()
  return toCanvas({ x: event.clientX - rect.left, y: event.clientY - rect.top }, canvas.viewport)
}

function shapeIdAt(event: PointerEvent): string | null {
  const target = event.target as Element | null
  return target?.closest<SVGGElement>('[data-shape-id]')?.dataset['shapeId'] ?? null
}

/**
 * `pointerdown` 时命中的图形。
 *
 * 双击不能自己判断命中：`pointerdown` 里调了 `setPointerCapture`，
 * 此后的 pointerup / click / dblclick 的 target 全都变成**捕获元素**（svg），
 * 拿它去 `closest('[data-shape-id]')` 永远是空的。
 *
 * 这个坑很隐蔽——用合成事件直接派发到图形上测，是测不出来的，
 * 因为那时根本没有捕获这回事。
 */
let pointerDownShapeId: string | null = null

/**
 * 指针捕获：让拖拽在移出画布后依然收得到事件。
 * 包在 try 里——某些输入设备（以及自动化产生的合成事件）下它会抛，
 * 而捕获失败只该让拖拽稍差一点，不该把整个手势处理中断掉。
 */
function capture(event: PointerEvent, on: boolean): void {
  try {
    if (on) svg.value?.setPointerCapture(event.pointerId)
    else svg.value?.releasePointerCapture(event.pointerId)
  } catch {
    // 忽略：拖拽仍能在画布范围内正常工作
  }
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  // 正在编辑文本时点画布 = 提交并退出，不该同时开始一个新手势
  if (editing.value) {
    commitEditing()
    return
  }

  // 必须在捕获**之前**记：捕获一旦生效，target 就不再是实际命中的图形
  pointerDownShapeId = shapeIdAt(event)
  capture(event, true)

  const point = pointerOf(event)

  // 空格或平移工具：拖动画布本身
  if (tool.value === 'pan' || event.shiftKey) {
    gesture.value = {
      type: 'pan',
      origin: { x: event.clientX, y: event.clientY },
      viewportStart: { x: canvas.viewport.x, y: canvas.viewport.y },
    }
    return
  }

  if (tool.value === 'draw') {
    gesture.value = { type: 'draw', points: [point] }
    return
  }

  if (tool.value !== 'select') {
    gesture.value = { type: 'create', from: point, to: point }
    return
  }

  // 选择工具：点在图形上就拖它，点在空白就框选
  const hitId = pointerDownShapeId
  if (hitId) {
    const unit = selectionUnit(canvas.shapes, hitId)
    if (!canvas.selectedIds.includes(hitId)) {
      canvas.selectedIds = event.metaKey || event.ctrlKey
        ? [...new Set([...canvas.selectedIds, ...unit])]
        : unit
    }

    const starts = new Map<string, Point>()
    for (const shape of canvas.selected) {
      const bounds = boundsOf(shape)
      starts.set(shape.id, { x: bounds.x, y: bounds.y })
    }
    gesture.value = { type: 'move', origin: point, starts }
    return
  }

  if (!event.metaKey && !event.ctrlKey) canvas.selectedIds = []
  gesture.value = { type: 'marquee', from: point, to: point }
}

function onPointerMove(event: PointerEvent): void {
  const current = gesture.value
  if (!current) return

  if (current.type === 'pan') {
    canvas.viewport = {
      ...canvas.viewport,
      x: current.viewportStart.x + (event.clientX - current.origin.x),
      y: current.viewportStart.y + (event.clientY - current.origin.y),
    }
    return
  }

  const point = pointerOf(event)

  if (current.type === 'marquee' || current.type === 'create') {
    gesture.value = { ...current, to: point }
    return
  }

  if (current.type === 'draw') {
    gesture.value = { ...current, points: [...current.points, point] }
    return
  }

  if (current.type === 'move') {
    const dx = point.x - current.origin.x
    const dy = point.y - current.origin.y

    canvas.updateShapes(
      [...current.starts].map(([id, start]) => ({
        id,
        patch: shiftPatch(id, start, dx, dy),
      })),
    )
  }
}

/** 线与手绘的位置藏在端点/点串里，平移时要一并挪 */
function shiftPatch(id: string, start: Point, dx: number, dy: number): Partial<Shape> {
  const shape = canvas.shapes.find((item) => item.id === id)
  if (!shape) return {}

  if (shape.kind === 'line' || shape.kind === 'arrow') {
    const bounds = boundsOf(shape)
    const offsetX = start.x + dx - bounds.x
    const offsetY = start.y + dy - bounds.y
    return {
      from: { x: shape.from.x + offsetX, y: shape.from.y + offsetY },
      to: { x: shape.to.x + offsetX, y: shape.to.y + offsetY },
    } as Partial<Shape>
  }

  if (shape.kind === 'draw') {
    const bounds = boundsOf(shape)
    const offsetX = start.x + dx - bounds.x
    const offsetY = start.y + dy - bounds.y
    return {
      points: shape.points.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY })),
    } as Partial<Shape>
  }

  return { x: start.x + dx, y: start.y + dy }
}

function onPointerUp(event: PointerEvent): void {
  const current = gesture.value
  gesture.value = null
  capture(event, false)
  if (!current) return

  if (current.type === 'marquee') {
    const box = normalizeBox(current.from, current.to)
    // 几乎没拖动就当作单纯的点击，不做框选
    if (box.width < 3 && box.height < 3) return

    const hits = canvas.shapes
      .filter((shape) => !shape.locked && intersects(boundsOf(shape), box))
      .map((shape) => shape.id)
    canvas.selectedIds = expandGroupedSelection(canvas.shapes, hits)
    return
  }

  if (current.type === 'draw') {
    const points = simplifyPoints(current.points)
    if (points.length >= 2) canvas.addShape(makeDraw(points))
    tool.value = 'select'
    return
  }

  if (current.type === 'create') {
    const shape = makeShape(tool.value as ShapeKind, current.from, current.to)
    if (shape) canvas.addShape(shape)
    // 画完自动回到选择工具：连续画同一种图形是少数情况
    tool.value = 'select'
  }
}

function newId(): string {
  return crypto.randomUUID()
}

/**
 * 可选颜色。
 *
 * 用 CSS 变量而不是写死的色值：深色模式下同一个变量会给出另一套颜色，
 * 图形因此跟着主题走。导出时这些变量会被解析成具体色值（见 export.ts）。
 */
const COLORS = computed(() => [
  { name: i18n.t('canvas.defaultColor'), value: 'var(--foreground)' }, { name: i18n.t('canvas.red'), value: 'var(--light-shape-red)' },
  { name: i18n.t('canvas.orange'), value: 'var(--light-shape-orange)' }, { name: i18n.t('canvas.green'), value: 'var(--light-shape-green)' },
  { name: i18n.t('canvas.blue'), value: 'var(--light-shape-blue)' }, { name: i18n.t('canvas.purple'), value: 'var(--light-shape-purple)' },
] as const)

/** 新图形使用的颜色；改了它之后画的图形都用新颜色 */
const stroke = ref<string>('var(--foreground)')
const fill = ref<string>('')

const BASE = computed(() => ({
  stroke: stroke.value,
  fill: fill.value,
  strokeWidth: 2,
  locked: false,
  groupId: '',
}))

/**
 * 改颜色：有选中项就改选中项，没有就只改「接下来要画的」。
 * 两种意图都常见，用同一个入口表达——先选后改是编辑，直接改是设定默认。
 */
function applyStroke(value: string): void {
  stroke.value = value
  if (canvas.selectedIds.length > 0) {
    canvas.updateShapes(canvas.selectedIds.map((id) => ({ id, patch: { stroke: value } })))
  }
}

function applyFill(value: string): void {
  fill.value = value
  if (canvas.selectedIds.length > 0) {
    canvas.updateShapes(canvas.selectedIds.map((id) => ({ id, patch: { fill: value } })))
  }
}

function makeDraw(points: Point[]): Shape {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return {
    ...BASE.value,
    id: newId(),
    kind: 'draw',
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    points,
  }
}

function makeShape(kind: ShapeKind, from: Point, to: Point): Shape | null {
  const box = normalizeBox(from, to)

  if (kind === 'line' || kind === 'arrow') {
    // 点一下不拖不该产出一条零长度的线
    if (Math.hypot(to.x - from.x, to.y - from.y) < 4) return null
    return { ...BASE.value, id: newId(), kind, ...box, from, to, fromId: '', toId: '' }
  }

  // 点一下就放一个默认大小的图形，比强迫用户拖出尺寸更顺手
  const width = box.width < 8 ? defaultSize(kind).width : box.width
  const height = box.height < 8 ? defaultSize(kind).height : box.height
  const common = { ...BASE.value, id: newId(), x: box.x, y: box.y, width, height }

  switch (kind) {
    case 'text':
    return { ...common, kind: 'text', text: i18n.t('canvas.text'), fontSize: 16 }
    case 'note':
    return { ...common, kind: 'note', text: i18n.t('canvas.note'), fill: 'var(--light-note-bg)', stroke: 'transparent' }
    case 'rect':
    case 'ellipse':
      return { ...common, kind, text: '' }
    default:
      return null
  }
}

function defaultSize(kind: ShapeKind): { width: number; height: number } {
  if (kind === 'text') return { width: 80, height: 24 }
  if (kind === 'note') return { width: 160, height: 120 }
  return { width: 120, height: 80 }
}

/** 滚轮缩放；按住 Ctrl 与否都缩放——画板里滚动页面没有意义 */
function onWheel(event: WheelEvent): void {
  event.preventDefault()
  const rect = svg.value!.getBoundingClientRect()
  const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  canvas.viewport = zoomAt(canvas.viewport, anchor, event.deltaY < 0 ? 1.1 : 1 / 1.1)
}

/** 双击嵌入的笔记卡片直接打开那篇笔记（4.5） */
async function onDoubleClick(): Promise<void> {
  // 用 pointerdown 记下的命中结果，理由见 pointerDownShapeId
  const id = pointerDownShapeId
  const shape = id ? canvas.shapes.find((item) => item.id === id) : null
  if (!shape) return

  if ((shape.kind === 'noteRef' && shape.path) || (shape.kind === 'boardCardRef' && shape.boardPath)) {
    await editor.openNote(shape.kind === 'noteRef' ? shape.path : shape.boardPath)
    return
  }

  if (hasText(shape) && !shape.locked) startEditing(shape)
}

/**
 * 就地编辑文本。
 *
 * 用绝对定位的 textarea 盖在图形上，而不是 SVG 的 `<foreignObject>`：
 * 后者在各浏览器里的表单行为差异不小（尤其是输入法与光标），
 * 而这里要的就是一个普普通通的输入框。
 */
const editing = ref<{ id: string; text: string } | null>(null)
const editorBox = ref({ left: 0, top: 0, width: 0, height: 0 })
const textEditor = ref<HTMLTextAreaElement | null>(null)

function startEditing(shape: Shape): void {
  if (!hasText(shape)) return

  const bounds = boundsOf(shape)
  const topLeft = toScreen({ x: bounds.x, y: bounds.y }, canvas.viewport)

  editorBox.value = {
    left: topLeft.x,
    top: topLeft.y,
    width: Math.max(bounds.width * canvas.viewport.scale, 60),
    height: Math.max(bounds.height * canvas.viewport.scale, 28),
  }
  editing.value = { id: shape.id, text: shape.text }

  void nextTick(() => {
    textEditor.value?.focus()
    textEditor.value?.select()
  })
}

function commitEditing(): void {
  const current = editing.value
  editing.value = null
  if (!current) return

  const shape = canvas.shapes.find((item) => item.id === current.id)
  if (shape && hasText(shape) && shape.text !== current.text) {
    canvas.updateShape(current.id, { text: current.text } as Partial<Shape>)
  }
}

function cancelEditing(): void {
  editing.value = null
}

function onKeydown(event: KeyboardEvent): void {
  /**
   * 正在输入文字时，键盘属于那个输入框。
   *
   * 这个监听挂在最外层容器上，textarea 里的按键会一路冒泡上来——
   * 用户想删掉一个字符，结果整个图形被删了。判断事件源而不是只看
   * `editing`：将来画布上多一个输入框，这里也不必再改。
   */
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, [contenteditable="true"]')) return

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (canvas.selectedIds.length > 0) {
      event.preventDefault()
      canvas.removeShapes(canvas.selectedIds)
    }
    return
  }
  if (event.key === 'Escape') {
    canvas.selectedIds = []
    tool.value = 'select'
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
    event.preventDefault()
    if (event.shiftKey) canvas.ungroupSelected()
    else canvas.groupSelected()
  }
}

/**
 * 右键命中的图元。
 *
 * 在 contextmenu 冒泡到菜单触发器之前记下来——菜单弹出后就无从知道
 * 用户当初点的是哪一个了。顺便把它选中：菜单里的操作作用于「选中项」，
 * 右键一个没选中的图形却删掉了别的，是最容易激怒人的那种错。
 */
const contextShapeId = ref<string | null>(null)

function onContextMenu(event: MouseEvent): void {
  const id = (event.target as Element | null)?.closest<SVGGElement>('[data-shape-id]')?.dataset['shapeId']
  contextShapeId.value = id ?? null

  if (id && !canvas.selectedIds.includes(id)) canvas.selectedIds = contextUnit(canvas.shapes, id)
}

const contextShape = computed(() =>
  contextShapeId.value ? (canvas.shapes.find((item) => item.id === contextShapeId.value) ?? null) : null,
)

const shapeMenuItems = computed<MenuItem[]>(() => {
  const shape = contextShape.value

  // 右键空白处：给的是「对整张画板」的操作
  if (!shape) {
    return [
      { label: i18n.t('canvas.all'), icon: MousePointer2, action: () => (canvas.selectedIds = canvas.shapes.map((s) => s.id)) },
      { label: i18n.t('canvas.fit'), icon: Maximize, action: fitToContent },
    ]
  }

  const ids = canvas.selectedIds.length > 0 ? canvas.selectedIds : [shape.id]

  return [
    ...(hasText(shape) && !shape.locked
      ? [{ label: i18n.t('canvas.editText'), icon: Type, action: () => startEditing(shape) }]
      : []),
    { label: i18n.t('canvas.front'), icon: BringToFront, separatorBefore: true, action: () => canvas.bringToFront(ids) },
    { label: i18n.t('canvas.back'), icon: SendToBack, action: () => canvas.sendToBack(ids) },
    ...(ids.length > 1
      ? [{ label: i18n.t('canvas.group', { shortcut: groupShortcut }), icon: GroupIcon, separatorBefore: true, action: () => canvas.groupSelected() }]
      : []),
    ...(ids.some((id) => canvas.shapes.find((item) => item.id === id)?.groupId)
      ? [{ label: i18n.t('canvas.ungroup', { shortcut: ungroupShortcut }), icon: UngroupIcon, action: () => canvas.ungroupSelected() }]
      : []),
    {
      label: shape.locked ? i18n.t('canvas.unlock') : i18n.t('canvas.lock'),
      icon: shape.locked ? Unlock : Lock,
      separatorBefore: true,
      action: () => canvas.updateShapes(ids.map((id) => ({ id, patch: { locked: !shape.locked } }))),
    },
    {
      label: ids.length > 1 ? i18n.t('canvas.deleteMany', { count: ids.length }) : i18n.t('canvas.delete'),
      icon: Trash2,
      danger: true,
      action: () => canvas.removeShapes(ids),
    },
  ]
})

function toggleLock(): void {
  const next = !allLocked.value
  canvas.updateShapes(canvas.selectedIds.map((id) => ({ id, patch: { locked: next } })))
}

/** 缩放到能看全所有内容 */
function fitToContent(): void {
  const bounds = canvas.contentBounds
  const element = svg.value
  if (!bounds || !element || bounds.width === 0 || bounds.height === 0) {
    canvas.viewport = { x: 0, y: 0, scale: 1 }
    return
  }

  const rect = element.getBoundingClientRect()
  const padding = 60
  const scale = Math.min(
    (rect.width - padding * 2) / bounds.width,
    (rect.height - padding * 2) / bounds.height,
    2,
  )

  canvas.viewport = {
    scale,
    x: rect.width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: rect.height / 2 - (bounds.y + bounds.height / 2) * scale,
  }
}

/** 拖拽中的预览框：让用户看清自己正在画多大 */
const preview = computed(() => {
  const current = gesture.value
  if (current?.type === 'create') return normalizeBox(current.from, current.to)
  if (current?.type === 'marquee') return normalizeBox(current.from, current.to)
  return null
})

const previewIsMarquee = computed(() => gesture.value?.type === 'marquee')

const drawingPath = computed(() => {
  const current = gesture.value
  return current?.type === 'draw' ? current.points : null
})

const transform = computed(
  () => `translate(${canvas.viewport.x} ${canvas.viewport.y}) scale(${canvas.viewport.scale})`,
)

const minimap = computed(() => {
  const bounds = canvas.contentBounds
  const element = svg.value
  if (!bounds || !element) return null
  const width = 156
  const height = 96
  const padding = 8
  const scale = Math.min((width - padding * 2) / Math.max(bounds.width, 1), (height - padding * 2) / Math.max(bounds.height, 1))
  const ox = padding - bounds.x * scale + (width - padding * 2 - bounds.width * scale) / 2
  const oy = padding - bounds.y * scale + (height - padding * 2 - bounds.height * scale) / 2
  const rect = element.getBoundingClientRect()
  return {
    width, height, scale, ox, oy,
    viewport: {
      x: (-canvas.viewport.x / canvas.viewport.scale) * scale + ox,
      y: (-canvas.viewport.y / canvas.viewport.scale) * scale + oy,
      width: (rect.width / canvas.viewport.scale) * scale,
      height: (rect.height / canvas.viewport.scale) * scale,
    },
  }
})

async function download(format: 'png' | 'svg'): Promise<void> {
  if (!svg.value) return
  await exportCanvas(svg.value, canvas.shapes, props.path, format)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" tabindex="0" role="application" :aria-label="i18n.t('canvas.editor')" @keydown="onKeydown">
    <!-- 工具条 -->
    <div class="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5" role="toolbar" :aria-label="i18n.t('canvas.toolbar')">
      <Button
        v-for="item in TOOLS"
        :key="item.value"
        size="icon-sm"
        :variant="tool === item.value ? 'default' : 'ghost'"
        :title="item.label"
        @click="tool = item.value"
      >
        <component :is="item.icon" />
      </Button>

      <span class="mx-1 h-5 w-px bg-border" />

      <Popover>
        <PopoverTrigger as-child><Button size="icon-sm" variant="ghost" :title="i18n.t('canvas.embedNote')"><FileText /></Button></PopoverTrigger>
        <PopoverContent class="max-h-72 w-64 overflow-y-auto p-1" align="start">
          <button v-for="note in noteCandidates" :key="note.path" class="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent" @click="addNoteRef(note.path)">{{ note.name }}</button>
          <p v-if="!noteCandidates.length" class="p-2 text-xs text-muted-foreground">{{ i18n.t('canvas.noNotes') }}</p>
        </PopoverContent>
      </Popover>
      <Button size="icon-sm" variant="ghost" :title="i18n.t('canvas.embedImage')" @click="pickImage"><ImageIcon /></Button>
      <Popover @update:open="$event && loadBoardCards()">
        <PopoverTrigger as-child><Button size="icon-sm" variant="ghost" :title="i18n.t('canvas.embedCard')"><LayoutDashboard /></Button></PopoverTrigger>
        <PopoverContent class="max-h-72 w-72 overflow-y-auto p-1" align="start">
          <button v-for="item in boardCards" :key="`${item.boardPath}:${item.cardId}`" class="block w-full rounded px-2 py-1.5 text-left hover:bg-accent" @click="addBoardCard(item)">
            <span class="block truncate text-sm">{{ item.title }}</span><span class="block truncate text-xs text-muted-foreground">{{ item.boardPath }}</span>
          </button>
          <p v-if="!boardCards.length" class="p-2 text-xs text-muted-foreground">{{ i18n.t('canvas.noCards') }}</p>
        </PopoverContent>
      </Popover>

      <span class="mx-1 h-5 w-px bg-border" />

      <Button
        size="icon-sm"
        variant="ghost"
        :disabled="canvas.selectedIds.length === 0"
        :title="allLocked ? i18n.t('canvas.unlock') : i18n.t('canvas.lock')"
        @click="toggleLock"
      >
        <Unlock v-if="allLocked" />
        <Lock v-else />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        :disabled="canvas.selectedIds.length === 0"
        :title="i18n.t('canvas.delete')"
        @click="canvas.removeShapes(canvas.selectedIds)"
      >
        <Trash2 />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        :disabled="canvas.selectedIds.length < 2"
        :title="i18n.t('canvas.group', { shortcut: groupShortcut })"
        @click="canvas.groupSelected"
      >
        <GroupIcon />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        :disabled="!canvas.selected.some((shape) => shape.groupId)"
        :title="i18n.t('canvas.ungroup', { shortcut: ungroupShortcut })"
        @click="canvas.ungroupSelected"
      >
        <UngroupIcon />
      </Button>

      <span class="mx-1 h-5 w-px bg-border" />

      <!-- 描边色：选中图形时即时改它，否则设定接下来要画的颜色 -->
      <Popover>
        <PopoverTrigger as-child>
          <Button size="icon-sm" variant="ghost" :title="i18n.t('canvas.color')">
            <span
              class="size-4 rounded-full border border-border"
              :style="{ backgroundColor: stroke }"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-2" align="start">
          <p class="mb-1.5 text-xs text-muted-foreground">{{ i18n.t('canvas.stroke') }}</p>
          <div class="flex gap-1.5">
            <button
              v-for="color in COLORS"
              :key="color.value"
              class="size-6 rounded-full border transition-transform hover:scale-110"
              :class="stroke === color.value ? 'border-ring ring-2 ring-ring' : 'border-border'"
              :style="{ backgroundColor: color.value }"
              :title="color.name"
              @click="applyStroke(color.value)"
            />
          </div>

          <p class="mb-1.5 mt-3 text-xs text-muted-foreground">{{ i18n.t('canvas.fill') }}</p>
          <div class="flex gap-1.5">
            <button
              class="flex size-6 items-center justify-center rounded-full border border-border text-xs text-muted-foreground transition-transform hover:scale-110"
              :class="fill === '' && 'border-ring ring-2 ring-ring'"
              :title="i18n.t('canvas.noFill')"
              @click="applyFill('')"
            >
              ∅
            </button>
            <button
              v-for="color in COLORS.slice(1)"
              :key="color.value"
              class="size-6 rounded-full border transition-transform hover:scale-110"
              :class="fill === color.value ? 'border-ring ring-2 ring-ring' : 'border-border'"
              :style="{ backgroundColor: color.value, opacity: 0.35 }"
              :title="color.name"
              @click="applyFill(color.value)"
            />
          </div>
        </PopoverContent>
      </Popover>

      <Button size="icon-sm" variant="ghost" :title="i18n.t('canvas.fit')" @click="fitToContent">
        <Maximize />
      </Button>
      <!--
        一个导出按钮，格式在弹出层里选。
        两个并排的按钮把「选格式」这件次要的事摆到了和「导出」同一层级，
        工具条上每多一个常驻按钮，其余按钮就更难找。
      -->
      <Popover>
        <PopoverTrigger as-child>
          <Button size="icon-sm" variant="ghost" :title="i18n.t('canvas.export')">
            <Download />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-56 p-1" align="end">
          <button
            class="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            @click="download('png')"
          >
            {{ i18n.t('canvas.exportPng') }}
            <span class="text-xs text-muted-foreground">{{ i18n.t('canvas.pngHint') }}</span>
          </button>
          <button
            class="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            @click="download('svg')"
          >
            {{ i18n.t('canvas.exportSvg') }}
            <span class="text-xs text-muted-foreground">{{ i18n.t('canvas.svgHint') }}</span>
          </button>
        </PopoverContent>
      </Popover>

      <span class="ml-auto text-xs text-muted-foreground">
        {{ Math.round(canvas.viewport.scale * 100) }}%
        <template v-if="canvas.saving"> · {{ i18n.t('canvas.saving') }}</template>
        <template v-else-if="canvas.dirty"> · {{ i18n.t('canvas.unsaved') }}</template>
      </span>
    </div>

    <!-- 画布。外面必须包一层：SVG 是替换元素，直接给 flex-1 会因为固有尺寸
         塌缩成 300×150 甚至更小，画布就成了角落里的一小块 -->
    <ContextMenu :items="shapeMenuItems">
      <div class="relative min-h-0 flex-1" @contextmenu="onContextMenu">
      <svg
        ref="svg"
        :class="
          cn(
            'absolute inset-0 h-full w-full touch-none bg-background',
            tool === 'pan' ? 'cursor-grab' : tool === 'select' ? 'cursor-default' : 'cursor-crosshair',
          )
        "
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel="onWheel"
        @dblclick="onDoubleClick"
      >
        <defs>
        <marker
          id="light-arrowhead"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--foreground)" />
        </marker>
        </defs>

        <g :transform="transform">
        <ShapeView
          v-for="shape in canvas.shapes"
          :key="shape.id"
          :shape="shape"
          :selected="canvas.selectedIds.includes(shape.id)"
          :all="canvas.shapes"
          :document-path="props.path"
        />

        <!-- 正在画的预览 -->
        <rect
          v-if="preview"
          :x="preview.x"
          :y="preview.y"
          :width="preview.width"
          :height="preview.height"
          :fill="previewIsMarquee ? 'var(--ring)' : 'none'"
          :fill-opacity="previewIsMarquee ? 0.1 : 0"
          stroke="var(--ring)"
          stroke-width="1"
          :stroke-dasharray="previewIsMarquee ? '4 3' : undefined"
          class="pointer-events-none"
        />

        <path
          v-if="drawingPath"
          :d="pointsToPath(drawingPath)"
          fill="none"
          stroke="var(--foreground)"
          stroke-width="2"
          stroke-linecap="round"
          class="pointer-events-none"
        />
        </g>
      </svg>

      <svg
        v-if="minimap"
        class="absolute bottom-3 right-3 h-24 w-40 rounded-md border border-border bg-background/90 shadow-sm"
        :viewBox="`0 0 ${minimap.width} ${minimap.height}`"
        :aria-label="i18n.t('canvas.minimap')"
      >
        <rect
          v-for="shape in canvas.shapes.filter((item) => item.kind !== 'line' && item.kind !== 'arrow')"
          :key="shape.id"
          :x="boundsOf(shape).x * minimap.scale + minimap.ox"
          :y="boundsOf(shape).y * minimap.scale + minimap.oy"
          :width="Math.max(2, boundsOf(shape).width * minimap.scale)"
          :height="Math.max(2, boundsOf(shape).height * minimap.scale)"
          fill="var(--muted-foreground)"
          opacity="0.45"
        />
        <rect
          :x="minimap.viewport.x" :y="minimap.viewport.y"
          :width="minimap.viewport.width" :height="minimap.viewport.height"
          fill="none" stroke="var(--primary)" stroke-width="1.5"
        />
      </svg>

      <!-- 就地文本编辑：盖在图形上的一个普通 textarea -->
      <textarea
        v-if="editing"
        ref="textEditor"
        v-model="editing.text"
        class="absolute resize-none rounded-sm border border-ring bg-background px-1 py-0.5 text-sm outline-none"
        :style="{
          left: `${editorBox.left}px`,
          top: `${editorBox.top}px`,
          width: `${editorBox.width}px`,
          height: `${editorBox.height}px`,
        }"
        @blur="commitEditing"
        @keydown.esc.prevent="cancelEditing"
        @keydown.enter.exact.prevent="commitEditing"
      />

        <p
          v-if="canvas.shapes.length === 0"
          class="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-muted-foreground"
        >
          {{ i18n.t('canvas.empty') }}
        </p>
      </div>
    </ContextMenu>
  </div>
</template>

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { CanvasService } from '@/core/canvas/canvas-service'
import { boundsOfAll, createViewport, type Viewport } from '@/core/canvas/geometry'
import { createEmptyCanvas, type CanvasDoc, type Shape } from '@/core/canvas/types'
import { groupShapes, ungroupShapes } from '@/core/canvas/groups'
import { createAutosave } from './autosave'
import { useSearchStore } from './search'
import { useWorkspaceStore } from './workspace'

/**
 * 当前打开的画板（模块 4）。
 *
 * 与看板同一套 local-first 做法：改动先进内存、标脏、防抖落盘。
 *
 * 视口（缩放平移）**不落盘**：它是「我此刻在看哪儿」，不是画板的内容。
 * 存进文件会让两台设备互相拽着对方的视角跑。
 */
export const useCanvasStore = defineStore('canvas', () => {
  const workspace = useWorkspaceStore()

  const service = shallowRef<CanvasService | null>(null)
  const doc = ref<CanvasDoc>(createEmptyCanvas())
  const path = ref<string | null>(null)
  const dirty = ref(false)
  const saving = ref(false)

  const viewport = ref<Viewport>(createViewport())
  const selectedIds = ref<string[]>([])

  const SAVE_DELAY = 400

  const shapes = computed(() => doc.value.shapes)

  const selected = computed(() => shapes.value.filter((shape) => selectedIds.value.includes(shape.id)))

  const contentBounds = computed(() => boundsOfAll(shapes.value))

  async function open(target: string): Promise<void> {
    // 同名文件被删掉又新建时路径不变，但内容已经是另一份了。
    // 只比路径就短路的话，下一次自动保存会把旧画板写进新文件
    if (path.value === target && dirty.value) return
    await flush()

    doc.value = await ensureService().read(target)
    path.value = target
    dirty.value = false
    selectedIds.value = []
    viewport.value = createViewport()
  }

  async function close(): Promise<void> {
    await flush()
    doc.value = createEmptyCanvas()
    path.value = null
    selectedIds.value = []
  }

  /** 所有变更的唯一出口 */
  function apply(next: Shape[]): void {
    doc.value = { ...doc.value, shapes: next }
    dirty.value = true
    schedule()
  }

  /**
   * 一次实际写入。文档与路径都在进入异步前定格——
   * 等 await 回来时，用户可能已经切到另一张画板了。
   */
  async function writeOnce(): Promise<void> {
    const current = doc.value
    const target = path.value
    if (!target || !dirty.value) return

    saving.value = true
    try {
      await ensureService().write(target, current)
      // 索引跟的是文件，与「当前打开的是谁」无关——哪怕用户已经切走了，
      // 刚写进磁盘的这份画板内容也该能被搜到
      void useSearchStore().touch(target)
      // 仍停在同一张画板、且内容没再变，才清脏标记
      if (path.value === target && doc.value === current) dirty.value = false
    } finally {
      saving.value = false
    }
  }

  /** 防抖落盘队列。竞态处理见 stores/autosave.ts */
  const autosave = createAutosave(writeOnce)

  function schedule(): void {
    autosave.schedule(SAVE_DELAY)
  }

  const flush = autosave.flush

  // --- 图元操作 ----------------------------------------------------------

  function addShape(shape: Shape): void {
    apply([...shapes.value, shape])
    selectedIds.value = [shape.id]
  }

  function updateShape(id: string, patch: Partial<Shape>): void {
    apply(
      shapes.value.map((shape) =>
        shape.id === id ? ({ ...shape, ...patch, id: shape.id, kind: shape.kind } as Shape) : shape,
      ),
    )
  }

  /** 批量更新：拖动多选时逐个调用会产生 N 次落盘排期 */
  function updateShapes(updates: ReadonlyArray<{ id: string; patch: Partial<Shape> }>): void {
    const byId = new Map(updates.map((item) => [item.id, item.patch]))
    apply(
      shapes.value.map((shape) => {
        const patch = byId.get(shape.id)
        return patch ? ({ ...shape, ...patch, id: shape.id, kind: shape.kind } as Shape) : shape
      }),
    )
  }

  function removeShapes(ids: readonly string[]): void {
    const set = new Set(ids)
    // 连线的两端指向被删图形时也一并删掉，否则会留下悬空的线
    apply(
      shapes.value.filter((shape) => {
        if (set.has(shape.id)) return false
        if (shape.kind === 'line' || shape.kind === 'arrow') {
          if ((shape.fromId && set.has(shape.fromId)) || (shape.toId && set.has(shape.toId))) return false
        }
        return true
      }),
    )
    selectedIds.value = selectedIds.value.filter((id) => !set.has(id))
  }

  /** 置于顶层 / 底层：SVG 的绘制顺序就是数组顺序 */
  function bringToFront(ids: readonly string[]): void {
    const set = new Set(ids)
    const rest = shapes.value.filter((shape) => !set.has(shape.id))
    const moved = shapes.value.filter((shape) => set.has(shape.id))
    apply([...rest, ...moved])
  }

  function sendToBack(ids: readonly string[]): void {
    const set = new Set(ids)
    const rest = shapes.value.filter((shape) => !set.has(shape.id))
    const moved = shapes.value.filter((shape) => set.has(shape.id))
    apply([...moved, ...rest])
  }

  function invalidate(): void {
    autosave.cancel()
    service.value = null
    doc.value = createEmptyCanvas()
    path.value = null
    dirty.value = false
    selectedIds.value = []
    viewport.value = createViewport()
  }

  function groupSelected(): void {
    if (selectedIds.value.length < 2) return
    apply(groupShapes(shapes.value, selectedIds.value, crypto.randomUUID()))
  }

  function ungroupSelected(): void {
    apply(ungroupShapes(shapes.value, selectedIds.value))
  }

  function ensureService(): CanvasService {
    if (!workspace.storage) throw new Error('尚未打开工作区')
    if (!service.value) service.value = new CanvasService(workspace.storage)
    return service.value
  }

  return {
    doc,
    shapes,
    selected,
    selectedIds,
    viewport,
    path,
    dirty,
    saving,
    contentBounds,

    open,
    close,
    flush,
    addShape,
    updateShape,
    updateShapes,
    removeShapes,
    bringToFront,
    sendToBack,
    groupSelected,
    ungroupSelected,
    invalidate,
  }
})

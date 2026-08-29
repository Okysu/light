import type { Shape } from './types'

/** 点击任一成员时，返回整个未锁定分组；未分组图元只返回自身。 */
export function selectionUnit(shapes: readonly Shape[], id: string): string[] {
  const hit = shapes.find((shape) => shape.id === id)
  if (!hit || hit.locked) return []
  if (!hit.groupId) return [hit.id]
  return shapes
    .filter((shape) => shape.groupId === hit.groupId && !shape.locked)
    .map((shape) => shape.id)
}

/** 右键菜单需要包含锁定成员，才能从完整分组一次性解锁。 */
export function contextUnit(shapes: readonly Shape[], id: string): string[] {
  const hit = shapes.find((shape) => shape.id === id)
  if (!hit) return []
  if (!hit.groupId) return [hit.id]
  return shapes.filter((shape) => shape.groupId === hit.groupId).map((shape) => shape.id)
}

/** 框选命中一个成员时扩展到整个分组。 */
export function expandGroupedSelection(shapes: readonly Shape[], ids: readonly string[]): string[] {
  const result = new Set<string>()
  for (const id of ids) {
    for (const member of selectionUnit(shapes, id)) result.add(member)
  }
  return [...result]
}

export function groupShapes(shapes: readonly Shape[], ids: readonly string[], groupId: string): Shape[] {
  const selected = new Set(ids)
  if (!groupId || selected.size < 2) return [...shapes]
  return shapes.map((shape) => selected.has(shape.id) ? { ...shape, groupId } : shape)
}

/** 解组选中成员所属的完整分组；不会拆出半个组。 */
export function ungroupShapes(shapes: readonly Shape[], ids: readonly string[]): Shape[] {
  const selected = new Set(ids)
  const groups = new Set(
    shapes.filter((shape) => selected.has(shape.id) && shape.groupId).map((shape) => shape.groupId),
  )
  if (groups.size === 0) return [...shapes]
  return shapes.map((shape) => groups.has(shape.groupId) ? { ...shape, groupId: '' } : shape)
}

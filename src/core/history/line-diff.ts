export type DiffKind = 'same' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffKind
  text: string
  oldLine: number | null
  newLine: number | null
}

const MAX_MATRIX_CELLS = 120_000

/** 行级差异。常规笔记走 LCS；超长文本退化为共同前后缀，避免二次方内存。 */
export function lineDiff(previous: string, current: string): DiffLine[] {
  const before = previous.split('\n')
  const after = current.split('\n')
  if (before.length * after.length > MAX_MATRIX_CELLS) return boundedDiff(before, after)

  const width = after.length + 1
  const matrix = new Uint32Array((before.length + 1) * width)
  for (let oldIndex = before.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = after.length - 1; newIndex >= 0; newIndex -= 1) {
      const at = oldIndex * width + newIndex
      matrix[at] = before[oldIndex] === after[newIndex]
        ? (matrix[(oldIndex + 1) * width + newIndex + 1] ?? 0) + 1
        : Math.max(matrix[(oldIndex + 1) * width + newIndex] ?? 0, matrix[oldIndex * width + newIndex + 1] ?? 0)
    }
  }

  const output: DiffLine[] = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < before.length || newIndex < after.length) {
    if (oldIndex < before.length && newIndex < after.length && before[oldIndex] === after[newIndex]) {
      output.push({ kind: 'same', text: before[oldIndex]!, oldLine: oldIndex + 1, newLine: newIndex + 1 })
      oldIndex += 1
      newIndex += 1
    } else if (
      newIndex < after.length
      && (oldIndex >= before.length
        || (matrix[oldIndex * width + newIndex + 1] ?? 0) >= (matrix[(oldIndex + 1) * width + newIndex] ?? 0))
    ) {
      output.push({ kind: 'added', text: after[newIndex]!, oldLine: null, newLine: newIndex + 1 })
      newIndex += 1
    } else {
      output.push({ kind: 'removed', text: before[oldIndex]!, oldLine: oldIndex + 1, newLine: null })
      oldIndex += 1
    }
  }
  return output
}

function boundedDiff(before: string[], after: string[]): DiffLine[] {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1

  const output: DiffLine[] = []
  for (let index = 0; index < prefix; index += 1) {
    output.push({ kind: 'same', text: before[index]!, oldLine: index + 1, newLine: index + 1 })
  }
  for (let index = prefix; index < before.length - suffix; index += 1) {
    output.push({ kind: 'removed', text: before[index]!, oldLine: index + 1, newLine: null })
  }
  for (let index = prefix; index < after.length - suffix; index += 1) {
    output.push({ kind: 'added', text: after[index]!, oldLine: null, newLine: index + 1 })
  }
  for (let offset = suffix; offset > 0; offset -= 1) {
    const oldIndex = before.length - offset
    const newIndex = after.length - offset
    output.push({ kind: 'same', text: before[oldIndex]!, oldLine: oldIndex + 1, newLine: newIndex + 1 })
  }
  return output
}

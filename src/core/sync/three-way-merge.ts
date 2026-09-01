import { lineDiff, type DiffLine } from '../history/line-diff'

interface Edit {
  start: number
  end: number
  lines: string[]
}

export interface ThreeWayMergeResult {
  text: string
  clean: boolean
}

/**
 * Git 风格的行级三方合并：base 是上次同步版本，local / remote 是两个分支。
 * 不相交的改动自动组合；重叠且不同的改动保留标准冲突标记，绝不静默选边。
 */
export function mergeText(base: string, local: string, remote: string): ThreeWayMergeResult {
  if (local === remote) return { text: local, clean: true }
  if (local === base) return { text: remote, clean: true }
  if (remote === base) return { text: local, clean: true }

  const baseLines = base.split('\n')
  const localEdits = editsFromDiff(lineDiff(base, local))
  const remoteEdits = editsFromDiff(lineDiff(base, remote))
  const output: string[] = []
  let localIndex = 0
  let remoteIndex = 0
  let cursor = 0
  let clean = true

  while (localIndex < localEdits.length || remoteIndex < remoteEdits.length) {
    const nextLocal = localEdits[localIndex]
    const nextRemote = remoteEdits[remoteIndex]
    const start = Math.min(nextLocal?.start ?? Infinity, nextRemote?.start ?? Infinity)
    output.push(...baseLines.slice(cursor, start))

    // 一侧在某行前插入、另一侧从该行开始删除/替换时，两项改动并不冲突：
    // 插入内容留下，随后照常处理另一侧的区间改动。
    if (isInsertion(nextLocal) && nextRemote?.start === start && !isInsertion(nextRemote)) {
      output.push(...nextLocal.lines)
      localIndex += 1
      cursor = start
      continue
    }
    if (isInsertion(nextRemote) && nextLocal?.start === start && !isInsertion(nextLocal)) {
      output.push(...nextRemote.lines)
      remoteIndex += 1
      cursor = start
      continue
    }

    let end = start
    const localGroup: Edit[] = []
    const remoteGroup: Edit[] = []
    let changed = true
    while (changed) {
      changed = false
      while (localIndex < localEdits.length && overlaps(localEdits[localIndex]!, start, end)) {
        const edit = localEdits[localIndex++]!
        localGroup.push(edit)
        end = Math.max(end, edit.end)
        changed = true
      }
      while (remoteIndex < remoteEdits.length && overlaps(remoteEdits[remoteIndex]!, start, end)) {
        const edit = remoteEdits[remoteIndex++]!
        remoteGroup.push(edit)
        end = Math.max(end, edit.end)
        changed = true
      }
    }

    const original = baseLines.slice(start, end)
    const localLines = localGroup.length ? applyEdits(baseLines, start, end, localGroup) : original
    const remoteLines = remoteGroup.length ? applyEdits(baseLines, start, end, remoteGroup) : original

    if (sameLines(localLines, remoteLines)) output.push(...localLines)
    else if (sameLines(localLines, original)) output.push(...remoteLines)
    else if (sameLines(remoteLines, original)) output.push(...localLines)
    else {
      clean = false
      output.push('<<<<<<< LOCAL', ...localLines, '||||||| BASE', ...original, '=======', ...remoteLines, '>>>>>>> REMOTE')
    }
    cursor = end
  }

  output.push(...baseLines.slice(cursor))
  return { text: output.join('\n'), clean }
}

function isInsertion(edit: Edit | undefined): edit is Edit {
  return Boolean(edit && edit.start === edit.end)
}

function editsFromDiff(diff: readonly DiffLine[]): Edit[] {
  const edits: Edit[] = []
  let baseIndex = 0
  let current: Edit | null = null

  const flush = () => {
    if (!current) return
    current.end = baseIndex
    edits.push(current)
    current = null
  }

  for (const line of diff) {
    if (line.kind === 'same') {
      flush()
      baseIndex += 1
      continue
    }
    current ??= { start: baseIndex, end: baseIndex, lines: [] }
    if (line.kind === 'removed') baseIndex += 1
    else current.lines.push(line.text)
  }
  flush()
  return edits
}

/** 同一点插入互相重叠；相邻两行的替换则可以独立合并。 */
function overlaps(edit: Edit, start: number, end: number): boolean {
  if (end === start) return edit.start === start
  if (edit.start < end) return true
  return edit.start === start && edit.end === edit.start
}

function applyEdits(base: readonly string[], start: number, end: number, edits: readonly Edit[]): string[] {
  const output: string[] = []
  let cursor = start
  for (const edit of edits) {
    output.push(...base.slice(cursor, edit.start), ...edit.lines)
    cursor = edit.end
  }
  output.push(...base.slice(cursor, end))
  return output
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index])
}

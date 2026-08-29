import type { VersionVector } from './types'

export type VectorRelation = 'equal' | 'before' | 'after' | 'concurrent'

export function compareVectors(left: VersionVector, right: VersionVector): VectorRelation {
  let leftGreater = false
  let rightGreater = false
  const devices = new Set([...Object.keys(left), ...Object.keys(right)])

  for (const device of devices) {
    const a = left[device] ?? 0
    const b = right[device] ?? 0
    if (a > b) leftGreater = true
    if (b > a) rightGreater = true
  }

  if (leftGreater && rightGreater) return 'concurrent'
  if (leftGreater) return 'after'
  if (rightGreater) return 'before'
  return 'equal'
}

export function mergeVectors(...vectors: VersionVector[]): VersionVector {
  const merged: VersionVector = {}
  for (const vector of vectors) {
    for (const [device, counter] of Object.entries(vector)) {
      merged[device] = Math.max(merged[device] ?? 0, counter)
    }
  }
  return merged
}

export function incrementVector(vector: VersionVector, deviceId: string): VersionVector {
  const next = mergeVectors(vector)
  next[deviceId] = (next[deviceId] ?? 0) + 1
  return next
}

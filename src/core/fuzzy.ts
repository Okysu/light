export interface FuzzyResult<T> {
  item: T
  score: number
}

/**
 * 子序列模糊匹配，返回匹配得分；不匹配返回 null。
 *
 * 规则按「用户实际怎么打字」设计：连续命中最能说明意图，其次是词首命中，
 * 再次是整体越短越相关。中文没有词边界，因此不做分词，靠连续性打分即可。
 */
export function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0

  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()

  // 完全包含时直接给高分，位置越靠前越高
  const direct = haystack.indexOf(needle)
  if (direct !== -1) return 1000 - direct * 2 - haystack.length * 0.1

  let score = 0
  let cursor = 0
  let streak = 0

  for (const char of needle) {
    const found = haystack.indexOf(char, cursor)
    if (found === -1) return null

    // 连续命中权重最高，其次是紧跟在分隔符后的词首
    if (found === cursor && cursor > 0) {
      streak += 1
      score += 10 + streak * 3
    } else {
      streak = 0
      score += isWordStart(haystack, found) ? 6 : 1
    }

    cursor = found + 1
  }

  return score - haystack.length * 0.1
}

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true
  const prev = text[index - 1] ?? ''
  return /[\s\-_/.]/.test(prev)
}

/** 按得分降序过滤并排序；query 为空时保持原顺序全量返回 */
export function fuzzyFilter<T>(items: T[], query: string, toText: (item: T) => string): T[] {
  if (!query.trim()) return items

  const scored: FuzzyResult<T>[] = []
  for (const item of items) {
    const score = fuzzyScore(toText(item), query.trim())
    if (score !== null) scored.push({ item, score })
  }

  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.item)
}

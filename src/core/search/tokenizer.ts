/**
 * 分词。
 *
 * MiniSearch 默认按空白与标点切分，这对中文完全无效——「会议纪要」会被当成一个整词，
 * 搜「会议」就搜不到。这里用浏览器原生的 `Intl.Segmenter` 做词级切分，
 * 无需引入词典包（jieba 一类动辄数 MB，与「轻量」定位冲突）。
 *
 * 同时保留 n-gram 兜底：分词器把「时钟同步」切成一个词时，
 * 用户搜「同步」仍应命中，因此对中文片段额外产出二元组。
 */

/** 中日韩统一表意文字及扩展区 */
const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ]/

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('zh-CN', { granularity: 'word' })
    : null

export function containsCjk(text: string): boolean {
  return CJK.test(text)
}

/**
 * 把文本切成检索用的词元。
 *
 * @param text 原始文本
 * @returns 去重后的词元，全部转小写
 */
export function tokenize(text: string): string[] {
  if (!text) return []

  const tokens = new Set<string>()

  const push = (value: string) => {
    const trimmed = value.trim().toLowerCase()
    // 单个西文字母/数字过于常见，作为词元只会拖慢检索且没有区分度；
    // 单个汉字则相反——它本身就可能是一个词，必须保留
    if (!trimmed) return
    if (trimmed.length === 1 && !CJK.test(trimmed)) return
    tokens.add(trimmed)
  }

  if (segmenter) {
    for (const segment of segmenter.segment(text)) {
      if (!segment.isWordLike) continue
      push(segment.segment)

      // 中文词再补二元组，保证「时钟同步」能被「同步」命中
      const word = segment.segment
      if (word.length > 2 && containsCjk(word)) {
        for (let i = 0; i < word.length - 1; i += 1) push(word.slice(i, i + 2))
      }
    }
  } else {
    // 没有 Intl.Segmenter 的环境退化为「西文按非字母数字切分 + 中文二元组」
    for (const part of text.split(/[^\p{L}\p{N}_]+/u)) {
      if (!part) continue
      if (containsCjk(part)) {
        for (let i = 0; i < part.length - 1; i += 1) push(part.slice(i, i + 2))
        if (part.length === 1) push(part)
      } else {
        push(part)
      }
    }
  }

  return [...tokens]
}

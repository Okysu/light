import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/** `---` 围起来的 YAML 头，必须位于文件最开头 */
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export interface ParsedDocument {
  /** frontmatter 键值对；无 frontmatter 时为空对象 */
  data: Record<string, unknown>
  /** 去掉 frontmatter 后的正文 */
  content: string
}

/**
 * 解析带 YAML frontmatter 的 Markdown。
 *
 * 未知字段一律原样保留在 `data` 中并在写回时还原 —— 这是「数据完全可迁移」承诺的一部分：
 * Obsidian、Zettlr 等工具写入的自定义字段不能因为在 Light 里编辑过一次就被抹掉。
 * YAML 非法时降级为「整篇都是正文」，绝不因为头部格式错误而让用户打不开笔记。
 */
export function parseDocument(raw: string): ParsedDocument {
  const match = FRONTMATTER_PATTERN.exec(raw)
  if (!match) return { data: {}, content: raw }

  const content = raw.slice(match[0].length)
  try {
    const parsed = parseYaml(match[1] ?? '')
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { data: {}, content }
    }
    return { data: parsed as Record<string, unknown>, content }
  } catch {
    return { data: {}, content: raw }
  }
}

/** 序列化回文件文本；`data` 为空时不写出空的 `---` 头 */
export function stringifyDocument({ data, content }: ParsedDocument): string {
  if (Object.keys(data).length === 0) return content
  const yaml = stringifyYaml(data, { lineWidth: 0 }).trimEnd()
  return `---\n${yaml}\n---\n${content}`
}

// --- 类型化读取：YAML 内容不可信，逐字段做防御式取值 --------------------

export function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' ? value : undefined
}

export function readBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  const value = data[key]
  return typeof value === 'boolean' ? value : undefined
}

/** 兼容 `tags: [a, b]` 与 `tags: a` 两种写法，后者是 Obsidian 常见简写 */
export function readStringArray(data: Record<string, unknown>, key: string): string[] {
  const value = data[key]
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean)
  return []
}

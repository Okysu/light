const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'form',
  'button',
  'select',
  'textarea',
])

const ALLOWED_TAGS = new Set([
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'strong', 'em', 's', 'a', 'img', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'th', 'td', 'hr', 'input',
])

const TAG_ALIASES: Record<string, string> = {
  b: 'strong',
  i: 'em',
  strike: 's',
  del: 's',
}

function safeUrl(value: string, image: boolean): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  // 站内相对链接与标题锚点应保留；反斜杠和控制字符不属于合法相对 URL。
  if (/^(?:#|\/|\.\/|\.\.\/)/.test(trimmed) && !/[\u0000-\u001f\\]/.test(trimmed)) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed, 'https://light.invalid/')
    const allowed = image
      ? parsed.protocol === 'https:' || parsed.protocol === 'http:'
      : ['https:', 'http:', 'mailto:'].includes(parsed.protocol)
    return allowed ? trimmed : null
  } catch {
    return null
  }
}

function replaceTag(element: Element, tagName: string): Element {
  const replacement = element.ownerDocument.createElement(tagName)
  for (const attribute of [...element.attributes]) {
    replacement.setAttribute(attribute.name, attribute.value)
  }
  replacement.append(...element.childNodes)
  element.replaceWith(replacement)
  return replacement
}

function unwrap(element: Element): void {
  element.replaceWith(...element.childNodes)
}

function convertInlineStyle(element: HTMLElement): void {
  const wrappers: string[] = []
  const weight = element.style.fontWeight.toLowerCase()
  if (weight === 'bold' || /^([6-9]00)$/.test(weight)) wrappers.push('strong')
  if (element.style.fontStyle.toLowerCase() === 'italic') wrappers.push('em')
  if (element.style.textDecorationLine.toLowerCase().includes('line-through')) wrappers.push('s')
  if (!wrappers.length) return

  let container: Element = element
  for (const tag of wrappers) {
    const wrapper = element.ownerDocument.createElement(tag)
    wrapper.append(...container.childNodes)
    container.append(wrapper)
    container = wrapper
  }
}

function cleanAttributes(element: Element, tag: string): void {
  const original = Object.fromEntries([...element.attributes].map(({ name, value }) => [name.toLowerCase(), value]))
  for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name)

  if (tag === 'a') {
    const href = original.href && safeUrl(original.href, false)
    if (href) element.setAttribute('href', href)
    if (original.title) element.setAttribute('title', original.title)
  } else if (tag === 'img') {
    const src = original.src && safeUrl(original.src, true)
    if (src) element.setAttribute('src', src)
    if (original.alt) element.setAttribute('alt', original.alt)
    if (original.title) element.setAttribute('title', original.title)
  } else if (tag === 'ol' && /^\d+$/.test(original.start ?? '')) {
    element.setAttribute('start', original.start!)
  } else if ((tag === 'th' || tag === 'td')) {
    if (/^\d+$/.test(original.colspan ?? '')) element.setAttribute('colspan', original.colspan!)
    if (/^\d+$/.test(original.rowspan ?? '')) element.setAttribute('rowspan', original.rowspan!)
  } else if (tag === 'input' && original.type?.toLowerCase() === 'checkbox') {
    element.setAttribute('type', 'checkbox')
    element.setAttribute('disabled', '')
    if ('checked' in original) element.setAttribute('checked', '')
  }
}

function sanitizeElement(element: Element): void {
  const initialTag = element.tagName.toLowerCase()
  if (DROP_WITH_CONTENT.has(initialTag)) {
    element.remove()
    return
  }

  for (const child of [...element.children]) sanitizeElement(child)

  // 浏览器和办公软件常用 span + style 表示基础格式；先转语义标签，再去掉所有样式。
  convertInlineStyle(element as HTMLElement)

  let tag = TAG_ALIASES[initialTag] ?? initialTag
  if (tag !== initialTag) element = replaceTag(element, tag)

  if (!ALLOWED_TAGS.has(tag)) {
    unwrap(element)
    return
  }

  cleanAttributes(element, tag)

  // 非复选框 input 没有可转换为 Markdown 的语义，直接移除。
  if (tag === 'input' && element.getAttribute('type') !== 'checkbox') element.remove()
  // 没有安全来源的图片只会留下裂图，占位文本交给 alt；这里直接展开为文本。
  if (tag === 'img' && !element.hasAttribute('src')) element.replaceWith(element.getAttribute('alt') ?? '')
}

/**
 * 清洗外部富文本后再交给 ProseMirror 的 schema 转为 Markdown。
 * 保留标题、列表、表格与基础行内格式；移除脚本、事件属性、样式和危险 URL。
 */
export function sanitizePastedHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  for (const child of [...document.body.children]) sanitizeElement(child)

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT)
  const comments: Comment[] = []
  while (walker.nextNode()) comments.push(walker.currentNode as Comment)
  comments.forEach((comment) => comment.remove())
  return document.body.innerHTML
}

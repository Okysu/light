/**
 * 工作区内部一律使用 POSIX 风格的「相对路径」（相对工作区根，无前导斜杠）。
 * 平台差异（Windows 反斜杠、OPFS 目录句柄）由各 StorageAdapter 自行消化，
 * 领域层与 UI 层永远只见到 `notes/项目/会议纪要.md` 这种形式。
 */

/** 归一化：反斜杠转正斜杠、折叠重复斜杠、消解 `.` 与 `..`、去掉首尾斜杠 */
export function normalizePath(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/')
  const stack: string[] = []

  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      stack.pop()
      continue
    }
    stack.push(segment)
  }

  return stack.join('/')
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.join('/'))
}

/** 父目录路径；根目录的父目录仍是根（空字符串） */
export function dirname(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  return index === -1 ? '' : normalized.slice(0, index)
}

/** 文件名（含扩展名） */
export function basename(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  return index === -1 ? normalized : normalized.slice(index + 1)
}

/** 扩展名，含点号；无扩展名返回空字符串 */
export function extname(path: string): string {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index)
}

/** 去掉扩展名的文件名，用作笔记标题的兜底来源 */
export function stem(path: string): string {
  const name = basename(path)
  const ext = extname(name)
  return ext ? name.slice(0, -ext.length) : name
}

/** 拆成路径段数组，供 OPFS 逐级获取目录句柄 */
export function segments(path: string): string[] {
  const normalized = normalizePath(path)
  return normalized === '' ? [] : normalized.split('/')
}

/** child 是否位于 parent 之下（parent 为空表示工作区根，恒为真） */
export function isDescendant(parent: string, child: string): boolean {
  const p = normalizePath(parent)
  const c = normalizePath(child)
  if (p === '') return c !== ''
  return c.startsWith(`${p}/`)
}

/**
 * 把用户输入的标题转成安全的文件名。
 * 以 Windows 的限制为基准（最严格），保证同一个 Vault 在三端都能落盘：
 * 非法字符替换、控制字符剔除、末尾点号去除（Windows 不接受）、长度截断。
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '_')
    // eslint-disable-next-line no-control-regex -- 文件名中的控制字符必须剔除
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/, '')
}

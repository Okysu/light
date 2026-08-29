import {
  parseDocument,
  readBoolean,
  readString,
  readStringArray,
  stringifyDocument,
} from '../markdown/frontmatter'
import { dirname, normalizePath, stem } from '../path'
import type { StorageAdapter } from '../storage'
import { extensionFor, kindOf, type FileKind } from './tree'
import { uniquePath } from './unique-path'
import { isProtectedText, preserveProtection, readProtectedText } from '../security/local-vault'

export interface Note {
  /** 相对工作区根的路径，同时是笔记在树中的主键 */
  path: string
  /** frontmatter 中的稳定 ID：文件改名或移动后引用仍然有效 */
  id: string
  title: string
  tags: string[]
  favorite: boolean
  createdAt: number
  updatedAt: number
  /** 正文（不含 frontmatter） */
  content: string
  /** 原始 frontmatter，写回时原样保留未知字段 */
  frontmatter: Record<string, unknown>
  /** 文件正文是否以本地敏感笔记格式加密。 */
  sensitive?: boolean
}

export interface NotePatch {
  content?: string
  title?: string
  tags?: string[]
  favorite?: boolean
  /**
   * 任意 frontmatter 字段。
   * 值为 `undefined` 表示删除该字段——属性表单里「清空一个属性」就该把它从文件里去掉，
   * 而不是留下一个空值。
   */
  properties?: Record<string, unknown>
}

/**
 * 笔记读写仓储。
 *
 * 单一职责：只负责「单篇笔记 ↔ 磁盘文件」的映射与生命周期，
 * 不做索引、不做搜索、不做回收站——那些是各自独立的服务，共用同一个 StorageAdapter。
 */
export class NoteRepository {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly now: () => number = () => Date.now(),
    private readonly newId: () => string = defaultId,
  ) {}

  async read(path: string): Promise<Note> {
    const stored = await this.storage.readText(path)
    const raw = await readProtectedText(stored)
    const { data, content } = parseDocument(raw)
    const stat = await this.storage.stat(path).catch(() => null)

    return {
      path,
      id: readString(data, 'id') ?? '',
      title: readString(data, 'title') ?? stem(path),
      tags: readStringArray(data, 'tags'),
      favorite: readBoolean(data, 'favorite') ?? false,
      createdAt: parseTime(readString(data, 'created')) ?? stat?.createdAt ?? stat?.modifiedAt ?? 0,
      updatedAt: parseTime(readString(data, 'updated')) ?? stat?.modifiedAt ?? 0,
      content,
      frontmatter: data,
      sensitive: isProtectedText(stored),
    }
  }

  /**
   * 增量写入。只覆盖 patch 中出现的字段，其余（含第三方工具写的未知字段）原样保留。
   * 返回写入后的笔记，调用方无需再读一次。
   */
  async write(path: string, patch: NotePatch): Promise<Note> {
    const current = await this.read(path)
    const timestamp = this.now()

    const frontmatter: Record<string, unknown> = { ...current.frontmatter }
    frontmatter['id'] = current.id || this.newId()
    if (patch.title !== undefined) frontmatter['title'] = patch.title
    if (patch.tags !== undefined) frontmatter['tags'] = patch.tags
    if (patch.favorite !== undefined) frontmatter['favorite'] = patch.favorite

    for (const [key, value] of Object.entries(patch.properties ?? {})) {
      if (value === undefined) delete frontmatter[key]
      else frontmatter[key] = value
    }
    if (!frontmatter['created']) frontmatter['created'] = toIso(current.createdAt || timestamp)
    frontmatter['updated'] = toIso(timestamp)

    const content = patch.content ?? current.content
    const previousRaw = await this.storage.readText(path)
    await this.storage.writeText(path, await preserveProtection(previousRaw, stringifyDocument({ data: frontmatter, content })))

    return {
      ...current,
      ...patch,
      path,
      id: frontmatter['id'] as string,
      updatedAt: timestamp,
      content,
      frontmatter,
      // patch 里的 tags 可能来自 properties，统一以最终 frontmatter 为准
      tags: readStringArray(frontmatter, 'tags'),
    }
  }

  /**
   * 在指定目录下新建条目。同名时自动追加 `(2)`、`(3)` 后缀而非静默覆盖。
   * @returns 实际创建的路径
   */
  async create(
    dir: string,
    title: string,
    kind: FileKind = 'note',
    initialContent = '',
  ): Promise<string> {
    const path = await this.uniquePath(dir, title || '未命名', extensionFor(kind))

    if (kind === 'note') {
      const timestamp = this.now()
      const data = {
        id: this.newId(),
        title: stem(path),
        created: toIso(timestamp),
        updated: toIso(timestamp),
        tags: [] as string[],
      }
      // 正文以 `# 标题` 开头：界面上的标题栏读的是首个 H1（见 core/markdown/title.ts），
      // 只写 frontmatter.title 的话，新建的笔记文件名有了、标题栏却是空的。
      // 无标题时不写，否则「未命名」会从占位符变成真实内容。
      const heading = title.trim() ? `# ${stem(path)}\n\n` : ''
      await this.storage.writeText(path, stringifyDocument({ data, content: heading + initialContent }))
    } else {
      /**
       * 看板 / 画板是 JSON 文档，结构由各自的模块定义，因此由调用方通过
       * `initialContent` 传进来。
       *
       * 这里不再自作主张写一个 `{ items: [] }` 的「最小骨架」——那个字段名
       * 两边都不认，文件一落盘就是格式不对的。虽然读取时的归一化会兜住它，
       * 但用户在文件管理器里看到的、以及用别的工具打开的，就是那份错的。
       */
      const skeleton = initialContent.trim() || JSON.stringify({ version: 1, kind }, null, 2)
      await this.storage.writeText(path, skeleton)
    }

    return path
  }

  async createFolder(dir: string, name: string): Promise<string> {
    const path = await this.uniquePath(dir, name || '未命名文件夹', '')
    await this.storage.mkdir(path)
    return path
  }

  /** 重命名：同时更新文件名与 frontmatter.title，保持两者一致 */
  async rename(path: string, newTitle: string): Promise<string> {
    const kind = kindOf(path)
    const ext = kind ? extensionFor(kind) : ''
    const target = await this.uniquePath(dirname(path), newTitle, ext)
    if (target === path) return path

    await this.storage.move(path, target)
    if (kind === 'note') {
      await this.write(target, { title: stem(target) })
    }
    return target
  }

  /** 移动到另一目录，文件名不变；目标同名时同样走避让后缀 */
  async move(path: string, targetDir: string): Promise<string> {
    // 拖回当前所在目录不是一次“产生新文件”的操作。必须在 uniquePath 之前返回，
    // 否则源文件本身会被当成同名冲突，凭空改成 `文件 (2)`。
    if (dirname(path) === normalizePath(targetDir)) return path

    const kind = kindOf(path)
    const ext = kind ? extensionFor(kind) : ''
    const target = await this.uniquePath(targetDir, stem(path), ext)
    await this.storage.move(path, target)
    return target
  }

  /** 创建副本，命名为「原名 副本」 */
  async duplicate(path: string): Promise<string> {
    const kind = kindOf(path)
    const ext = kind ? extensionFor(kind) : ''
    const target = await this.uniquePath(dirname(path), `${stem(path)} 副本`, ext)
    await this.storage.writeBinary(target, await this.storage.readBinary(path))

    if (kind === 'note') {
      // 副本必须换新 ID，否则双向链接会指向两个文件
      const copy = await this.read(target)
      const frontmatter = { ...copy.frontmatter, id: this.newId(), title: stem(target) }
      const copiedRaw = await this.storage.readText(target)
      await this.storage.writeText(
        target,
        await preserveProtection(copiedRaw, stringifyDocument({ data: frontmatter, content: copy.content })),
      )
    }
    return target
  }

  /** 避让规则与导入等其它「产生新文件」的路径共用一份实现 */
  private uniquePath(dir: string, rawName: string, ext: string): Promise<string> {
    return uniquePath(this.storage, dir, rawName, ext)
  }
}

function defaultId(): string {
  return crypto.randomUUID()
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString()
}

function parseTime(value: string | undefined): number | undefined {
  if (!value) return undefined
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : time
}

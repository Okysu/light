import type { NoteRepository } from '../workspace/note-repository'
import { resolveWikilink, rewriteWikilinks, wikilinkTargetFor } from './wikilink'

/**
 * 笔记改名 / 移动后，让指向它的链接跟上。
 *
 * 不做这件事的后果不是报错，而是**静默失效**：`[[旧名]]` 变成一条指向
 * 「尚未创建」的链接，点一下还会好心地建出一篇同名空笔记。用户很难把这
 * 归因到几步之前的那次改名。
 *
 * 单独成一层而不是塞进 NoteRepository：改名是单个文件的事，改写引用是全库的事，
 * 两者的失败后果也不同——改写失败不该让改名回滚（文件已经移走了）。
 */
export class LinkRewriter {
  constructor(private readonly notes: NoteRepository) {}

  /**
   * 把指向 `from` 的链接改写为指向 `to`。
   *
   * `pathsBefore` / `pathsAfter` 必须分别传：前者用来判断某条链接是否**真的**
   * 指向被改名的那篇（`[[笔记]]` 可能指向另一个同名文件），后者用来决定新目标
   * 要不要带上路径（改完之后才知道会不会重名）。
   *
   * @param sources 需要检查的笔记，通常来自链接图的反向索引
   * @returns 实际被改动的笔记路径
   */
  async retarget(options: {
    sources: readonly string[]
    from: string
    to: string
    pathsBefore: readonly string[]
    pathsAfter: readonly string[]
  }): Promise<string[]> {
    const { sources, from, to, pathsBefore, pathsAfter } = options
    if (from === to || sources.length === 0) return []

    const nextTarget = wikilinkTargetFor(to, pathsAfter)
    const changed: string[] = []

    for (const source of sources) {
      // 被改名的那篇自己也可能引用了自己之外的东西，但它的链接不受这次改名影响
      if (source === from) continue

      try {
        const note = await this.notes.read(source)
        const rewritten = rewriteWikilinks(note.content, (ref) =>
          resolveWikilink(ref.target, pathsBefore) === from ? nextTarget : null,
        )

        if (rewritten !== note.content) {
          await this.notes.write(source, { content: rewritten })
          changed.push(source)
        }
      } catch {
        // 单篇读写失败不该让整批改写中断——其余引用仍然值得修好
        continue
      }
    }

    return changed
  }
}

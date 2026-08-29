/**
 * 防抖落盘队列。
 *
 * 三种文档（笔记、看板、画板）都要「改动后延迟写盘、切换前强制写完」，
 * 而这段逻辑里藏着一个不容易发现的竞态：
 *
 * > 已经有一次写入在飞行中时，`flush()` 若只是「没在保存就存一次」，
 * > 它会立刻返回。调用方以为写完了，随即切换文档；而那次飞行中的写入
 * > 回来后仍会把状态回写到已经换了主人的 store 上。
 *
 * 表现就是「刚切过去的标签页，内容被上一篇替换了」。
 *
 * 因此把队列单独抽出来：竞态只有一处实现，三个 store 共用。
 */
export interface Autosave {
  /** 排期一次延迟写入；重复调用会重置计时 */
  schedule: (delay: number) => void
  /** 立即写一次。已有写入在飞时复用它，不会并发写同一个文件 */
  save: () => Promise<void>
  /**
   * 确保内容已经落盘。
   *
   * 两步：先等飞行中的那次写完，再补一次——飞行中的那次用的是**更早的**快照，
   * 它完成时用户可能又改了内容。少了第二步，切换文档会吞掉最后一次
   * 防抖窗口里的输入。
   */
  flush: () => Promise<void>
  /** 取消尚未触发的排期，不影响飞行中的写入 */
  cancel: () => void
}

/**
 * @param run 实际的写入。它自己负责判断「是否需要保存」并定格快照——
 *   路径、内容这些必须在进入异步之前取好，等 await 回来时它们
 *   可能已经属于另一个文档了。
 */
export function createAutosave(run: () => Promise<void>): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<void> | null = null

  function cancel(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function save(): Promise<void> {
    if (inflight) return inflight

    inflight = run().finally(() => {
      inflight = null
    })

    return inflight
  }

  function schedule(delay: number): void {
    cancel()
    timer = setTimeout(() => {
      timer = null
      void save()
    }, delay)
  }

  async function flush(): Promise<void> {
    cancel()
    await inflight
    await save()
  }

  return { schedule, save, flush, cancel }
}

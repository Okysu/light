import { describe, expect, it, vi } from 'vitest'
import { createAutosave } from './autosave'

/** 可手动兑现的 Promise，用来精确控制「写入还在飞行中」这个时刻 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('createAutosave', () => {
  it('schedule 延迟后触发写入', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => {})
    const autosave = createAutosave(run)

    autosave.schedule(100)
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('重复 schedule 只触发一次，计时被重置', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => {})
    const autosave = createAutosave(run)

    autosave.schedule(100)
    await vi.advanceTimersByTimeAsync(50)
    autosave.schedule(100)
    await vi.advanceTimersByTimeAsync(50)
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(50)
    expect(run).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('cancel 后不再触发', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => {})
    const autosave = createAutosave(run)

    autosave.schedule(100)
    autosave.cancel()
    await vi.advanceTimersByTimeAsync(200)
    expect(run).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  /** 并发写同一个文件会让后写的覆盖先写的，顺序还不确定 */
  it('已有写入在飞时，save 复用它而不是再起一次', async () => {
    const gate = deferred()
    const run = vi.fn(() => gate.promise)
    const autosave = createAutosave(run)

    const first = autosave.save()
    const second = autosave.save()

    expect(run).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)

    gate.resolve()
    await first
  })

  /**
   * 这条是整个模块存在的理由。
   *
   * flush 若在「已有写入在飞」时立刻返回，调用方会以为写完了并切换文档，
   * 而那次飞行中的写入回来后仍会回写状态——表现就是切过去的标签页
   * 内容被上一篇替换。
   */
  it('flush 会等待飞行中的写入，而不是立刻返回', async () => {
    const gate = deferred()
    let finished = false
    const run = vi.fn(async () => {
      await gate.promise
      finished = true
    })
    const autosave = createAutosave(run)

    void autosave.save()
    const flushed = autosave.flush()

    // 尚未兑现：flush 不该在这里就返回
    await Promise.resolve()
    expect(finished).toBe(false)

    gate.resolve()
    await flushed
    expect(finished).toBe(true)
  })

  /**
   * 飞行中的那次用的是更早的快照。
   * 少了「等完再补一次」，切换文档会吞掉最后一次防抖窗口里的输入。
   */
  it('flush 在等完飞行中的写入后会再写一次', async () => {
    const gate = deferred()
    let calls = 0
    const run = vi.fn(async () => {
      calls += 1
      if (calls === 1) await gate.promise
    })
    const autosave = createAutosave(run)

    void autosave.save()
    const flushed = autosave.flush()
    gate.resolve()
    await flushed

    expect(calls).toBe(2)
  })

  it('flush 会取消尚未触发的排期，不会多写一次', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => {})
    const autosave = createAutosave(run)

    autosave.schedule(100)
    await autosave.flush()
    await vi.advanceTimersByTimeAsync(200)

    expect(run).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  /** 写入失败不该让队列卡死——之后的保存必须还能进行 */
  it('写入抛错后队列仍可继续', async () => {
    let shouldFail = true
    const run = vi.fn(async () => {
      if (shouldFail) throw new Error('写入失败')
    })
    const autosave = createAutosave(run)

    await expect(autosave.save()).rejects.toThrow('写入失败')

    shouldFail = false
    await expect(autosave.save()).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledTimes(2)
  })
})

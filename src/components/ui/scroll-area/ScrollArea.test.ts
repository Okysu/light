import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 这里不测「能不能滚」——jsdom 不做布局，`scrollHeight` 永远是 0，
 * 任何断言都会通过，那种测试只会给人虚假的安全感（第 14 轮已经吃过一次亏）。
 *
 * 也不引入 `@vue/test-utils`：为断言几个类名装一整套组件测试框架不划算。
 * 直接读源码断言约束，能守住的东西是一样的，且明说了自己只是文本检查。
 *
 * 守的是**结构性约束**：viewport 的高度必须由 flex 分配，不能来自百分比。
 * `h-full`（height: 100%）在「父级高度是 max-height 截出来的」场景下无法解析，
 * viewport 会长得和内容一样高、滚动条就此消失——命令面板正是这种情形。
 */
const SOURCE = readFileSync(new URL('./ScrollArea.vue', import.meta.url), 'utf8')

/** 取出 `<ScrollAreaViewport :class="cn(...)">` 里那串默认类名 */
const VIEWPORT_CLASSES = /ScrollAreaViewport :class="cn\('([^']+)'/.exec(SOURCE)?.[1] ?? ''
const ROOT_CLASSES = /:class="cn\('([^']*flex[^']*)'/.exec(SOURCE)?.[1] ?? ''

describe('ScrollArea 的布局约束', () => {
  it('viewport 靠 flex 拿高度，不用 h-full', () => {
    expect(VIEWPORT_CLASSES).not.toBe('')
    expect(VIEWPORT_CLASSES.split(' ')).toContain('flex-1')
    // min-h-0 缺了的话 flex 项的自动最小尺寸会撑住它，照样压不下来
    expect(VIEWPORT_CLASSES.split(' ')).toContain('min-h-0')
    expect(VIEWPORT_CLASSES.split(' ')).not.toContain('h-full')
  })

  it('root 是 flex 列容器——viewport 的 flex-1 才有意义', () => {
    expect(ROOT_CLASSES.split(' ')).toEqual(
      expect.arrayContaining(['relative', 'flex', 'flex-col', 'overflow-hidden']),
    )
  })

  it('两处都把外部类名拼在默认值之后，调用方才能覆盖', () => {
    expect(SOURCE).toContain('props.class)')
    expect(SOURCE).toContain('props.viewportClass)')
  })
})

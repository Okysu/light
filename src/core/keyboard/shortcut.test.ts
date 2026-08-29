import { describe, expect, it } from 'vitest'
import { DESKTOP_SHORTCUT_BINDINGS, SHORTCUT_BINDINGS } from './bindings'
import {
  findShortcutConflict,
  formatShortcut,
  matchesShortcut,
  parseShortcut,
  resolveShortcut,
  shortcutFromKeyPress,
  shortcutIdentity,
  type KeyPress,
} from './shortcut'

/** 构造一次按键。用纯对象而不是 KeyboardEvent——这层不该需要 DOM 环境 */
function key(
  value: string,
  modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyPress {
  return {
    key: value,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
  }
}

describe('parseShortcut', () => {
  it('拆出修饰键与主键', () => {
    expect(parseShortcut('Mod+Shift+K')).toEqual({ mod: true, shift: true, alt: false, key: 'k' })
  })

  it('无修饰键的具名键', () => {
    expect(parseShortcut('Escape')).toEqual({ mod: false, shift: false, alt: false, key: 'escape' })
  })

  it('反斜杠这类符号键不被当成分隔符吃掉', () => {
    expect(parseShortcut('Mod+\\').key).toBe('\\')
  })
})

describe('matchesShortcut', () => {
  it('Ctrl 与 Cmd 都算 Mod，一份定义跨平台', () => {
    expect(matchesShortcut(key('k', { ctrl: true }), 'Mod+K')).toBe(true)
    expect(matchesShortcut(key('k', { meta: true }), 'Mod+K')).toBe(true)
  })

  it('大小写无关', () => {
    expect(matchesShortcut(key('K', { ctrl: true }), 'Mod+k')).toBe(true)
  })

  /**
   * 这条是这层存在的主要理由：修饰键必须精确匹配。
   * 若写成「包含即可」，按下 Ctrl+Shift+K 会同时触发 Mod+K 与 Mod+Shift+K，
   * 表现为「一次按键打开了两个面板」，而且极难定位。
   */
  it('多余的修饰键不算匹配', () => {
    expect(matchesShortcut(key('k', { ctrl: true, shift: true }), 'Mod+K')).toBe(false)
    expect(matchesShortcut(key('k', { ctrl: true, alt: true }), 'Mod+K')).toBe(false)
  })

  it('缺少修饰键不算匹配', () => {
    expect(matchesShortcut(key('k'), 'Mod+K')).toBe(false)
    expect(matchesShortcut(key('k', { ctrl: true }), 'Mod+Shift+K')).toBe(false)
  })

  it('主键不同不算匹配', () => {
    expect(matchesShortcut(key('j', { ctrl: true }), 'Mod+K')).toBe(false)
  })

  it('Escape 无需修饰键', () => {
    expect(matchesShortcut(key('Escape'), 'Escape')).toBe(true)
    expect(matchesShortcut(key('Escape', { ctrl: true }), 'Escape')).toBe(false)
  })
})

describe('formatShortcut', () => {
  it('Windows / Linux 显示 Ctrl', () => {
    expect(formatShortcut('Mod+Shift+K', false)).toBe('Ctrl + Shift + K')
  })

  it('macOS 显示 ⌘ 与 ⌥', () => {
    expect(formatShortcut('Mod+Alt+K', true)).toBe('⌘ + ⌥ + K')
  })

  it('具名键用惯用写法而不是原始值', () => {
    expect(formatShortcut('Escape', false)).toBe('Esc')
    expect(formatShortcut('Mod+Shift+Space', false)).toBe('Ctrl + Shift + Space')
  })
})

describe('shortcutFromKeyPress', () => {
  it('把 Ctrl / Cmd 录成跨平台的 Mod', () => {
    expect(shortcutFromKeyPress(key('k', { ctrl: true, shift: true }))).toBe('Mod+Shift+K')
    expect(shortcutFromKeyPress(key('k', { meta: true }))).toBe('Mod+K')
  })

  it('支持空格、加号和方向键等不能直接序列化的键', () => {
    expect(shortcutFromKeyPress(key(' ', { ctrl: true }))).toBe('Mod+Space')
    expect(shortcutFromKeyPress(key('+', { ctrl: true }))).toBe('Mod+Plus')
    expect(shortcutFromKeyPress(key('ArrowLeft', { alt: true }))).toBe('Alt+ArrowLeft')
  })

  it('拒绝修饰键本身与会拦截普通输入的裸按键', () => {
    expect(shortcutFromKeyPress(key('Control', { ctrl: true }))).toBeNull()
    expect(shortcutFromKeyPress(key('a'))).toBeNull()
    expect(shortcutFromKeyPress(key('A', { shift: true }))).toBeNull()
  })

  it('允许 Esc 与功能键单独使用', () => {
    expect(shortcutFromKeyPress(key('Escape'))).toBe('Escape')
    expect(shortcutFromKeyPress(key('F12'))).toBe('F12')
  })
})

describe('自定义映射', () => {
  it('有覆盖项时使用覆盖值，否则回退内置值', () => {
    const binding = SHORTCUT_BINDINGS[0]!
    expect(resolveShortcut(binding, {})).toBe(binding.keys)
    expect(resolveShortcut(binding, { [binding.id]: 'Mod+P' })).toBe('Mod+P')
  })

  it('冲突比较不受大小写与序列化别名影响', () => {
    expect(shortcutIdentity('Mod+Shift+K')).toBe(shortcutIdentity('mod+shift+k'))
    expect(shortcutIdentity('Mod+Plus')).toBe(shortcutIdentity('mod+plus'))
  })

  it('按当前有效映射检测冲突，并排除正在编辑的条目本身', () => {
    const first = SHORTCUT_BINDINGS[0]!
    const second = SHORTCUT_BINDINGS[1]!
    const overrides = { [first.id]: 'Mod+P' }
    expect(findShortcutConflict(second.id, 'Mod+P', SHORTCUT_BINDINGS, overrides)?.id).toBe(first.id)
    expect(findShortcutConflict(first.id, 'Mod+P', SHORTCUT_BINDINGS, overrides)).toBeUndefined()
  })
})

describe('内置快捷键清单', () => {
  const all = [...SHORTCUT_BINDINGS, ...DESKTOP_SHORTCUT_BINDINGS]

  it('id 不重复——App.vue 靠 id 派发动作，重复会静默丢掉一个', () => {
    expect(new Set(all.map((binding) => binding.id)).size).toBe(all.length)
  })

  it('组合键不重复——同一次按键触发两个动作是最难查的那类 bug', () => {
    const keys = all.map((binding) => binding.keys.toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('每条都能被格式化出可读文本，设置页不会出现空白行', () => {
    for (const binding of all) {
      expect(formatShortcut(binding.keys, false)).not.toBe('')
      expect(binding.labelKey).not.toBe('')
    }
  })
})

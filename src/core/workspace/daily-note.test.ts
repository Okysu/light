import { describe, expect, it } from 'vitest'
import { dailyNoteContent, dailyNotePath, formatDate } from './daily-note'

/** 2026-08-29 本地时间 23:30——刻意选在跨 UTC 日界的时刻 */
const LATE_NIGHT = new Date(2026, 7, 29, 23, 30)

describe('formatDate', () => {
  it('替换 YYYY / MM / DD 并补零', () => {
    expect(formatDate(new Date(2026, 0, 5), 'YYYY-MM-DD')).toBe('2026-01-05')
  })

  it('用本地时间而不是 UTC——晚上写下的东西属于今天', () => {
    // 东八区的 23:30 在 UTC 已是次日，toISOString() 会算成 08-30
    expect(formatDate(LATE_NIGHT, 'YYYY-MM-DD')).toBe('2026-08-29')
  })

  it('同一个占位符出现多次全部替换', () => {
    expect(formatDate(LATE_NIGHT, 'YYYY/MM/YYYY-MM-DD')).toBe('2026/08/2026-08-29')
  })
})

describe('dailyNotePath', () => {
  it('拼成目录下的 .md', () => {
    expect(dailyNotePath(LATE_NIGHT, '日记', 'YYYY-MM-DD')).toBe('日记/2026-08-29.md')
  })

  it('格式串里的斜杠变成子目录', () => {
    expect(dailyNotePath(LATE_NIGHT, '日记', 'YYYY/MM/DD')).toBe('日记/2026/08/29.md')
  })

  it('目录留空则放在根目录', () => {
    expect(dailyNotePath(LATE_NIGHT, '', 'YYYY-MM-DD')).toBe('2026-08-29.md')
  })

  it('格式串留空退回默认，而不是产出一个叫 .md 的文件', () => {
    expect(dailyNotePath(LATE_NIGHT, '日记', '   ')).toBe('日记/2026-08-29.md')
  })

  it('同一天的两次调用得到同一个路径——日记的整个前提', () => {
    const morning = new Date(2026, 7, 29, 8, 0)
    expect(dailyNotePath(morning, '日记', 'YYYY-MM-DD')).toBe(
      dailyNotePath(LATE_NIGHT, '日记', 'YYYY-MM-DD'),
    )
  })
})

describe('dailyNoteContent', () => {
  it('只给一个日期标题，不预设小标题模板', () => {
    expect(dailyNoteContent(LATE_NIGHT)).toBe('# 2026-08-29\n\n')
  })
})

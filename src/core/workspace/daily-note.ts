import { joinPath } from '../path'

/**
 * 每日笔记（需求 11.3）。
 *
 * 只做一件事：把「今天」换算成一个确定的文件路径。有了它，「打开今天的日记」
 * 就是「打开某个路径的笔记，没有就新建」——不需要任何额外的索引或记录。
 * 这是文件即真源的直接好处：日记不是一种特殊的东西，只是名字有规律的笔记。
 */

/** 默认放在 `日记/` 下，按 `YYYY-MM-DD` 命名 */
export const DEFAULT_DAILY_FOLDER = '日记'
export const DEFAULT_DAILY_FORMAT = 'YYYY-MM-DD'

/**
 * 按格式串渲染日期。
 *
 * 支持 `YYYY MM DD` 与 `/`——格式串里带斜杠就意味着按年月分子目录，
 * 例如 `YYYY/MM/YYYY-MM-DD` → `2026/08/2026-08-29`。这比再加一个
 * 「是否按年份分文件夹」的开关简单：一个字段表达全部意图。
 *
 * 用本地时间而非 UTC。晚上 11 点写下的东西属于今天，而 `toISOString()`
 * 在东八区会把它算成明天——日记差一天是那种事后极难发现的错。
 */
export function formatDate(date: Date, format: string): string {
  const pad = (value: number): string => String(value).padStart(2, '0')

  return format
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()))
}

/** 今天（或指定日期）的日记路径 */
export function dailyNotePath(date: Date, folder: string, format: string): string {
  const name = formatDate(date, format.trim() || DEFAULT_DAILY_FORMAT)
  return `${joinPath(folder.trim(), name)}.md`
}

/**
 * 新建日记的初始正文。
 *
 * 只给一个标题，不给「今日待办 / 今日总结」这类小标题模板：
 * 预设的结构写着不用会心虚，而每个人记日记的方式都不一样。
 * 想要模板的人可以自己在第一篇里写好，之后复制。
 */
export function dailyNoteContent(date: Date): string {
  return `# ${formatDate(date, 'YYYY-MM-DD')}\n\n`
}

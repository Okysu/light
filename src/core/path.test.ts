import { describe, expect, it } from 'vitest'
import { basename, dirname, extname, isDescendant, joinPath, normalizePath, sanitizeFileName, stem } from './path'

describe('normalizePath', () => {
  it('把 Windows 反斜杠统一为 POSIX 正斜杠', () => {
    expect(normalizePath('notes\\项目\\会议.md')).toBe('notes/项目/会议.md')
  })

  it('折叠重复斜杠并去掉首尾斜杠', () => {
    expect(normalizePath('/notes//a/')).toBe('notes/a')
  })

  it('消解 . 与 ..，防止路径逃逸出工作区', () => {
    expect(normalizePath('notes/./a/../b.md')).toBe('notes/b.md')
    expect(normalizePath('../../etc/passwd')).toBe('etc/passwd')
  })
})

describe('路径分解', () => {
  it('dirname 在顶层返回空字符串', () => {
    expect(dirname('a.md')).toBe('')
    expect(dirname('notes/a.md')).toBe('notes')
  })

  it('basename / stem / extname 处理多点文件名', () => {
    expect(basename('notes/看板.board')).toBe('看板.board')
    expect(stem('notes/v1.2.notes.md')).toBe('v1.2.notes')
    expect(extname('notes/v1.2.notes.md')).toBe('.md')
  })

  it('隐藏文件的前导点不算扩展名', () => {
    expect(extname('.gitignore')).toBe('')
    expect(stem('.gitignore')).toBe('.gitignore')
  })
})

describe('joinPath', () => {
  it('忽略空段', () => {
    expect(joinPath('', 'a.md')).toBe('a.md')
    expect(joinPath('notes', '', 'a.md')).toBe('notes/a.md')
  })
})

describe('isDescendant', () => {
  it('空 parent 表示工作区根，包含一切非根路径', () => {
    expect(isDescendant('', 'a.md')).toBe(true)
    expect(isDescendant('', '')).toBe(false)
  })

  it('前缀相同但不同目录不算后代', () => {
    expect(isDescendant('notes', 'notes-old/a.md')).toBe(false)
    expect(isDescendant('notes', 'notes/a.md')).toBe(true)
  })
})

describe('sanitizeFileName', () => {
  it('替换文件系统非法字符', () => {
    expect(sanitizeFileName('a/b:c*d?"<>|')).toBe('a_b_c_d_____')
  })

  it('压缩空白并裁剪首尾', () => {
    expect(sanitizeFileName('  项目   周报  ')).toBe('项目 周报')
  })

  it('去掉末尾点号（Windows 不接受以点结尾的文件名）', () => {
    expect(sanitizeFileName('版本 1.0.')).toBe('版本 1.0')
  })

  it('剔除控制字符', () => {
    expect(sanitizeFileName('标题')).toBe('标题')
  })

  it('全是非法字符时留给上层兜底为空串', () => {
    expect(sanitizeFileName('...')).toBe('')
  })
})

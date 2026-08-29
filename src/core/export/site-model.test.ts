import { describe, expect, it } from 'vitest'
import { buildSiteModel, relativeHref, resolveSiteHref, siteHrefFor } from './site-model'

const SOURCES = [
  { path: '笔记.md', raw: '---\nid: a\ntitle: 前言\n---\n# 首页\n\n正文，见 [[项目/计划]]。\n' },
  { path: '项目/计划.md', raw: '---\nid: b\n---\n# 计划\n\n回到 [[笔记]]。\n' },
  { path: '项目/归档/旧稿.md', raw: '没有标题的笔记' },
]

describe('siteHrefFor', () => {
  it('保留目录结构，只换扩展名', () => {
    expect(siteHrefFor('项目/归档/旧稿.md')).toBe('项目/归档/旧稿.html')
  })
})

describe('buildSiteModel', () => {
  const model = buildSiteModel(SOURCES)

  it('每篇笔记一个页面', () => {
    expect(model.pages).toHaveLength(3)
  })

  /** 三个来源都可能缺，而页面总得有个标题 */
  it('标题优先取正文 H1', () => {
    expect(model.pages[0]?.title).toBe('首页')
  })

  it('没有 H1 时退回文件名', () => {
    expect(model.pages[2]?.title).toBe('旧稿')
  })

  it('正文不含首个 H1——标题由模板渲染，留着会重复', () => {
    expect(model.pages[0]?.body).not.toContain('# 首页')
    expect(model.pages[0]?.body).toContain('正文')
  })

  it('frontmatter 不进正文', () => {
    expect(model.pages[0]?.body).not.toContain('id: a')
  })
})

describe('relativeHref', () => {
  it('同目录用 ./ 前缀', () => {
    expect(relativeHref('a.html', 'b.html')).toBe('./b.html')
  })

  it('往下进子目录', () => {
    expect(relativeHref('index.html', '项目/计划.html')).toBe('项目/计划.html')
  })

  it('往上退出目录', () => {
    expect(relativeHref('项目/计划.html', 'index.html')).toBe('../index.html')
  })

  it('跨目录时先上后下', () => {
    expect(relativeHref('项目/计划.html', '归档/旧稿.html')).toBe('../归档/旧稿.html')
  })

  it('多层嵌套', () => {
    expect(relativeHref('a/b/c.html', 'x/y.html')).toBe('../../x/y.html')
  })

  it('同一深层目录内互链', () => {
    expect(relativeHref('a/b/c.html', 'a/b/d.html')).toBe('./d.html')
  })
})

describe('resolveSiteHref', () => {
  const model = buildSiteModel(SOURCES)

  it('解析到站内相对路径', () => {
    expect(resolveSiteHref('项目/计划', '笔记.md', model)).toBe('项目/计划.html')
  })

  it('从子目录回到根目录', () => {
    expect(resolveSiteHref('笔记', '项目/计划.md', model)).toBe('../笔记.html')
  })

  it('目标不存在时返回 null，交由渲染层降级为纯文本', () => {
    expect(resolveSiteHref('还没写的', '笔记.md', model)).toBeNull()
  })

  /**
   * 站点里的链接解析必须与应用内**完全一致**。
   * 各写一份的话，同一个 `[[笔记]]` 在应用里跳到 A、在导出的站点里跳到 B，
   * 而这种偏差要等站点发布出去才会被发现。
   */
  it('沿用应用内的解析规则：只写文件名也能在全库找到', () => {
    expect(resolveSiteHref('计划', '笔记.md', model)).toBe('项目/计划.html')
  })
})

import { describe, expect, it } from 'vitest'
import { extractWikilinks, resolveWikilink, rewriteWikilinks, wikilinkTargetFor } from './wikilink'

/** 只取目标，绝大多数用例关心的就是这个 */
function targets(markdown: string): string[] {
  return extractWikilinks(markdown).map((ref) => ref.target)
}

describe('extractWikilinks — 基本语法', () => {
  it('提取简单链接', () => {
    expect(targets('看 [[我的笔记]] 这篇')).toEqual(['我的笔记'])
  })

  it('一行里的多个链接', () => {
    expect(targets('[[甲]] 与 [[乙]]')).toEqual(['甲', '乙'])
  })

  it('带路径', () => {
    expect(targets('[[文件夹/笔记]]')).toEqual(['文件夹/笔记'])
  })

  it('别名不进入目标，但成为显示文本', () => {
    const [ref] = extractWikilinks('[[a/b|看这里]]')
    expect(ref).toMatchObject({ target: 'a/b', label: '看这里' })
  })

  it('锚点单独拆出', () => {
    const [ref] = extractWikilinks('[[笔记#小节]]')
    expect(ref).toMatchObject({ target: '笔记', hash: '小节' })
  })

  it('锚点与别名同时出现', () => {
    const [ref] = extractWikilinks('[[笔记#小节|别名]]')
    expect(ref).toMatchObject({ target: '笔记', hash: '小节', label: '别名' })
  })

  it('纯锚点指向本篇内部，target 为空但仍是链接', () => {
    const [ref] = extractWikilinks('[[#结论]]')
    expect(ref).toMatchObject({ target: '', hash: '结论' })
  })

  it('嵌入语法被标记出来', () => {
    expect(extractWikilinks('![[图片.png]]')[0]?.embed).toBe(true)
    expect(extractWikilinks('[[图片.png]]')[0]?.embed).toBe(false)
  })

  it('没有链接时返回空数组', () => {
    expect(targets('普通的一段文字')).toEqual([])
  })

  it('空链接不算数', () => {
    expect(targets('[[]] 和 [[   ]]')).toEqual([])
  })

  it('只有开括号不算数', () => {
    expect(targets('这里有个 [[ 没有闭合')).toEqual([])
  })
})

/**
 * 下面这组是这个模块存在的真正理由。
 * 用一句 `/\[\[(.+?)\]\]/g` 正则扫全文的话，每一条都会假匹配——
 * 而假匹配的后果是反向链接面板里出现根本不存在的引用，用户无从理解。
 */
describe('extractWikilinks — 不该匹配的地方', () => {
  it('围栏代码块内整段跳过', () => {
    const markdown = ['正文 [[真链接]]', '```', '这里 [[假链接]]', '```', '结尾 [[另一个]]'].join('\n')
    expect(targets(markdown)).toEqual(['真链接', '另一个'])
  })

  it('波浪号围栏同样有效', () => {
    expect(targets(['~~~', '[[假的]]', '~~~'].join('\n'))).toEqual([])
  })

  it('围栏未闭合时后续全部跳过——不闭合的代码块本就延续到文末', () => {
    expect(targets(['```', '[[假的]]', '还是代码 [[也是假的]]'].join('\n'))).toEqual([])
  })

  it('行内代码内跳过', () => {
    expect(targets('用 `[[语法]]` 表示链接，例如 [[真的]]')).toEqual(['真的'])
  })

  it('多重反引号的行内代码按数量配对', () => {
    expect(targets('`` `[[还是代码]]` `` 之后是 [[真的]]')).toEqual(['真的'])
  })

  it('未闭合的反引号让该行余下部分都不解析', () => {
    expect(targets('` 未闭合 [[假的]]')).toEqual([])
  })

  it('反斜杠转义不算链接', () => {
    expect(targets('\\[[不是链接]]')).toEqual([])
  })

  it('嵌套的方括号不产生错位匹配', () => {
    expect(targets('[[[[怪东西]]')).toEqual([])
  })

  it('普通 Markdown 链接不受影响', () => {
    expect(targets('[文本](路径.md) 与 [[真链接]]')).toEqual(['真链接'])
  })
})

describe('resolveWikilink', () => {
  const paths = ['笔记.md', '归档/笔记.md', '归档/旧稿.md', '项目/计划.md']

  it('按文件名匹配，自动补 .md', () => {
    expect(resolveWikilink('项目/计划', paths)).toBe('项目/计划.md')
  })

  it('写全扩展名也认', () => {
    expect(resolveWikilink('项目/计划.md', paths)).toBe('项目/计划.md')
  })

  it('只写文件名时在全库查找', () => {
    expect(resolveWikilink('旧稿', paths)).toBe('归档/旧稿.md')
  })

  it('完整路径优先于同名文件', () => {
    expect(resolveWikilink('归档/笔记', paths)).toBe('归档/笔记.md')
  })

  it('重名时取路径字典序最小者——可预测优先于聪明', () => {
    expect(resolveWikilink('笔记', paths)).toBe('笔记.md')
  })

  it('大小写不敏感', () => {
    expect(resolveWikilink('计划', ['项目/计划.MD'])).toBe('项目/计划.MD')
  })

  it('目标不存在时返回 null，这是「尚未创建」而不是错误', () => {
    expect(resolveWikilink('还没写的笔记', paths)).toBeNull()
  })

  it('空目标返回 null', () => {
    expect(resolveWikilink('   ', paths)).toBeNull()
  })

  it('开头的 ./ 不影响匹配', () => {
    expect(resolveWikilink('./项目/计划', paths)).toBe('项目/计划.md')
  })
})

describe('wikilinkTargetFor', () => {
  it('不重名时只用文件名，链接更短更好读', () => {
    expect(wikilinkTargetFor('项目/计划.md', ['项目/计划.md', '笔记.md'])).toBe('计划')
  })

  it('重名时带上路径，否则链接指向不明确', () => {
    const paths = ['笔记.md', '归档/笔记.md']
    expect(wikilinkTargetFor('归档/笔记.md', paths)).toBe('归档/笔记')
  })

  /** 往返自洽：生成的目标必须能解析回原路径，否则「插入链接」功能会指错地方 */
  it('生成的目标能被 resolveWikilink 解析回同一篇', () => {
    const paths = ['笔记.md', '归档/笔记.md', '项目/计划.md']
    for (const path of paths) {
      expect(resolveWikilink(wikilinkTargetFor(path, paths), paths)).toBe(path)
    }
  })
})

describe('位置信息', () => {
  /** 偏移必须能还原到原文，否则改写会切错地方 */
  it('start / end 覆盖完整的 [[...]]', () => {
    const source = '看 [[我的笔记]] 这篇'
    const [ref] = extractWikilinks(source)
    expect(source.slice(ref!.start, ref!.end)).toBe('[[我的笔记]]')
  })

  it('嵌入语法的 start 含上感叹号', () => {
    const source = '看 ![[图片.png]] 这张'
    const [ref] = extractWikilinks(source)
    expect(source.slice(ref!.start, ref!.end)).toBe('![[图片.png]]')
  })

  it('targetStart / targetEnd 只覆盖目标，不含别名与锚点', () => {
    const source = '看 [[a/b#节|别名]]'
    const [ref] = extractWikilinks(source)
    expect(source.slice(ref!.targetStart, ref!.targetEnd)).toBe('a/b')
  })

  it('目标两侧的空格不计入', () => {
    const source = '看 [[  我的笔记  ]]'
    const [ref] = extractWikilinks(source)
    expect(source.slice(ref!.targetStart, ref!.targetEnd)).toBe('我的笔记')
  })

  it('跨行时偏移仍然准确', () => {
    const source = '第一行 [[甲]]\n第二行 [[乙]]\n\n第四行 [[丙]]'
    for (const ref of extractWikilinks(source)) {
      expect(source.slice(ref.targetStart, ref.targetEnd)).toBe(ref.target)
    }
  })

  // CRLF 换行下切掉 \r 会让后续所有位置前移，这条锁住它
  it('CRLF 换行下偏移不漂移', () => {
    const source = '第一行 [[甲]]\r\n第二行 [[乙]]\r\n第三行 [[丙]]'
    const refs = extractWikilinks(source)
    expect(refs.map((ref) => ref.target)).toEqual(['甲', '乙', '丙'])
    for (const ref of refs) {
      expect(source.slice(ref.targetStart, ref.targetEnd)).toBe(ref.target)
    }
  })
})

describe('rewriteWikilinks', () => {
  it('替换匹配的目标', () => {
    const out = rewriteWikilinks('看 [[旧名]] 这篇', (ref) => (ref.target === '旧名' ? '新名' : null))
    expect(out).toBe('看 [[新名]] 这篇')
  })

  /**
   * 别名往往是正文语句的一部分，抹掉就读不通了。
   * 这是「只替换目标段」而不是「重拼整个链接」的理由。
   */
  it('保留别名', () => {
    const out = rewriteWikilinks('见 [[旧名|那篇讲得更细]]', () => '新名')
    expect(out).toBe('见 [[新名|那篇讲得更细]]')
  })

  it('保留锚点', () => {
    expect(rewriteWikilinks('见 [[旧名#结论]]', () => '新名')).toBe('见 [[新名#结论]]')
  })

  it('保留锚点与别名', () => {
    expect(rewriteWikilinks('见 [[旧名#结论|详见]]', () => '新名')).toBe('见 [[新名#结论|详见]]')
  })

  it('保留嵌入前缀', () => {
    expect(rewriteWikilinks('![[旧图]]', () => '新图')).toBe('![[新图]]')
  })

  it('一行里的多个链接各自替换', () => {
    const out = rewriteWikilinks('[[甲]] 与 [[乙]]', (ref) => (ref.target === '甲' ? '丙' : null))
    expect(out).toBe('[[丙]] 与 [[乙]]')
  })

  it('多处替换后位置不漂移——即使新旧长度不同', () => {
    const out = rewriteWikilinks('[[a]] 和 [[a]] 还有 [[a]]', () => '很长的新名字')
    expect(out).toBe('[[很长的新名字]] 和 [[很长的新名字]] 还有 [[很长的新名字]]')
  })

  it('代码块里的链接不受影响', () => {
    const source = ['真的 [[旧名]]', '```', '假的 [[旧名]]', '```'].join('\n')
    const out = rewriteWikilinks(source, () => '新名')
    expect(out).toBe(['真的 [[新名]]', '```', '假的 [[旧名]]', '```'].join('\n'))
  })

  it('行内代码里的链接不受影响', () => {
    expect(rewriteWikilinks('`[[旧名]]` 与 [[旧名]]', () => '新名')).toBe('`[[旧名]]` 与 [[新名]]')
  })

  it('返回 null 表示不动', () => {
    const source = '看 [[甲]] 与 [[乙]]'
    expect(rewriteWikilinks(source, () => null)).toBe(source)
  })

  it('没有链接时原样返回', () => {
    expect(rewriteWikilinks('普通文字', () => '新名')).toBe('普通文字')
  })

  it('改写结果能被重新解析出新目标', () => {
    const out = rewriteWikilinks('见 [[旧名#结论|详见]]', () => '目录/新名')
    expect(extractWikilinks(out)[0]).toMatchObject({
      target: '目录/新名',
      hash: '结论',
      label: '详见',
    })
  })
})

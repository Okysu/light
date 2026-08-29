import { relativeHref, type SitePage } from './site-model'

/**
 * 静态站点的页面模板与样式（需求 10.2）。
 *
 * 样式内联在单个 CSS 文件里，不引外部资源：导出的站点应当**离线可用**，
 * 直接双击 HTML 就能看，而不是必须先跑一个服务器或联网拉 CDN。
 * 唯一的例外是 KaTeX 的字体，见 `SITE_CSS` 里的说明。
 */

/** HTML 转义。用户笔记的标题会进 `<title>` 与导航，不转义就是注入 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface PageContext {
  page: SitePage
  /** 渲染好的正文 HTML */
  html: string
  siteName: string
  /** 站点首页相对于本页的路径 */
  indexHref: string
  /** 样式表相对于本页的路径 */
  cssHref: string
}

export function renderPageHtml(context: PageContext): string {
  const { page, html, siteName, indexHref, cssHref } = context

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)} · ${escapeHtml(siteName)}</title>
<link rel="stylesheet" href="${cssHref}">
</head>
<body>
<header class="site-header">
  <a class="site-name" href="${indexHref}">${escapeHtml(siteName)}</a>
</header>
<main class="prose">
<h1>${escapeHtml(page.title)}</h1>
${html}
</main>
</body>
</html>
`
}

/**
 * 首页：按目录分组列出全部页面。
 *
 * 不做搜索也不做侧边树——那需要 JS，而导出的站点应当在最苛刻的环境里也能读
 * （比如别人把它塞进邮件附件里打开）。分组列表是纯 HTML 能表达的上限。
 */
export function renderIndexHtml(pages: readonly SitePage[], siteName: string): string {
  const groups = new Map<string, SitePage[]>()

  for (const page of pages) {
    const at = page.source.lastIndexOf('/')
    const dir = at === -1 ? '' : page.source.slice(0, at)
    const list = groups.get(dir) ?? []
    list.push(page)
    groups.set(dir, list)
  }

  // 根目录排在最前，其余按路径字典序——用户的目录结构本来就是有意义的组织
  const sorted = [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))

  const sections = sorted
    .map(([dir, items]) => {
      const links = items
        .map((page) => `    <li><a href="${relativeHref('index.html', page.href)}">${escapeHtml(page.title)}</a></li>`)
        .join('\n')

      const heading = dir ? `  <h2>${escapeHtml(dir)}</h2>\n` : ''
      return `${heading}  <ul>\n${links}\n  </ul>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(siteName)}</title>
<link rel="stylesheet" href="./style.css">
</head>
<body>
<header class="site-header">
  <span class="site-name">${escapeHtml(siteName)}</span>
</header>
<main class="prose index">
<h1>${escapeHtml(siteName)}</h1>
<p class="count">共 ${pages.length} 篇</p>
${sections}
</main>
</body>
</html>
`
}

/**
 * 站点样式。
 *
 * 刻意不复用应用的主题变量：那套变量是为编辑器设计的，而且用了 oklch —— 老浏览器
 * 打不开。导出的站点要面向未知环境，用最保守的写法。
 *
 * 公式优先使用 KaTeX 输出中自带的 MathML 层，因此离线站点不必再携带一套字体。
 */
export const SITE_CSS = `:root {
  color-scheme: light dark;
  --fg: #1a1a1a;
  --bg: #ffffff;
  --muted: #6b7280;
  --border: #e5e7eb;
  --link: #2563eb;
  --code-bg: #f6f7f9;
}

@media (prefers-color-scheme: dark) {
  :root {
    --fg: #e5e7eb;
    --bg: #16181d;
    --muted: #9ca3af;
    --border: #2b2f36;
    --link: #7aa2f7;
    --code-bg: #1e2127;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  line-height: 1.75;
}

.site-header {
  border-bottom: 1px solid var(--border);
  padding: 0.75rem 1.25rem;
}

.site-name {
  color: var(--fg);
  font-weight: 600;
  text-decoration: none;
}

.prose {
  margin: 0 auto;
  max-width: 45rem;
  padding: 2rem 1.25rem 4rem;
  word-wrap: break-word;
}

.prose h1 { font-size: 1.875rem; margin: 0 0 1.5rem; line-height: 1.3; }
.prose h2 { font-size: 1.375rem; margin: 2rem 0 0.75rem; }
.prose h3 { font-size: 1.125rem; margin: 1.5rem 0 0.5rem; }
.prose p, .prose ul, .prose ol, .prose blockquote { margin: 0 0 1rem; }
.prose a { color: var(--link); }

.prose blockquote {
  border-left: 3px solid var(--border);
  margin-left: 0;
  padding-left: 1rem;
  color: var(--muted);
}

.prose code {
  background: var(--code-bg);
  border-radius: 4px;
  font-size: 0.9em;
  padding: 0.15em 0.35em;
}

.prose pre {
  background: var(--code-bg);
  border-radius: 6px;
  overflow-x: auto;
  padding: 0.9rem 1rem;
}

.prose pre code { background: none; padding: 0; }

.prose table {
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
  width: 100%;
}

.prose th, .prose td {
  border: 1px solid var(--border);
  padding: 0.45rem 0.7rem;
  text-align: left;
}

.prose img { max-width: 100%; }

/* KaTeX 同时输出 HTML 与 MathML。静态站点显示浏览器原生 MathML，既能离线
   排版，也避免两层内容重复出现；不支持 MathML 的旧浏览器仍可读源码文本。 */
.katex { font-family: 'STIX Two Math', 'Cambria Math', serif; }
.katex .katex-html { display: none; }
.katex .katex-mathml { display: inline; }
.katex-display { margin: 1rem 0; overflow-x: auto; text-align: center; }

.prose hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

/* 指向未导出笔记的链接：保留文字但不做成死链 */
.wikilink-missing {
  border-bottom: 1px dashed var(--border);
  color: var(--muted);
  cursor: help;
}

.index h2 {
  color: var(--muted);
  font-size: 0.875rem;
  font-weight: 600;
  margin-top: 2rem;
}

.index ul { list-style: none; padding: 0; }
.index li { border-bottom: 1px solid var(--border); padding: 0.5rem 0; }
.count { color: var(--muted); font-size: 0.875rem; }
`

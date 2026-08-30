import type { ExtensionManifest, InstalledExtension } from './types'
import { hashExtension, type ExtensionRepository } from './repository'

export interface BuiltinExtensionDefinition {
  manifest: ExtensionManifest
  source: string
}

type BuiltinLocale = 'zh-CN' | 'en-US'

interface BuiltinPresentation {
  name: string
  description: string
  text: Record<string, string>
}

const quickCapture: BuiltinExtensionDefinition = {
  manifest: {
    version: 1,
    id: 'light.quick-capture',
    name: 'Quick Capture',
    description: 'Capture an idea into an Inbox note without leaving the current context.',
    author: 'Light',
    entry: 'main.js',
    permissions: ['workspace:read', 'workspace:write'],
    settings: {
      inboxFolder: { type: 'text', label: 'Inbox folder', default: 'Inbox', placeholder: 'Inbox' },
      titleStyle: {
        type: 'select',
        label: 'Title style',
        default: 'first-line',
        options: [
          { label: 'Use the first line', value: 'first-line' },
          { label: 'Use the capture time', value: 'timestamp' },
        ],
      },
      defaultTags: { type: 'text', label: 'Default tags', description: 'Separate multiple tags with commas.', default: 'inbox' },
      includeTimestamp: { type: 'boolean', label: 'Include capture time', default: true },
      openAfterCapture: { type: 'boolean', label: 'Open the new note', default: true },
    },
    contributes: {
      commands: [{ id: 'capture', title: 'Quick capture', description: 'Capture an idea into the Inbox' }],
      slash: [{ command: 'capture', title: 'Quick capture', group: 'Official extensions', keywords: ['capture', 'inbox', 'idea'] }],
      settings: [{
        id: 'capture',
        title: 'Capture behavior',
        description: 'Choose where captured ideas are stored and how notes are named.',
        fields: ['inboxFolder', 'titleStyle', 'defaultTags', 'includeTimestamp', 'openAfterCapture'],
        actions: [{ command: 'capture', title: 'Capture an idea now' }],
      }],
    },
  },
  source: String.raw`
const t = (zh, en, locale) => locale === 'zh-CN' ? zh : en
const cleanSegment = (value) => value.replace(/[^a-zA-Z0-9\u4e00-\u9fff _-]/g, '-').trim().slice(0, 60) || 'Capture'
const uniquePath = async (folder, title) => {
  const base = folder ? folder + '/' + cleanSegment(title) : cleanSegment(title)
  let path = base + '.md'
  for (let index = 2; await light.workspace.exists(path); index += 1) path = base + ' (' + index + ').md'
  return path
}

light.commands.handle('capture', async () => {
  const context = await light.app.getContext()
  const locale = context.locale
  const content = await light.ui.prompt({
    title: t('快速记录', 'Quick capture', locale),
    description: t('内容会保存为收件箱中的一篇本地 Markdown 笔记。', 'The content will be saved as a local Markdown note in your Inbox.', locale),
    confirmLabel: t('保存', 'Save', locale),
    multiline: true,
  })
  if (!content) return null
  const folder = String(await light.settings.get('inboxFolder') || '').replace(/^\/+|\/+$/g, '')
  if (folder) await light.workspace.mkdir(folder)
  const now = new Date()
  const style = await light.settings.get('titleStyle')
  const firstLine = content.split(/\r?\n/).find(line => line.trim()) || ''
  const title = style === 'timestamp'
    ? t('记录 ', 'Capture ', locale) + now.toISOString().replace('T', ' ').slice(0, 16).replace(/:/g, '-')
    : cleanSegment(firstLine)
  const tags = String(await light.settings.get('defaultTags') || '').split(',').map(tag => tag.trim()).filter(Boolean)
  const frontmatter = tags.length ? '---\ntags:\n' + tags.map(tag => '  - ' + tag).join('\n') + '\n---\n\n' : ''
  const timestamp = await light.settings.get('includeTimestamp')
    ? '> ' + t('记录于 ', 'Captured at ', locale) + now.toLocaleString(locale) + '\n\n'
    : ''
  const path = await uniquePath(folder, title)
  await light.workspace.writeText(path, frontmatter + '# ' + title + '\n\n' + timestamp + content.trim() + '\n')
  if (await light.settings.get('openAfterCapture')) await light.workspace.open(path)
  await light.ui.showToast({ type: 'success', message: t('已保存到 ' + path, 'Saved to ' + path, locale) })
  return path
})
`,
}

const noteTemplates: BuiltinExtensionDefinition = {
  manifest: {
    version: 1,
    id: 'light.note-templates',
    name: 'Note Templates',
    description: 'Create consistently structured notes from a configurable template.',
    author: 'Light',
    entry: 'main.js',
    permissions: ['workspace:read', 'workspace:write'],
    settings: {
      targetFolder: { type: 'text', label: 'Target folder', default: 'Notes', placeholder: 'Notes' },
      titlePrefix: { type: 'text', label: 'Title prefix', default: '' },
      templateBody: {
        type: 'textarea',
        label: 'Template body',
        description: 'Available variables: {{title}}, {{date}}, and {{time}}.',
        default: '## Notes\n\nStart writing here.\n',
        placeholder: '## Notes\n\n{{date}}',
      },
      defaultTags: { type: 'text', label: 'Default tags', description: 'Separate multiple tags with commas.', default: '' },
      includeCreatedAt: { type: 'boolean', label: 'Add created time', default: true },
    },
    contributes: {
      commands: [{ id: 'create', title: 'Create note from template' }],
      slash: [{ command: 'create', title: 'Create note from template', group: 'Official extensions', keywords: ['template', 'note'] }],
      settings: [{
        id: 'template',
        title: 'Template defaults',
        description: 'Configure the destination, properties, and Markdown inserted into new notes.',
        fields: ['targetFolder', 'titlePrefix', 'templateBody', 'defaultTags', 'includeCreatedAt'],
        actions: [{ command: 'create', title: 'Create a note' }],
      }],
    },
  },
  source: String.raw`
const t = (zh, en, locale) => locale === 'zh-CN' ? zh : en
const cleanSegment = (value) => value.replace(/[^a-zA-Z0-9\u4e00-\u9fff _-]/g, '-').trim().slice(0, 80) || 'Untitled'
const uniquePath = async (folder, title) => {
  const base = folder ? folder + '/' + cleanSegment(title) : cleanSegment(title)
  let path = base + '.md'
  for (let index = 2; await light.workspace.exists(path); index += 1) path = base + ' (' + index + ').md'
  return path
}

light.commands.handle('create', async () => {
  const context = await light.app.getContext()
  const locale = context.locale
  const requested = await light.ui.prompt({
    title: t('从模板新建笔记', 'Create note from template', locale),
    description: t('输入新笔记的标题。', 'Enter a title for the new note.', locale),
    confirmLabel: t('创建', 'Create', locale),
  })
  if (!requested) return null
  const prefix = String(await light.settings.get('titlePrefix') || '')
  const title = prefix + requested.trim()
  const folder = String(await light.settings.get('targetFolder') || '').replace(/^\/+|\/+$/g, '')
  if (folder) await light.workspace.mkdir(folder)
  const now = new Date()
  const bodyTemplate = String(await light.settings.get('templateBody') || '')
  const body = bodyTemplate
    .split('{{title}}').join(title)
    .split('{{date}}').join(now.toLocaleDateString(locale))
    .split('{{time}}').join(now.toLocaleTimeString(locale))
  const tags = String(await light.settings.get('defaultTags') || '').split(',').map(tag => tag.trim()).filter(Boolean)
  const properties = []
  if (tags.length) properties.push('tags:\n' + tags.map(tag => '  - ' + tag).join('\n'))
  if (await light.settings.get('includeCreatedAt')) properties.push('created: ' + JSON.stringify(now.toISOString()))
  const frontmatter = properties.length ? '---\n' + properties.join('\n') + '\n---\n\n' : ''
  const path = await uniquePath(folder, title)
  await light.workspace.writeText(path, frontmatter + '# ' + title + '\n\n' + body.trim() + '\n')
  await light.workspace.open(path)
  return path
})
`,
}

const knowledgeHealth: BuiltinExtensionDefinition = {
  manifest: {
    version: 1,
    id: 'light.knowledge-health',
    name: 'Knowledge Health',
    description: 'Find broken links, orphan notes, and unused attachments in the local Vault.',
    author: 'Light',
    entry: 'main.js',
    permissions: ['workspace:read', 'workspace:write'],
    settings: {
      reportFolder: { type: 'text', label: 'Report folder', default: 'Light Reports' },
      excludedFolders: { type: 'textarea', label: 'Excluded folders', description: 'Enter one relative folder per line.', default: 'Light Reports' },
      includeOrphans: { type: 'boolean', label: 'Report orphan notes', default: true },
      includeUnusedAttachments: { type: 'boolean', label: 'Report unused attachments', default: true },
    },
    contributes: {
      commands: [{ id: 'scan', title: 'Scan knowledge health' }],
      settings: [{
        id: 'scan',
        title: 'Health report',
        description: 'The scan is local-only and writes a Markdown report into your Vault.',
        fields: ['reportFolder', 'excludedFolders', 'includeOrphans', 'includeUnusedAttachments'],
        actions: [{ command: 'scan', title: 'Run a health scan' }],
      }],
    },
  },
  source: String.raw`
const t = (zh, en, locale) => locale === 'zh-CN' ? zh : en
const baseName = (path) => path.split('/').pop() || path
const withoutExt = (path) => path.replace(/\.md$/i, '')
const walk = async (path, excluded, output) => {
  for (const entry of await light.workspace.list(path)) {
    const root = entry.path.split('/')[0]
    if (['.light', '.light-sync', '.git', 'node_modules'].includes(root)) continue
    if (excluded.some(folder => entry.path === folder || entry.path.startsWith(folder + '/'))) continue
    if (entry.directory) await walk(entry.path, excluded, output)
    else output.push(entry.path)
  }
}
const uniqueReport = async (folder, name) => {
  let path = folder + '/' + name + '.md'
  for (let index = 2; await light.workspace.exists(path); index += 1) path = folder + '/' + name + ' (' + index + ').md'
  return path
}

light.commands.handle('scan', async () => {
  const context = await light.app.getContext()
  const locale = context.locale
  await light.ui.showToast({ type: 'info', message: t('正在扫描知识库…', 'Scanning the knowledge base…', locale) })
  const excluded = String(await light.settings.get('excludedFolders') || '').split(/\r?\n/).map(value => value.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean)
  const files = []
  await walk('', excluded, files)
  const notes = files.filter(path => path.toLowerCase().endsWith('.md'))
  const attachments = files.filter(path => path.startsWith('attachments/') && !path.toLowerCase().endsWith('.md'))
  const known = new Map()
  for (const path of notes) {
    known.set(withoutExt(path).toLowerCase(), path)
    known.set(withoutExt(baseName(path)).toLowerCase(), path)
  }
  const inbound = new Map(notes.map(path => [path, 0]))
  const broken = []
  const referencedAttachments = new Set()
  for (const path of notes) {
    const text = await light.workspace.readText(path)
    const wiki = /\[\[([^\]]+)\]\]/g
    let match
    while ((match = wiki.exec(text))) {
      const target = match[1].split('|')[0].split('#')[0].trim().replace(/\.md$/i, '')
      if (!target) continue
      const resolved = known.get(target.toLowerCase()) || known.get(baseName(target).toLowerCase())
      if (resolved) inbound.set(resolved, (inbound.get(resolved) || 0) + 1)
      else broken.push({ source: path, target })
    }
    for (const attachment of attachments) {
      if (text.includes(attachment) || text.includes(baseName(attachment))) referencedAttachments.add(attachment)
    }
  }
  const orphans = await light.settings.get('includeOrphans')
    ? notes.filter(path => (inbound.get(path) || 0) === 0)
    : []
  const unused = await light.settings.get('includeUnusedAttachments')
    ? attachments.filter(path => !referencedAttachments.has(path))
    : []
  const reportFolder = String(await light.settings.get('reportFolder') || 'Light Reports').replace(/^\/+|\/+$/g, '') || 'Light Reports'
  await light.workspace.mkdir(reportFolder)
  const now = new Date()
  const reportName = t('知识库体检 ', 'Knowledge Health ', locale) + now.toISOString().slice(0, 10)
  const lines = [
    '# ' + reportName,
    '',
    '> ' + t('本报告完全在本地生成。', 'This report was generated entirely on this device.', locale),
    '',
    '## ' + t('概览', 'Summary', locale),
    '',
    '- ' + t('笔记：', 'Notes: ', locale) + notes.length,
    '- ' + t('失效链接：', 'Broken links: ', locale) + broken.length,
    '- ' + t('孤立笔记：', 'Orphan notes: ', locale) + orphans.length,
    '- ' + t('未使用附件：', 'Unused attachments: ', locale) + unused.length,
    '',
    '## ' + t('失效链接', 'Broken links', locale),
    '',
    ...(broken.length ? broken.map(item => '- [[' + item.source.replace(/\.md$/i, '') + ']] → “' + item.target + '”') : ['- ' + t('没有发现', 'None found', locale)]),
    '',
    '## ' + t('孤立笔记', 'Orphan notes', locale),
    '',
    ...(orphans.length ? orphans.map(path => '- [[' + path.replace(/\.md$/i, '') + ']]') : ['- ' + t('没有发现', 'None found', locale)]),
    '',
    '## ' + t('未使用附件', 'Unused attachments', locale),
    '',
    ...(unused.length ? unused.map(path => '- ' + path) : ['- ' + t('没有发现', 'None found', locale)]),
    '',
  ]
  const reportPath = await uniqueReport(reportFolder, reportName)
  await light.workspace.writeText(reportPath, lines.join('\n'))
  await light.workspace.open(reportPath)
  await light.ui.showToast({ type: 'success', message: t('体检报告已生成', 'Health report generated', locale) })
  return { reportPath, notes: notes.length, broken: broken.length, orphans: orphans.length, unused: unused.length }
})
`,
}

const aiWriting: BuiltinExtensionDefinition = {
  manifest: {
    version: 1,
    id: 'light.ai-writing',
    name: 'AI Writing Toolkit',
    description: 'Summarize, polish, translate, and tag notes through Light’s configured AI provider.',
    author: 'Light',
    entry: 'main.js',
    permissions: ['document:read', 'document:write', 'ai:invoke'],
    settings: {
      tone: {
        type: 'select', label: 'Writing tone', default: 'natural', options: [
          { label: 'Natural', value: 'natural' }, { label: 'Concise', value: 'concise' }, { label: 'Professional', value: 'professional' },
        ],
      },
      targetLanguage: {
        type: 'select', label: 'Translation language', default: 'English', options: [
          { label: 'English', value: 'English' }, { label: '简体中文', value: 'Simplified Chinese' }, { label: '日本語', value: 'Japanese' },
        ],
      },
      replaceSelection: { type: 'boolean', label: 'Replace selected text', description: 'When disabled, the result is inserted after the selection.', default: false },
      customInstruction: { type: 'textarea', label: 'Additional instruction', default: '', placeholder: 'Keep technical terms unchanged.' },
    },
    contributes: {
      commands: [
        { id: 'polish', title: 'AI: Polish selection' },
        { id: 'summarize', title: 'AI: Summarize note or selection' },
        { id: 'translate', title: 'AI: Translate selection' },
        { id: 'tags', title: 'AI: Suggest tags' },
      ],
      slash: [
        { command: 'polish', title: 'AI: Polish selection', group: 'Official extensions', keywords: ['ai', 'polish'] },
        { command: 'summarize', title: 'AI: Summarize', group: 'Official extensions', keywords: ['ai', 'summary'] },
        { command: 'translate', title: 'AI: Translate', group: 'Official extensions', keywords: ['ai', 'translate'] },
      ],
      settings: [{
        id: 'writing',
        title: 'Writing behavior',
        description: 'Requests use the global AI provider. The extension never receives the provider key.',
        fields: ['tone', 'targetLanguage', 'replaceSelection', 'customInstruction'],
        actions: [
          { command: 'polish', title: 'Polish the selection' },
          { command: 'summarize', title: 'Summarize now', variant: 'outline' },
          { command: 'translate', title: 'Translate now', variant: 'outline' },
          { command: 'tags', title: 'Suggest tags', variant: 'outline' },
        ],
      }],
    },
  },
  source: String.raw`
const t = (zh, en, locale) => locale === 'zh-CN' ? zh : en
const inputForAction = async () => {
  const selection = await light.document.getSelection()
  if (selection.text && selection.text.trim()) return { input: selection.text, selected: true }
  return { input: await light.document.getText(), selected: false }
}
const deliver = async (text, selected, heading) => {
  if (selected && await light.settings.get('replaceSelection')) await light.document.replaceSelection(text)
  else await light.document.insertAfterSelection('\n\n## ' + heading + '\n\n' + text.trim() + '\n')
}
const run = async (instruction, heading) => {
  if (!(await light.ai.isAvailable())) throw new Error('AI provider is not configured')
  const context = await light.app.getContext()
  const source = await inputForAction()
  const tone = await light.settings.get('tone')
  const custom = await light.settings.get('customInstruction')
  const result = await light.ai.complete({ instruction: instruction + '\nTone: ' + tone + '\n' + custom, input: source.input })
  await deliver(result.text, source.selected, heading(context.locale))
  return result.text
}

light.commands.handle('polish', () => run('Polish the input while preserving its meaning and Markdown structure.', locale => t('AI 润色', 'AI polish', locale)))
light.commands.handle('summarize', () => run('Write a concise, faithful summary. Do not invent facts.', locale => t('AI 摘要', 'AI summary', locale)))
light.commands.handle('translate', async () => {
  const language = await light.settings.get('targetLanguage')
  return run('Translate the input into ' + language + '. Preserve Markdown and technical terms.', locale => t('AI 翻译', 'AI translation', locale))
})
light.commands.handle('tags', () => run('Suggest 3 to 7 concise knowledge-base tags. Return a comma-separated list only.', locale => t('AI 标签建议', 'AI tag suggestions', locale)))
`,
}

const markdownCleaner: BuiltinExtensionDefinition = {
  manifest: {
    version: 1,
    id: 'light.markdown-cleaner',
    name: 'Markdown Cleaner',
    description: 'Normalize Markdown formatting in the active note or a selected Vault folder.',
    author: 'Light',
    entry: 'main.js',
    permissions: ['workspace:read', 'workspace:write', 'document:read', 'document:write'],
    settings: {
      scopeFolder: { type: 'text', label: 'Batch folder', description: 'Leave empty to process the whole Vault.', default: '' },
      trimTrailingSpaces: { type: 'boolean', label: 'Remove trailing spaces', default: true },
      collapseBlankLines: { type: 'boolean', label: 'Collapse repeated blank lines', default: true },
      normalizeBullets: { type: 'boolean', label: 'Normalize list markers to hyphens', default: true },
      ensureFinalNewline: { type: 'boolean', label: 'Ensure a final newline', default: true },
    },
    contributes: {
      commands: [
        { id: 'clean-current', title: 'Clean current Markdown note' },
        { id: 'clean-folder', title: 'Clean Markdown folder' },
      ],
      settings: [{
        id: 'cleaner',
        title: 'Formatting rules',
        description: 'Batch changes require confirmation and only affect Markdown files.',
        fields: ['scopeFolder', 'trimTrailingSpaces', 'collapseBlankLines', 'normalizeBullets', 'ensureFinalNewline'],
        actions: [
          { command: 'clean-current', title: 'Clean current note' },
          { command: 'clean-folder', title: 'Clean the folder', variant: 'outline' },
        ],
      }],
    },
  },
  source: String.raw`
const t = (zh, en, locale) => locale === 'zh-CN' ? zh : en
const clean = async (text) => {
  let output = text.replace(/\r\n/g, '\n')
  if (await light.settings.get('trimTrailingSpaces')) output = output.split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n')
  if (await light.settings.get('collapseBlankLines')) output = output.replace(/\n{3,}/g, '\n\n')
  if (await light.settings.get('normalizeBullets')) output = output.replace(/^(\s*)[+*]\s+/gm, '$1- ')
  if (await light.settings.get('ensureFinalNewline')) output = output.replace(/\n*$/, '\n')
  return output
}
const walkMarkdown = async (path, output) => {
  for (const entry of await light.workspace.list(path)) {
    const root = entry.path.split('/')[0]
    if (['.light', '.light-sync', '.git', 'node_modules'].includes(root)) continue
    if (entry.directory) await walkMarkdown(entry.path, output)
    else if (entry.path.toLowerCase().endsWith('.md')) output.push(entry.path)
  }
}

light.commands.handle('clean-current', async () => {
  const context = await light.app.getContext()
  const active = await light.document.getActive()
  if (!active || active.kind !== 'note') throw new Error(t('请先打开一篇 Markdown 笔记', 'Open a Markdown note first', context.locale))
  const before = await light.document.getText()
  const after = await clean(before)
  if (after === before) {
    await light.ui.showToast({ type: 'info', message: t('当前笔记已经很整洁', 'The current note is already clean', context.locale) })
    return 0
  }
  await light.document.replaceText(after)
  await light.ui.showToast({ type: 'success', message: t('已整理当前笔记', 'Current note cleaned', context.locale) })
  return 1
})

light.commands.handle('clean-folder', async () => {
  const context = await light.app.getContext()
  const locale = context.locale
  const scope = String(await light.settings.get('scopeFolder') || '').replace(/^\/+|\/+$/g, '')
  const accepted = await light.ui.confirm({
    title: t('批量整理 Markdown？', 'Clean Markdown in bulk?', locale),
    description: t('将改写目标目录中的 Markdown 文件。建议先确认同步已经完成。', 'Markdown files in the target folder will be rewritten. Make sure sync is complete first.', locale),
    confirmLabel: t('开始整理', 'Clean files', locale),
    danger: true,
  })
  if (!accepted) return 0
  const files = []
  await walkMarkdown(scope, files)
  const active = await light.document.getActive()
  let changed = 0
  for (const path of files) {
    if (active && active.path === path) continue
    const before = await light.workspace.readText(path)
    const after = await clean(before)
    if (after !== before) {
      await light.workspace.writeText(path, after, { refresh: false })
      changed += 1
    }
  }
  if (active && files.includes(active.path)) changed += await light.commands.invokeLocal('clean-current')
  await light.workspace.refresh()
  await light.ui.showToast({ type: 'success', message: t('已整理 ' + changed + ' 篇笔记', 'Cleaned ' + changed + ' notes', locale) })
  return changed
})
`,
}

export const BUILTIN_EXTENSIONS: readonly BuiltinExtensionDefinition[] = [
  quickCapture,
  noteTemplates,
  knowledgeHealth,
  aiWriting,
  markdownCleaner,
]

const builtinIds = new Set(BUILTIN_EXTENSIONS.map((item) => item.manifest.id))

export function isBuiltinExtension(id: string): boolean {
  return builtinIds.has(id)
}

export function markBuiltin(extension: InstalledExtension): InstalledExtension {
  return isBuiltinExtension(extension.manifest.id) ? { ...extension, builtin: true } : extension
}

/** 安装缺失的官方扩展，并在应用升级后只刷新官方代码，不触碰用户配置。 */
export async function ensureBuiltinExtensions(repository: ExtensionRepository): Promise<void> {
  const installed = await repository.list()
  for (const builtin of BUILTIN_EXTENSIONS) {
    const current = installed.find((item) => item.manifest.id === builtin.manifest.id)
    const expectedHash = await hashExtension(builtin.manifest, builtin.source)
    if (!current || current.sourceHash !== expectedHash) {
      await repository.install(builtin.manifest, builtin.source)
    }
  }
}

const presentations: Record<string, Record<BuiltinLocale, BuiltinPresentation>> = {
  'light.quick-capture': bilingual(
    '快速收集箱', '把灵感保存为收件箱中的本地笔记，不打断当前思路。', {
      'command.capture': '快速记录', 'setting.inboxFolder': '收件箱目录', 'setting.titleStyle': '标题方式',
      'setting.defaultTags': '默认标签', 'setting.includeTimestamp': '写入记录时间', 'setting.openAfterCapture': '创建后打开笔记',
      'option.titleStyle.first-line': '使用第一行内容', 'option.titleStyle.timestamp': '使用记录时间',
      'section.capture': '记录方式', 'section.capture.description': '设置灵感保存位置、标题和默认属性。', 'action.capture': '现在记录一条灵感',
    },
    'Quick Capture', 'Capture an idea into a local Inbox note without leaving the current context.', {
      'command.capture': 'Quick capture', 'setting.inboxFolder': 'Inbox folder', 'setting.titleStyle': 'Title style',
      'setting.defaultTags': 'Default tags', 'setting.includeTimestamp': 'Include capture time', 'setting.openAfterCapture': 'Open the new note',
      'option.titleStyle.first-line': 'Use the first line', 'option.titleStyle.timestamp': 'Use the capture time',
      'section.capture': 'Capture behavior', 'section.capture.description': 'Choose where captured ideas are stored and how notes are named.', 'action.capture': 'Capture an idea now',
    },
  ),
  'light.note-templates': bilingual(
    '笔记模板', '使用可配置模板创建结构一致的笔记。', {
      'command.create': '从模板新建笔记', 'setting.targetFolder': '目标目录', 'setting.titlePrefix': '标题前缀',
      'setting.templateBody': '模板正文', 'setting.defaultTags': '默认标签', 'setting.includeCreatedAt': '添加创建时间',
      'section.template': '模板默认值', 'section.template.description': '配置新笔记的目录、属性和 Markdown 内容。', 'action.create': '创建一篇笔记',
    },
    'Note Templates', 'Create consistently structured notes from a configurable template.', {
      'command.create': 'Create note from template', 'setting.targetFolder': 'Target folder', 'setting.titlePrefix': 'Title prefix',
      'setting.templateBody': 'Template body', 'setting.defaultTags': 'Default tags', 'setting.includeCreatedAt': 'Add created time',
      'section.template': 'Template defaults', 'section.template.description': 'Configure the destination, properties, and Markdown inserted into new notes.', 'action.create': 'Create a note',
    },
  ),
  'light.knowledge-health': bilingual(
    '知识库体检', '查找失效链接、孤立笔记和未使用附件，并生成本地报告。', {
      'command.scan': '扫描知识库健康状态', 'setting.reportFolder': '报告目录', 'setting.excludedFolders': '排除目录',
      'setting.includeOrphans': '报告孤立笔记', 'setting.includeUnusedAttachments': '报告未使用附件',
      'section.scan': '体检报告', 'section.scan.description': '扫描完全在本地进行，并在知识库中生成 Markdown 报告。', 'action.scan': '立即开始体检',
    },
    'Knowledge Health', 'Find broken links, orphan notes, and unused attachments in the local Vault.', {
      'command.scan': 'Scan knowledge health', 'setting.reportFolder': 'Report folder', 'setting.excludedFolders': 'Excluded folders',
      'setting.includeOrphans': 'Report orphan notes', 'setting.includeUnusedAttachments': 'Report unused attachments',
      'section.scan': 'Health report', 'section.scan.description': 'The scan is local-only and writes a Markdown report into your Vault.', 'action.scan': 'Run a health scan',
    },
  ),
  'light.ai-writing': bilingual(
    'AI 写作工具箱', '通过 Light 已配置的 AI 完成摘要、润色、翻译和标签建议。', {
      'command.polish': 'AI：润色选区', 'command.summarize': 'AI：总结笔记或选区', 'command.translate': 'AI：翻译选区', 'command.tags': 'AI：建议标签',
      'setting.tone': '写作语气', 'setting.targetLanguage': '翻译目标语言', 'setting.replaceSelection': '替换选中文本', 'setting.customInstruction': '附加要求',
      'option.tone.natural': '自然', 'option.tone.concise': '简洁', 'option.tone.professional': '专业',
      'option.targetLanguage.English': '英语', 'option.targetLanguage.Simplified Chinese': '简体中文', 'option.targetLanguage.Japanese': '日语',
      'section.writing': '写作行为', 'section.writing.description': '请求使用全局 AI 配置，扩展永远无法读取服务密钥。',
      'action.polish': '润色选区', 'action.summarize': '立即总结', 'action.translate': '立即翻译', 'action.tags': '建议标签',
    },
    'AI Writing Toolkit', 'Summarize, polish, translate, and tag notes through Light’s configured AI provider.', {
      'command.polish': 'AI: Polish selection', 'command.summarize': 'AI: Summarize note or selection', 'command.translate': 'AI: Translate selection', 'command.tags': 'AI: Suggest tags',
      'setting.tone': 'Writing tone', 'setting.targetLanguage': 'Translation language', 'setting.replaceSelection': 'Replace selected text', 'setting.customInstruction': 'Additional instruction',
      'option.tone.natural': 'Natural', 'option.tone.concise': 'Concise', 'option.tone.professional': 'Professional',
      'option.targetLanguage.English': 'English', 'option.targetLanguage.Simplified Chinese': 'Simplified Chinese', 'option.targetLanguage.Japanese': 'Japanese',
      'section.writing': 'Writing behavior', 'section.writing.description': 'Requests use the global AI provider. The extension never receives the provider key.',
      'action.polish': 'Polish the selection', 'action.summarize': 'Summarize now', 'action.translate': 'Translate now', 'action.tags': 'Suggest tags',
    },
  ),
  'light.markdown-cleaner': bilingual(
    'Markdown 整理器', '规范当前笔记或指定目录中的 Markdown 格式。', {
      'command.clean-current': '整理当前 Markdown 笔记', 'command.clean-folder': '批量整理 Markdown 目录',
      'setting.scopeFolder': '批量处理目录', 'setting.trimTrailingSpaces': '删除行尾空格', 'setting.collapseBlankLines': '合并连续空行',
      'setting.normalizeBullets': '统一列表符号为横线', 'setting.ensureFinalNewline': '保证文件末尾换行',
      'section.cleaner': '格式规则', 'section.cleaner.description': '批量改写前会再次确认，并且只处理 Markdown 文件。',
      'action.clean-current': '整理当前笔记', 'action.clean-folder': '整理目标目录',
    },
    'Markdown Cleaner', 'Normalize Markdown formatting in the active note or a selected Vault folder.', {
      'command.clean-current': 'Clean current Markdown note', 'command.clean-folder': 'Clean Markdown folder',
      'setting.scopeFolder': 'Batch folder', 'setting.trimTrailingSpaces': 'Remove trailing spaces', 'setting.collapseBlankLines': 'Collapse repeated blank lines',
      'setting.normalizeBullets': 'Normalize list markers to hyphens', 'setting.ensureFinalNewline': 'Ensure a final newline',
      'section.cleaner': 'Formatting rules', 'section.cleaner.description': 'Batch changes require confirmation and only affect Markdown files.',
      'action.clean-current': 'Clean current note', 'action.clean-folder': 'Clean the folder',
    },
  ),
}

export function builtinName(extension: InstalledExtension, locale: string): string {
  return presentation(extension.manifest.id, locale)?.name ?? extension.manifest.name
}

export function builtinDescription(extension: InstalledExtension, locale: string): string | undefined {
  return presentation(extension.manifest.id, locale)?.description ?? extension.manifest.description
}

export function builtinText(extensionId: string, locale: string, key: string, fallback: string): string {
  return presentation(extensionId, locale)?.text[key] ?? fallback
}

function presentation(id: string, locale: string): BuiltinPresentation | undefined {
  return presentations[id]?.[locale === 'en-US' ? 'en-US' : 'zh-CN']
}

function bilingual(
  zhName: string,
  zhDescription: string,
  zhText: Record<string, string>,
  enName: string,
  enDescription: string,
  enText: Record<string, string>,
): Record<BuiltinLocale, BuiltinPresentation> {
  return {
    'zh-CN': { name: zhName, description: zhDescription, text: zhText },
    'en-US': { name: enName, description: enDescription, text: enText },
  }
}

import {
  EXTENSION_ENTRY,
  EXTENSION_PERMISSIONS,
  type ExtensionManifest,
  type ExtensionPermission,
  type ExtensionSettingDefinition,
  type ExtensionSettingValue,
} from './types'

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/
const CONTRIBUTION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const SETTING_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/
const permissionSet = new Set<string>(EXTENSION_PERMISSIONS)

export class ExtensionManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtensionManifestError'
  }
}

export function parseExtensionManifest(source: unknown): ExtensionManifest {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('manifest 必须是对象')
  const value = source as Record<string, unknown>

  if (value.version !== 1) fail('manifest.version 必须是 1')
  const id = requiredString(value.id, 'id', 64)
  if (!ID_PATTERN.test(id)) fail('id 只能使用小写字母、数字、点、横线和下划线')
  const name = requiredString(value.name, 'name', 80)
  if (value.entry !== EXTENSION_ENTRY) fail(`entry 必须是 ${EXTENSION_ENTRY}`)

  const permissions = parsePermissions(value.permissions)
  const settings = value.settings === undefined ? undefined : parseSettings(value.settings)
  const contributes = value.contributes === undefined ? undefined : parseContributes(value.contributes, settings ?? {})

  return {
    version: 1,
    id,
    name,
    ...(optionalString(value.description, 'description', 300) ? { description: optionalString(value.description, 'description', 300) } : {}),
    ...(optionalString(value.author, 'author', 100) ? { author: optionalString(value.author, 'author', 100) } : {}),
    entry: EXTENSION_ENTRY,
    permissions,
    ...(settings ? { settings } : {}),
    ...(contributes ? { contributes } : {}),
  }
}

export function createQuickScriptManifest(id: string, name: string): ExtensionManifest {
  return parseExtensionManifest({
    version: 1,
    id,
    name,
    entry: EXTENSION_ENTRY,
    permissions: [],
    contributes: { commands: [] },
  })
}

function parsePermissions(source: unknown): ExtensionPermission[] {
  if (!Array.isArray(source)) fail('permissions 必须是数组')
  const output: ExtensionPermission[] = []
  for (const permission of source) {
    if (typeof permission !== 'string' || !permissionSet.has(permission)) {
      fail(`不支持的权限：${String(permission)}`)
    }
    if (!output.includes(permission as ExtensionPermission)) output.push(permission as ExtensionPermission)
  }
  return output
}

function parseSettings(source: unknown): Record<string, ExtensionSettingDefinition> {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('settings 必须是对象')
  const output: Record<string, ExtensionSettingDefinition> = {}
  for (const [key, raw] of Object.entries(source as Record<string, unknown>)) {
    if (!SETTING_KEY_PATTERN.test(key)) fail(`无效的设置键：${key}`)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`设置 ${key} 必须是对象`)
    const definition = raw as Record<string, unknown>
    const type = requiredString(definition.type, `settings.${key}.type`, 20)
    if (!['boolean', 'text', 'textarea', 'number', 'select', 'secret'].includes(type)) {
      fail(`设置 ${key} 使用了不支持的类型：${type}`)
    }
    const label = requiredString(definition.label, `settings.${key}.label`, 80)
    const description = optionalString(definition.description, `settings.${key}.description`, 240)
    const options = type === 'select' ? parseOptions(definition.options, key) : undefined
    const fallback = parseDefault(definition.default, type, key)
    const placeholder = optionalString(definition.placeholder, `settings.${key}.placeholder`, 160)
    const min = optionalFiniteNumber(definition.min, `settings.${key}.min`)
    const max = optionalFiniteNumber(definition.max, `settings.${key}.max`)
    if (min !== undefined && max !== undefined && min > max) fail(`settings.${key}.min 不能大于 max`)
    const visibleWhen = definition.visibleWhen === undefined ? undefined : parseCondition(definition.visibleWhen, key)
    output[key] = {
      type: type as ExtensionSettingDefinition['type'],
      label,
      ...(description ? { description } : {}),
      ...(fallback !== undefined ? { default: fallback } : {}),
      ...(options ? { options } : {}),
      ...(placeholder ? { placeholder } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(visibleWhen ? { visibleWhen } : {}),
    }
    if (type === 'select' && fallback !== undefined && fallback !== null && !options?.some((option) => option.value === fallback)) {
      fail(`settings.${key}.default 不在 options 中`)
    }
    if (typeof fallback === 'number' && min !== undefined && fallback < min) fail(`settings.${key}.default 不能小于 min`)
    if (typeof fallback === 'number' && max !== undefined && fallback > max) fail(`settings.${key}.default 不能大于 max`)
  }
  for (const [key, definition] of Object.entries(output)) {
    const condition = definition.visibleWhen
    if (!condition) continue
    const dependency = output[condition.key]
    if (!dependency) fail(`设置 ${key} 的 visibleWhen 引用了未声明设置：${condition.key}`)
    if (!settingValueMatches(dependency.type, condition.equals)) {
      fail(`设置 ${key} 的 visibleWhen.equals 类型与 ${condition.key} 不匹配`)
    }
  }
  return output
}

function parseCondition(source: unknown, key: string) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail(`settings.${key}.visibleWhen 必须是对象`)
  const value = source as Record<string, unknown>
  const equals = value.equals
  if (!isSettingValue(equals)) fail(`settings.${key}.visibleWhen.equals 不是有效设置值`)
  return {
    key: requiredString(value.key, `settings.${key}.visibleWhen.key`, 64),
    equals,
  }
}

function parseOptions(source: unknown, key: string): Array<{ label: string; value: string }> {
  if (!Array.isArray(source) || source.length === 0) fail(`选择设置 ${key} 必须提供 options`)
  return source.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`settings.${key}.options.${index} 必须是对象`)
    const value = raw as Record<string, unknown>
    return {
      label: requiredString(value.label, `settings.${key}.options.${index}.label`, 80),
      value: requiredString(value.value, `settings.${key}.options.${index}.value`, 80),
    }
  })
}

function parseDefault(source: unknown, type: string, key: string): string | number | boolean | null | undefined {
  if (source === undefined) return undefined
  if (source === null) return null
  const expected = type === 'boolean' ? 'boolean' : type === 'number' ? 'number' : 'string'
  if (typeof source !== expected || (typeof source === 'number' && !Number.isFinite(source))) {
    fail(`settings.${key}.default 类型与 ${type} 不匹配`)
  }
  return source as string | number | boolean
}

function parseContributes(
  source: unknown,
  settingDefinitions: Record<string, ExtensionSettingDefinition>,
): ExtensionManifest['contributes'] {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('contributes 必须是对象')
  const value = source as Record<string, unknown>
  const commands = value.commands === undefined ? undefined : parseCommands(value.commands)
  const commandIds = new Set(commands?.map((item) => item.id) ?? [])
  const slash = value.slash === undefined ? undefined : parseSlash(value.slash, commandIds)
  const settings = value.settings === undefined
    ? undefined
    : parseSettingsSections(value.settings, commandIds, new Set(Object.keys(settingDefinitions)))
  return {
    ...(commands ? { commands } : {}),
    ...(slash ? { slash } : {}),
    ...(settings ? { settings } : {}),
  }
}

function parseSettingsSections(source: unknown, commands: Set<string>, settingKeys: Set<string>) {
  if (!Array.isArray(source)) fail('contributes.settings 必须是数组')
  const ids = new Set<string>()
  return source.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`contributes.settings.${index} 必须是对象`)
    const value = raw as Record<string, unknown>
    const id = requiredString(value.id, `contributes.settings.${index}.id`, 64)
    if (!CONTRIBUTION_ID_PATTERN.test(id) || ids.has(id)) fail(`无效或重复的设置区块 id：${id}`)
    ids.add(id)
    const fields = stringArray(value.fields, `contributes.settings.${index}.fields`)
    for (const field of fields) {
      if (!settingKeys.has(field)) fail(`设置区块 ${id} 引用了未声明设置：${field}`)
    }
    const actions = value.actions === undefined ? undefined : parseSettingsActions(value.actions, id, commands)
    const description = optionalString(value.description, `contributes.settings.${index}.description`, 240)
    return {
      id,
      title: requiredString(value.title, `contributes.settings.${index}.title`, 80),
      ...(description ? { description } : {}),
      fields,
      ...(actions ? { actions } : {}),
    }
  })
}

function parseSettingsActions(source: unknown, sectionId: string, commands: Set<string>) {
  if (!Array.isArray(source)) fail(`设置区块 ${sectionId} 的 actions 必须是数组`)
  return source.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`设置区块 ${sectionId} 的 action.${index} 必须是对象`)
    const value = raw as Record<string, unknown>
    const command = requiredString(value.command, `settings.${sectionId}.actions.${index}.command`, 64)
    if (!commands.has(command)) fail(`设置区块 ${sectionId} 引用了未声明命令：${command}`)
    const variant = value.variant === undefined ? undefined : requiredString(value.variant, `settings.${sectionId}.actions.${index}.variant`, 20)
    if (variant && !['default', 'outline', 'destructive'].includes(variant)) fail(`设置区块 ${sectionId} 使用了无效按钮样式`)
    const description = optionalString(value.description, `settings.${sectionId}.actions.${index}.description`, 200)
    return {
      command,
      title: requiredString(value.title, `settings.${sectionId}.actions.${index}.title`, 80),
      ...(description ? { description } : {}),
      ...(variant ? { variant: variant as 'default' | 'outline' | 'destructive' } : {}),
    }
  })
}

function parseCommands(source: unknown) {
  if (!Array.isArray(source)) fail('contributes.commands 必须是数组')
  const ids = new Set<string>()
  return source.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`commands.${index} 必须是对象`)
    const value = raw as Record<string, unknown>
    const id = requiredString(value.id, `commands.${index}.id`, 64)
    if (!CONTRIBUTION_ID_PATTERN.test(id) || ids.has(id)) fail(`无效或重复的命令 id：${id}`)
    ids.add(id)
    const description = optionalString(value.description, `commands.${index}.description`, 200)
    return {
      id,
      title: requiredString(value.title, `commands.${index}.title`, 80),
      ...(description ? { description } : {}),
    }
  })
}

function parseSlash(source: unknown, commands: Set<string>) {
  if (!Array.isArray(source)) fail('contributes.slash 必须是数组')
  return source.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`slash.${index} 必须是对象`)
    const value = raw as Record<string, unknown>
    const command = requiredString(value.command, `slash.${index}.command`, 64)
    if (!commands.has(command)) fail(`斜杠项引用了未声明的命令：${command}`)
    const keywords = value.keywords === undefined ? [] : stringArray(value.keywords, `slash.${index}.keywords`)
    return {
      command,
      title: requiredString(value.title, `slash.${index}.title`, 80),
      group: optionalString(value.group, `slash.${index}.group`, 40) ?? '扩展',
      keywords,
    }
  })
}

function stringArray(source: unknown, field: string): string[] {
  if (!Array.isArray(source)) fail(`${field} 必须是数组`)
  return source.map((value, index) => requiredString(value, `${field}.${index}`, 40))
}

function requiredString(source: unknown, field: string, max: number): string {
  if (typeof source !== 'string' || !source.trim() || source.length > max) fail(`${field} 必须是 1-${max} 个字符`)
  return source.trim()
}

function optionalString(source: unknown, field: string, max: number): string | undefined {
  if (source === undefined) return undefined
  if (typeof source !== 'string' || source.length > max) fail(`${field} 不能超过 ${max} 个字符`)
  return source.trim() || undefined
}

function optionalFiniteNumber(source: unknown, field: string): number | undefined {
  if (source === undefined) return undefined
  if (typeof source !== 'number' || !Number.isFinite(source)) fail(`${field} 必须是有限数字`)
  return source
}

function isSettingValue(value: unknown): value is ExtensionSettingValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
}

function settingValueMatches(type: ExtensionSettingDefinition['type'], value: ExtensionSettingValue): boolean {
  if (value === null) return true
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'number') return typeof value === 'number'
  return typeof value === 'string'
}

function fail(message: string): never {
  throw new ExtensionManifestError(message)
}

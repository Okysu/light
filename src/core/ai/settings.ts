import { AI_SCENARIOS } from './scenarios'
import type { EncryptedSecret } from './key-store'
import { PROVIDER_DEFAULTS, type ProviderConfig, type ProviderKind } from './types'

/**
 * AI 设置（6.1 / 6.4）。
 *
 * 存在 localStorage 而不是 `.light/workspace.json`：API Key 是**这台设备**的凭据，
 * 跟着数据目录走就意味着它会被同步到网盘、被打进导出的压缩包。
 * 这与「配置随库走」的一般原则相悖，但凭据是那条原则的例外。
 */

export interface AiSettings {
  /** 总开关（6.4）。关掉之后不发出任何 AI 相关网络请求 */
  enabled: boolean
  provider: ProviderConfig
  /** 加密后的 API Key；null 表示未配置。明文永不落盘 */
  secret: EncryptedSecret | null
  /** 分场景开关，键是场景 id。缺省视为开启 */
  scenarios: Record<string, boolean>
  /**
   * 单次回复的最大 token 数；0 表示不限制（不发这个字段）。
   *
   * 默认 0。写死一个数字等于替用户给所有模型加了个天花板，
   * 而「续写到一半没了」这种表现极难归因到一个他从没见过的配置上。
   * 想控制成本的人可以自己填。
   */
  maxTokens: number
  /**
   * 额外的请求体参数，原样保存用户输入的 JSON 文本。
   *
   * 存字符串而不是解析后的对象：用户写到一半（`{"reasoning_effort":`）
   * 时它就是非法 JSON，解析后存会把他正在打的内容丢掉。
   * 解析放在发请求那一刻，解不开就当没配。
   */
  extraBody: string
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  // 默认关闭。一个会往外发用户正文的功能，必须由用户明确打开——
  // 「默认开启，不想用可以关」在隐私上是站不住的
  enabled: false,
  provider: { kind: 'openai', baseUrl: '', model: '' },
  secret: null,
  scenarios: {},
  maxTokens: 0,
  extraBody: '',
}

/**
 * 场景是否可用。
 *
 * 总开关优先：关掉总开关时，即使某个场景单独被打开过也不能用。
 * 这是 6.4「允许用户完全关闭 AI 相关网络请求」的字面要求——
 * 「完全」不能有例外，否则那个开关就不值得信任。
 */
export function isScenarioEnabled(settings: AiSettings, id: string): boolean {
  if (!settings.enabled) return false
  return settings.scenarios[id] ?? true
}

/**
 * 解析额外参数。
 *
 * 解不开、或者解出来不是对象（`[1,2]`、`"abc"`）时返回 null 而不是抛错：
 * 一段写坏的可选配置不该让整个 AI 功能罢工。设置页会当场提示他格式不对，
 * 那里才是纠正的地方。
 */
export function parseExtraBody(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** 配置是否完整到可以发请求 */
export function isConfigured(settings: AiSettings): boolean {
  if (!settings.enabled) return false
  // 本地模型（自定义端点）通常不校验 Key，因此不强制要求填
  return settings.provider.kind === 'custom' || settings.secret !== null
}

/** 补上用户没填的端点与模型，得到一份可直接用于请求的配置 */
export function resolveProvider(provider: ProviderConfig): ProviderConfig {
  const defaults = PROVIDER_DEFAULTS[provider.kind]
  return {
    kind: provider.kind,
    baseUrl: provider.baseUrl.trim() || defaults.baseUrl,
    model: provider.model.trim() || defaults.model,
  }
}

/**
 * 读取持久化设置，逐字段兜底。
 *
 * 不用 `{...DEFAULT, ...parsed}`：那样一份被手工改坏的 JSON
 * （比如 `enabled: "true"` 这个字符串）会原样进来，之后到处都要提防。
 */
export function normalizeSettings(input: unknown): AiSettings {
  const raw = (input ?? {}) as Partial<AiSettings>
  const provider = (raw.provider ?? {}) as Partial<ProviderConfig>

  return {
    enabled: raw.enabled === true,
    provider: {
      kind: isProviderKind(provider.kind) ? provider.kind : DEFAULT_AI_SETTINGS.provider.kind,
      baseUrl: typeof provider.baseUrl === 'string' ? provider.baseUrl : '',
      model: typeof provider.model === 'string' ? provider.model : '',
    },
    secret: isSecret(raw.secret) ? raw.secret : null,
    scenarios: normalizeScenarios(raw.scenarios),
    // 负数与 NaN 都归零（= 不限制），免得拼出一个服务端会拒绝的请求
    maxTokens: Number.isFinite(raw.maxTokens) && Number(raw.maxTokens) > 0 ? Number(raw.maxTokens) : 0,
    extraBody: typeof raw.extraBody === 'string' ? raw.extraBody : '',
  }
}

function isProviderKind(value: unknown): value is ProviderKind {
  return value === 'openai' || value === 'anthropic' || value === 'custom'
}

function isSecret(value: unknown): value is EncryptedSecret {
  const secret = value as Partial<EncryptedSecret> | null
  return !!secret && typeof secret.cipher === 'string' && typeof secret.iv === 'string'
}

/** 只保留认识的场景 id：删掉某个场景后，它的残留开关不该留在配置里 */
function normalizeScenarios(input: unknown): Record<string, boolean> {
  const raw = (input ?? {}) as Record<string, unknown>
  const result: Record<string, boolean> = {}

  for (const scenario of AI_SCENARIOS) {
    if (typeof raw[scenario.id] === 'boolean') result[scenario.id] = raw[scenario.id] as boolean
  }
  return result
}

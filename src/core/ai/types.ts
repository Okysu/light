/**
 * AI 功能的类型契约（模块 6，BYOK）。
 *
 * **BYOK = Bring Your Own Key**：请求由用户的设备直连服务商，
 * 不经过任何 Light 的服务器。这不只是实现方式，是产品承诺——
 * 一个本地优先的笔记应用，如果把用户的正文送去自己的服务器中转，
 * 那前面所有关于「文件即真源」的话都不作数了。
 */

/** 服务商协议。自定义端点走 OpenAI 协议——它已是事实标准，Ollama、vLLM 等都兼容 */
export type ProviderKind = 'openai' | 'anthropic' | 'custom'

export interface ProviderConfig {
  kind: ProviderKind
  /** 自定义端点的基址，如 `http://localhost:11434/v1`；官方服务商留空用默认值 */
  baseUrl: string
  model: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /**
   * 随消息一起发送的图片（6.3 的 OCR / 图片描述）。
   *
   * 存 base64 而不是 URL：图片就在用户本地，没有可供服务商访问的地址。
   * 两家的多模态消息结构不同，转换放在各自的 provider 里——
   * 这里只表达「这条消息附了一张图」这个事实。
   */
  image?: { mime: string; base64: string }
}

/** 一次流式调用的参数 */
export interface StreamRequest {
  config: ProviderConfig
  apiKey: string
  messages: ChatMessage[]
  /** 中断信号（6.5）。用户点「停止」或关掉面板时必须真的停掉请求，而不只是不显示 */
  signal: AbortSignal
  /**
   * 单次回复的最大 token 数；不传则不加这个字段。
   *
   * 只有 Anthropic 协议**要求**它，OpenAI 协议不填就是模型的默认上限。
   * 因此默认不填——写死一个数字等于替用户给所有模型加了个天花板，
   * 而「续写到一半没了」这种表现极难归因到一个他从没见过的配置上。
   */
  maxTokens?: number
  /**
   * 合并进请求体的额外字段。
   *
   * 各家的可调项差异太大，而且还在变——推理力度、温度、思考预算、
   * 各种试验性开关。为每一个做一个输入框，既跟不上，也会把设置页堆满。
   * 开一个「额外参数」的口子，用户把服务商文档里的字段原样贴进来即可。
   *
   * 用户的字段**覆盖**我们的：这是它存在的意义。想改 model、想关 stream，
   * 都是他自己的决定——我们没有立场替他挡下来。
   */
  extraBody?: Record<string, unknown>
}

/**
 * 流里的一段增量。
 *
 * 思考与正文分成两种而不是拼成一个字符串：推理模型的思考往往比答案长好几倍，
 * 混在一起显示就成了「一大段看不懂的东西，然后不知道哪里开始是答案」。
 * 分开之后界面才有可能把思考折起来。
 */
export interface StreamChunk {
  kind: 'reasoning' | 'text'
  text: string
}

/**
 * 服务商适配器。
 *
 * 返回异步迭代器而不是回调：`for await` 天然支持 `break`，
 * 调用方中途放弃时不需要额外的注销逻辑；配合 AbortSignal 两层都能停。
 */
export interface AiProvider {
  stream(request: StreamRequest): AsyncIterable<StreamChunk>
}

/** 各服务商的默认端点与模型，用户没填时用它 */
export const PROVIDER_DEFAULTS: Record<ProviderKind, { baseUrl: string; model: string; label: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', label: 'OpenAI' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5', label: 'Anthropic' },
  custom: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', label: '自定义 / 本地模型' },
}

/**
 * AI 出错时的统一异常。
 *
 * 带上 `hint`：调用 AI 失败的原因高度集中在几种（key 不对、额度用完、
 * 本地模型没开 CORS），把排查方向直接写出来，比原样抛出服务商的英文报错有用得多。
 */
export class AiError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AiError'
  }
}

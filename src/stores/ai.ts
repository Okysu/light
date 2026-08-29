import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { canEncrypt, decryptSecret, encryptSecret, forgetDeviceKey } from '@/core/ai/key-store'
import { providerFor } from '@/core/ai/providers'
import {
  AI_SCENARIOS,
  findScenario,
  imagePrompt,
  instructionMessages,
  type AiScenario,
} from '@/core/ai/scenarios'
import {
  DEFAULT_AI_SETTINGS,
  isConfigured,
  isScenarioEnabled,
  normalizeSettings,
  parseExtraBody,
  resolveProvider,
  type AiSettings,
} from '@/core/ai/settings'
import { AiError, type ChatMessage } from '@/core/ai/types'

const STORAGE_KEY = 'light:ai'

/**
 * AI 会话状态（模块 6）。
 *
 * 一次只跑一个请求。可以做成并发队列，但那会带来「哪段输出属于哪次请求」的
 * 归属问题，而实际使用中用户就是选一段、点一个动作、等结果——
 * 为一个不存在的场景付出复杂度不划算（YAGNI）。
 */
export const useAiStore = defineStore('ai', () => {
  const settings = ref<AiSettings>(readSettings())

  /** 当前正在运行的场景；null 表示空闲 */
  const running = ref<AiScenario | null>(null)
  /** 已经收到的增量文本，边收边显示（6.5 的打字机效果） */
  const output = ref('')
  /** 模型的思考过程。与正文分开存，界面才能把它折起来 */
  const reasoning = ref('')
  const error = ref<string | null>(null)
  const hint = ref<string | null>(null)

  /** 中断句柄（6.5）。停止必须真的取消请求，而不只是不再显示 */
  let controller: AbortController | null = null

  const ready = computed(() => isConfigured(settings.value))
  const busy = computed(() => running.value !== null)

  /** 当前可用的场景，UI 直接拿它渲染菜单 */
  const availableScenarios = computed(() =>
    AI_SCENARIOS.filter((scenario) => isScenarioEnabled(settings.value, scenario.id)),
  )

  function save(next: AiSettings): void {
    settings.value = next
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  /**
   * 保存 API Key。
   *
   * 加密不可用时**拒绝保存**而不是退回明文。用户是在一个写着「本地加密存储」
   * 的界面里填的这个框，静默降级等于骗他。
   */
  async function saveApiKey(plaintext: string): Promise<void> {
    if (!plaintext.trim()) {
      save({ ...settings.value, secret: null })
      return
    }
    if (!canEncrypt()) {
      throw new AiError('当前环境不支持本地加密存储', '请使用较新的浏览器，或改用桌面客户端')
    }

    save({ ...settings.value, secret: await encryptSecret(plaintext.trim()) })
  }

  /** 清除凭据：连设备密钥一起销毁，旧密文从此再也解不开 */
  async function forgetApiKey(): Promise<void> {
    save({ ...settings.value, secret: null })
    await forgetDeviceKey()
  }

  /**
   * 跑一个场景。
   *
   * 返回完整结果，同时把增量写进 `output` 供 UI 实时渲染。
   * 两条路都保留：调用方可能只要最终文本（替换选区），也可能要过程（打字机）。
   */
  async function run(
    scenarioId: string,
    input: string,
    parameter?: string,
    onText?: (text: string) => void,
  ): Promise<string> {
    const scenario = findScenario(scenarioId)
    if (!scenario) throw new AiError(`未知的场景：${scenarioId}`)
    if (!isScenarioEnabled(settings.value, scenarioId)) {
      throw new AiError('该功能已被关闭', '在设置 → AI 里可以重新打开')
    }
    if (!input.trim()) throw new AiError('没有可处理的内容')

    return execute(scenario, scenario.build(input, parameter), onText)
  }

  /**
   * 图片 OCR / 描述（6.3 的最后一条）。
   *
   * 单独一条路径而不是塞进 `run`：它的输入是二进制而不是文本，
   * 硬要统一签名只会让另外十个场景都带上一个永远为空的图片参数。
   */
  async function describeImage(
    bytes: Uint8Array,
    mime: string,
    mode: 'ocr' | 'describe',
  ): Promise<string> {
    if (!settings.value.enabled) throw new AiError('AI 功能尚未启用')

    const scenario: AiScenario = {
      id: mode === 'ocr' ? 'image-ocr' : 'image-describe',
      label: mode === 'ocr' ? '提取图片文字' : '生成图片描述',
      description: '',
      target: 'selection',
      apply: 'suggest',
      build: () => [],
    }

    return execute(scenario, [
      { role: 'user', content: imagePrompt(mode), image: { mime, base64: toBase64(bytes) } },
    ])
  }

  /**
   * @param onText 每段正文增量的回调。给「流式写进编辑器」用——
   *   它需要的是逐段追加，而不是等全部结束后一次性替换。
   */
  async function execute(
    scenario: AiScenario,
    messages: ChatMessage[],
    onText?: (text: string) => void,
  ): Promise<string> {
    // 上一次还没停就再点一次：直接顶掉它。让用户先手动停止再重来是多余的一步
    stop()

    controller = new AbortController()
    running.value = scenario
    output.value = ''
    reasoning.value = ''
    error.value = null
    hint.value = null

    try {
      const apiKey = settings.value.secret ? ((await decryptSecret(settings.value.secret)) ?? '') : ''
      if (settings.value.secret && !apiKey) {
        throw new AiError(
          '保存的 API Key 解不开了',
          '设备密钥可能已随站点数据一起被清除，请在设置里重新填写一次',
        )
      }

      const extra = parseExtraBody(settings.value.extraBody)
      const provider = providerFor(settings.value.provider.kind)
      for await (const chunk of provider.stream({
        config: resolveProvider(settings.value.provider),
        apiKey,
        messages,
        signal: controller.signal,
        ...(settings.value.maxTokens > 0 ? { maxTokens: settings.value.maxTokens } : {}),
        ...(extra ? { extraBody: extra } : {}),
      })) {
        if (chunk.kind === 'reasoning') {
          reasoning.value += chunk.text
          continue
        }
        output.value += chunk.text
        // 逐段回调给调用方（流式写进编辑器时用它）。
        // 思考不回调——那些字不该出现在用户的笔记里
        onText?.(chunk.text)
      }

      return output.value
    } catch (cause) {
      // 用户主动停止不是错误。把已经收到的部分留在 output 里——
      // 他多半就是觉得够了才停的，清空反而毁掉了成果
      if (cause instanceof DOMException && cause.name === 'AbortError') return output.value

      error.value = cause instanceof Error ? cause.message : String(cause)
      hint.value = cause instanceof AiError ? (cause.hint ?? null) : null
      throw cause
    } finally {
      running.value = null
      controller = null
    }
  }

  function stop(): void {
    controller?.abort()
    controller = null
  }

  /**
   * 自由指令（划词工具条与斜杠命令）。
   *
   * 不走场景开关：它没有固定提示词，关掉它等于关掉 AI 总开关。
   * 但总开关仍然管着它——「完全关闭」不能有例外。
   */
  async function runInstruction(
    instruction: string,
    input: string,
    onText?: (text: string) => void,
  ): Promise<string> {
    if (!settings.value.enabled) throw new AiError('AI 功能尚未启用')
    if (!instruction.trim()) throw new AiError('请先说明要做什么')

    const scenario: AiScenario = {
      id: 'instruction',
      label: instruction.trim().slice(0, 20),
      description: '',
      target: 'selection',
      apply: 'replace',
      build: () => [],
    }

    return execute(scenario, instructionMessages(instruction, input), onText)
  }

  function reset(): void {
    stop()
    output.value = ''
    reasoning.value = ''
    error.value = null
    hint.value = null
  }

  return {
    settings,
    running,
    output,
    reasoning,
    error,
    hint,
    ready,
    busy,
    availableScenarios,
    save,
    saveApiKey,
    forgetApiKey,
    run,
    runInstruction,
    describeImage,
    stop,
    reset,
  }
})

/** 分块转 base64：几 MB 的图片一次性展开参数会把调用栈撑爆 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}

function readSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_AI_SETTINGS }
  } catch {
    return { ...DEFAULT_AI_SETTINGS }
  }
}

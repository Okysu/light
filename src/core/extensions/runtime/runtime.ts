import type { ExtensionToMainMessage, MainToExtensionMessage } from './protocol'

type ExtensionRequestMessage =
  | Omit<Extract<MainToExtensionMessage, { type: 'activate' }>, 'requestId'>
  | Omit<Extract<MainToExtensionMessage, { type: 'invoke' }>, 'requestId'>

export type ExtensionHostHandler = (method: string, args: unknown) => Promise<unknown>
export type ExtensionLogHandler = (level: 'info' | 'error', message: string) => void

export class ExtensionSandbox {
  private readonly worker: Worker
  private nextRequestId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private disposed = false

  constructor(
    private readonly host: ExtensionHostHandler,
    private readonly onLog: ExtensionLogHandler,
    private readonly onFatal: (error: Error) => void,
  ) {
    this.worker = new Worker(new URL('./extension-worker.ts', import.meta.url), { type: 'module' })
    this.worker.addEventListener('message', (event: MessageEvent<ExtensionToMainMessage>) => this.receive(event.data))
    this.worker.addEventListener('error', (event) => this.fail(new Error(event.message || '扩展 Worker 异常')))
  }

  activate(extensionId: string, source: string): Promise<unknown> {
    return this.request({ type: 'activate', extensionId, source })
  }

  invoke(command: string, args: unknown = null): Promise<unknown> {
    return this.request({ type: 'invoke', command, args })
  }

  emit(name: string, payload: unknown = null): void {
    if (this.disposed) return
    this.worker.postMessage({ type: 'event', name, payload } satisfies MainToExtensionMessage)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.worker.postMessage({ type: 'dispose' } satisfies MainToExtensionMessage)
    this.worker.terminate()
    for (const { reject } of this.pending.values()) reject(new Error('扩展已停止'))
    this.pending.clear()
  }

  private request(message: ExtensionRequestMessage): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('扩展已停止'))
    const requestId = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      const payload: MainToExtensionMessage = message.type === 'activate'
        ? { ...message, requestId }
        : { ...message, requestId }
      this.worker.postMessage(payload)
    })
  }

  private receive(message: ExtensionToMainMessage): void {
    if (message.type === 'result') {
      const request = this.pending.get(message.requestId)
      if (!request) return
      this.pending.delete(message.requestId)
      if (message.ok) request.resolve(message.value)
      else request.reject(new Error(message.error))
      return
    }
    if (message.type === 'log') {
      this.onLog(message.level, message.message)
      return
    }
    if (message.type === 'fatal') {
      this.fail(new Error(message.error))
      return
    }
    void this.host(message.method, message.args).then(
      (value) => this.worker.postMessage({ type: 'host-result', callId: message.callId, ok: true, value } satisfies MainToExtensionMessage),
      (cause) => this.worker.postMessage({ type: 'host-result', callId: message.callId, ok: false, error: cause instanceof Error ? cause.message : String(cause) } satisfies MainToExtensionMessage),
    )
  }

  private fail(error: Error): void {
    if (this.disposed) return
    this.onFatal(error)
    this.dispose()
  }
}

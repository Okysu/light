/// <reference lib="webworker" />

import type { QuickJSContext, QuickJSDeferredPromise } from 'quickjs-emscripten-core'
import type { ExtensionToMainMessage, MainToExtensionMessage } from './protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
const CPU_BUDGET_MS = 250
const MEMORY_LIMIT = 16 * 1024 * 1024
const STACK_LIMIT = 512 * 1024

let vm: QuickJSContext | null = null
let deadline = 0
let nextCallId = 1
const hostCalls = new Map<number, QuickJSDeferredPromise>()

scope.addEventListener('message', (event: MessageEvent<MainToExtensionMessage>) => {
  void receive(event.data).catch((cause) => {
    post({ type: 'fatal', error: errorMessage(cause) })
    dispose()
  })
})

async function receive(message: MainToExtensionMessage): Promise<void> {
  if (message.type === 'activate') {
    await respond(message.requestId, () => activate(message.extensionId, message.source))
    return
  }
  if (message.type === 'invoke') {
    await respond(message.requestId, () => invoke(message.command, message.args))
    return
  }
  if (message.type === 'host-result') {
    resolveHostCall(message)
    return
  }
  if (message.type === 'event') {
    await dispatchEvent(message.name, message.payload)
    return
  }
  dispose()
  scope.close()
}

async function activate(extensionId: string, source: string): Promise<unknown> {
  dispose()
  post({ type: 'log', level: 'info', message: '正在加载 QuickJS 沙箱' })
  const [{ newQuickJSWASMModuleFromVariant }, { default: releaseVariant }] = await Promise.all([
    import('quickjs-emscripten-core'),
    import('@jitl/quickjs-wasmfile-release-sync'),
  ])
  const quickJs = await newQuickJSWASMModuleFromVariant(releaseVariant)
  post({ type: 'log', level: 'info', message: 'QuickJS 沙箱已就绪' })
  const runtime = quickJs.newRuntime()
  runtime.setMemoryLimit(MEMORY_LIMIT)
  runtime.setMaxStackSize(STACK_LIMIT)
  runtime.setInterruptHandler(() => performance.now() > deadline)
  vm = runtime.newContext()

  installHostFunctions(vm)
  const bootstrap = bootstrapSource(extensionId)
  await evaluate(`"use strict";\n${bootstrap}\n`, 'light-bootstrap.js')
  return evaluate(`"use strict";\n(async () => {\n${source}\n})()`, `${extensionId}/main.js`)
}

async function invoke(command: string, args: unknown): Promise<unknown> {
  if (!vm) throw new Error('扩展尚未启动')
  const commandLiteral = JSON.stringify(command)
  const argsLiteral = JSON.stringify(args ?? null)
  return evaluate(`(async () => {
    const handler = globalThis.__lightHandlers[${commandLiteral}]
    if (typeof handler !== 'function') throw new Error('命令没有注册处理函数：' + ${commandLiteral})
    return await handler(${argsLiteral})
  })()`, 'light-command.js')
}

async function dispatchEvent(name: string, payload: unknown): Promise<void> {
  if (!vm) return
  const nameLiteral = JSON.stringify(name)
  const payloadLiteral = JSON.stringify(payload ?? null)
  await evaluate(`(async () => {
    const handlers = globalThis.__lightEventHandlers[${nameLiteral}] || []
    for (const handler of [...handlers]) await handler(${payloadLiteral})
  })()`, 'light-event.js')
}

function installHostFunctions(context: QuickJSContext): void {
  const hostCall = context.newFunction('__lightHostCall', (methodHandle, argsHandle) => {
    const method = context.getString(methodHandle)
    const argsSource = context.getString(argsHandle)
    const callId = nextCallId++
    const deferred = context.newPromise()
    hostCalls.set(callId, deferred)
    deferred.settled.finally(() => {
      hostCalls.delete(callId)
      deferred.dispose()
    })
    post({ type: 'host-call', callId, method, args: parseJson(argsSource) })
    return deferred.handle
  })
  hostCall.consume((handle) => context.setProp(context.global, '__lightHostCall', handle))

  const log = context.newFunction('__lightLog', (levelHandle, messageHandle) => {
    const level = context.getString(levelHandle) === 'error' ? 'error' : 'info'
    post({ type: 'log', level, message: context.getString(messageHandle).slice(0, 4000) })
  })
  log.consume((handle) => context.setProp(context.global, '__lightLog', handle))
}

function resolveHostCall(message: Extract<MainToExtensionMessage, { type: 'host-result' }>): void {
  const context = vm
  const deferred = hostCalls.get(message.callId)
  if (!context || !deferred) return
  resetDeadline()
  if (message.ok) {
    const result = context.newString(JSON.stringify(message.value ?? null))
    deferred.resolve(result)
    result.dispose()
  } else {
    const error = context.newError(message.error)
    deferred.reject(error)
    error.dispose()
  }
  runJobs()
}

async function evaluate(code: string, filename: string): Promise<unknown> {
  const context = vm
  if (!context) throw new Error('扩展运行环境不可用')
  resetDeadline()
  const evaluated = context.evalCode(code, filename)
  if (evaluated.error) {
    const dumped = context.dump(evaluated.error)
    evaluated.error.dispose()
    throw dumped instanceof Error ? dumped : new Error(formatDump(dumped))
  }
  const promiseHandle = evaluated.value
  try {
    const resolving = context.resolvePromise(promiseHandle)
    // resolvePromise 会在 QuickJS 内注册 then 回调；即使原值不是 Promise，
    // 这个回调也要显式跑一次 pending jobs 才会兑现到宿主 Promise。
    runJobs()
    const settled = await resolving
    if (settled.error) {
      const dumped = context.dump(settled.error)
      settled.error.dispose()
      throw dumped instanceof Error ? dumped : new Error(formatDump(dumped))
    }
    const value = context.dump(settled.value)
    settled.value.dispose()
    return value
  } finally {
    promiseHandle.dispose()
  }
}

function runJobs(): void {
  const context = vm
  if (!context) return
  resetDeadline()
  const result = context.runtime.executePendingJobs()
  if (result.error) {
    const dumped = context.dump(result.error)
    result.error.dispose()
    post({ type: 'fatal', error: formatDump(dumped) })
    dispose()
  }
}

function dispose(): void {
  for (const deferred of hostCalls.values()) {
    try { deferred.dispose() } catch { /* 运行时可能已经释放。 */ }
  }
  hostCalls.clear()
  if (vm) {
    const context = vm
    vm = null
    try {
      const runtime = context.runtime
      context.dispose()
      runtime.dispose()
    } catch {
      // 崩溃后的清理尽力而为，Worker 随后会被宿主终止。
    }
  }
}

function bootstrapSource(extensionId: string): string {
  return `
globalThis.__lightHandlers = Object.create(null)
globalThis.__lightEventHandlers = Object.create(null)
const __call = (method, args = null) => __lightHostCall(method, JSON.stringify(args)).then(JSON.parse)
const __freeze = (value) => Object.freeze(value)
const __emitLocal = async (name, payload) => {
  const handlers = globalThis.__lightEventHandlers[name] || []
  for (const handler of [...handlers]) await handler(payload)
}
globalThis.console = __freeze({
  log: (...values) => __lightLog('info', values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')),
  error: (...values) => __lightLog('error', values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')),
})
globalThis.light = __freeze({
  extension: __freeze({ id: ${JSON.stringify(extensionId)} }),
  app: __freeze({ getContext: () => __call('app.getContext') }),
  settings: __freeze({
    get: (key) => __call('settings.get', { key }),
    set: async (key, value) => {
      await __call('settings.set', { key, value })
      await __emitLocal('settings.changed', { key, value })
    },
  }),
  storage: __freeze({
    get: (key) => __call('storage.get', { key }),
    set: (key, value) => __call('storage.set', { key, value }),
  }),
  commands: __freeze({
    handle: (id, handler) => {
      if (typeof id !== 'string' || typeof handler !== 'function') throw new TypeError('commands.handle 参数无效')
      globalThis.__lightHandlers[id] = handler
    },
  }),
  events: __freeze({
    on: (name, handler) => {
      if (typeof name !== 'string' || typeof handler !== 'function') throw new TypeError('events.on 参数无效')
      const list = globalThis.__lightEventHandlers[name] || (globalThis.__lightEventHandlers[name] = [])
      list.push(handler)
      return () => {
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      }
    },
  }),
  ui: __freeze({ showToast: (options) => __call('ui.showToast', options) }),
  workspace: __freeze({
    list: (path = '') => __call('workspace.list', { path }),
    readText: (path) => __call('workspace.readText', { path }),
    writeText: (path, contents) => __call('workspace.writeText', { path, contents }),
    trash: (path) => __call('workspace.trash', { path }),
    search: (query, options = {}) => __call('workspace.search', { query, ...options }),
  }),
  document: __freeze({
    getActive: () => __call('document.getActive'),
    getText: () => __call('document.getText'),
    getSelection: () => __call('document.getSelection'),
    replaceSelection: (markdown) => __call('document.replaceSelection', { markdown }),
    insertAfterSelection: (markdown) => __call('document.insertAfterSelection', { markdown }),
  }),
  ai: __freeze({
    isAvailable: () => __call('ai.isAvailable'),
    complete: (options) => __call('ai.complete', options),
  }),
})
Object.freeze(globalThis.light)
`
}

async function respond(requestId: number, action: () => Promise<unknown>): Promise<void> {
  try {
    post({ type: 'result', requestId, ok: true, value: await action() })
  } catch (cause) {
    post({ type: 'result', requestId, ok: false, error: errorMessage(cause) })
  }
}

function resetDeadline(): void {
  deadline = performance.now() + CPU_BUDGET_MS
}

function post(message: ExtensionToMainMessage): void {
  scope.postMessage(message)
}

function parseJson(source: string): unknown {
  try { return JSON.parse(source) as unknown } catch { return null }
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return formatDump(cause)
}

function formatDump(value: unknown): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.message === 'string') return record.message
  }
  try { return JSON.stringify(value) } catch { return String(value) }
}

export {}

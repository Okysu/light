export type MainToExtensionMessage =
  | { type: 'activate'; requestId: number; extensionId: string; source: string }
  | { type: 'invoke'; requestId: number; command: string; args: unknown }
  | { type: 'host-result'; callId: number; ok: true; value: unknown }
  | { type: 'host-result'; callId: number; ok: false; error: string }
  | { type: 'event'; name: string; payload: unknown }
  | { type: 'dispose' }

export type ExtensionToMainMessage =
  | { type: 'result'; requestId: number; ok: true; value: unknown }
  | { type: 'result'; requestId: number; ok: false; error: string }
  | { type: 'host-call'; callId: number; method: string; args: unknown }
  | { type: 'log'; level: 'info' | 'error'; message: string }
  | { type: 'fatal'; error: string }

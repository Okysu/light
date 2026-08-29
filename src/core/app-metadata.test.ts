import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from './app-metadata'

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string }

describe('应用版本来源', () => {
  it('界面版本与 package.json 保持一致', () => {
    expect(APP_VERSION).toBe(version)
  })
})

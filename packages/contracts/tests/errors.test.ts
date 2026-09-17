/**
 * エラーコードの網羅性。コードを足してメッセージか HTTP ステータスを忘れる、
 * というのがいちばん起きやすい抜けなので機械的に検査する。
 */
import { describe, expect, it } from 'vitest'
import { ERROR_CODES, ERROR_MESSAGES_JA, ERROR_STATUS } from '../src/errors'

describe('ERROR_CODES', () => {
  it('重複が無い', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })

  it('すべてのコードに日本語メッセージがある', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_MESSAGES_JA[code], code).toBeTruthy()
    }
    expect(Object.keys(ERROR_MESSAGES_JA).sort()).toEqual([...ERROR_CODES].sort())
  })

  it('すべてのコードに HTTP ステータスがある', () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort())
  })

  it('ステータスは 4xx か 5xx', () => {
    for (const code of ERROR_CODES) {
      const status = ERROR_STATUS[code]
      expect(status, code).toBeGreaterThanOrEqual(400)
      expect(status, code).toBeLessThan(600)
    }
  })

  it('入力の誤りは 4xx（サーバーのせいにしない）', () => {
    for (const code of ['GOAL_INPUT', 'SAME_AS_CURRENT', 'OOV', 'INVALID_RATIO'] as const) {
      expect(ERROR_STATUS[code], code).toBe(422)
    }
  })

  it('メッセージは日本語で、コード名をそのまま出していない', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_MESSAGES_JA[code]).not.toContain(code)
    }
  })
})

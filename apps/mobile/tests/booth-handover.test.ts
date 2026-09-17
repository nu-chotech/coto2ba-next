/**
 * ブースモードの「次の人へ」（SPEC §8.8）。
 *
 * **展示中に必ず踏む事故を固定する。** 「次の人へ」が作る匿名ユーザーの
 * `users.booth` は DB 既定の false なので、そのままだと係員が設定タブを開くか
 * Expo Go をリロードした瞬間にブースモードが OFF に落ちる。落ちると以後の
 * 来場者が**同一アカウントを共有**し、ランキング・図鑑・引き継ぎ QR が混ざる。
 *
 * React を描かずに振る舞いを検証できるよう、判断は純粋な関数に切り出してある
 * （画面は `handOverToNextPlayer` を呼ぶだけ）。
 */

import { describe, expect, it } from 'vitest'
import {
  BOOTH_HANDOVER_FAILED_JA,
  BOOTH_LOST_JA,
  handOverToNextPlayer,
} from '../src/features/profile/booth'

/** 呼ばれた回数と引数を覚えるだけの差し替え。 */
function recorder<T>(result: () => Promise<T>) {
  const calls: unknown[][] = []
  return {
    calls,
    fn: (...args: unknown[]) => {
      calls.push(args)
      return result()
    },
  }
}

const switched = () => Promise.resolve({ switched: true, token: 'new-token' })
const notSwitched = () => Promise.resolve({ switched: false, token: 'old-token' })

describe('handOverToNextPlayer', () => {
  it('ブースモードのまま次の人に引き継がれる（新しいユーザーに booth を入れ直す）', async () => {
    const patch = recorder(() => Promise.resolve())
    const result = await handOverToNextPlayer({
      boothMode: true,
      resetSession: switched,
      applyBooth: patch.fn,
    })
    expect(result).toEqual({ switched: true, boothKept: true, messageJa: null })
    // 新しいユーザーに対して 1 回だけ打つ。
    expect(patch.calls).toHaveLength(1)
  })

  it('ブースモードでなければ PATCH を打たない', async () => {
    const patch = recorder(() => Promise.resolve())
    const result = await handOverToNextPlayer({
      boothMode: false,
      resetSession: switched,
      applyBooth: patch.fn,
    })
    expect(result.switched).toBe(true)
    expect(result.boothKept).toBe(true)
    expect(patch.calls).toHaveLength(0)
  })

  /**
   * 切り替えに失敗したときに booth を打つと、**いまの人**（前の来場者）に
   * 打つことになる。切り替わっていないのだから何もしない。
   */
  it('セッションの切り替えに失敗したら PATCH を打たない', async () => {
    const patch = recorder(() => Promise.resolve())
    const result = await handOverToNextPlayer({
      boothMode: true,
      resetSession: notSwitched,
      applyBooth: patch.fn,
    })
    expect(result.switched).toBe(false)
    expect(result.messageJa).toBe(BOOTH_HANDOVER_FAILED_JA)
    expect(patch.calls).toHaveLength(0)
  })

  // 黙って落とさない。係員が設定タブで入れ直せるように画面に出す。
  it('booth の入れ直しに失敗したら、失敗したと分かる形で返す', async () => {
    const patch = recorder(() => Promise.reject(new Error('offline')))
    const result = await handOverToNextPlayer({
      boothMode: true,
      resetSession: switched,
      applyBooth: patch.fn,
    })
    expect(result.switched).toBe(true)
    expect(result.boothKept).toBe(false)
    expect(result.messageJa).toBe(BOOTH_LOST_JA)
  })
})

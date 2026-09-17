/**
 * 対戦ルームの状態遷移と順位付け（SPEC §9.2）。
 *
 * **DB を触らない純粋関数だけ**をここで固定する。サービス側（services/rooms.ts）は
 * この関数を通してしか状態を進めないので、ルールの権威はここにある。
 */
import { ROOM_MAX_PLAYERS, ROOM_MIN_PLAYERS } from '@coto2ba/contracts'
import { describe, expect, it } from 'vitest'
import { canJoin, canStart, type RoomPlayerState, rankPlayers } from '../src/services/room-rules'

const player = (over: Partial<RoomPlayerState> = {}): RoomPlayerState => ({
  userId: 'u1',
  displayName: '静かな蚕',
  moveCount: 0,
  bestRank: 9999,
  hintCount: 0,
  finishedAt: null,
  ...over,
})

describe('canJoin', () => {
  it('待機中で満員でなければ入れる', () => {
    expect(canJoin({ status: 'waiting', playerCount: 1 })).toBe(true)
  })

  // 途中参加を許すと、後から入った人が短い時間で勝ててしまう。
  it('開始後は入れない', () => {
    expect(canJoin({ status: 'playing', playerCount: 1 })).toBe(false)
    expect(canJoin({ status: 'finished', playerCount: 1 })).toBe(false)
  })

  it('満員なら入れない', () => {
    expect(canJoin({ status: 'waiting', playerCount: ROOM_MAX_PLAYERS })).toBe(false)
  })
})

describe('canStart', () => {
  it('ホストだけが開始できる', () => {
    const room = { status: 'waiting' as const, playerCount: ROOM_MIN_PLAYERS }
    expect(canStart(room, 'host', 'host')).toBe(true)
    expect(canStart(room, 'someone', 'host')).toBe(false)
  })

  it('人数が足りなければ開始できない', () => {
    expect(canStart({ status: 'waiting', playerCount: ROOM_MIN_PLAYERS - 1 }, 'h', 'h')).toBe(false)
  })

  it('すでに開始していれば開始できない', () => {
    expect(canStart({ status: 'playing', playerCount: ROOM_MIN_PLAYERS }, 'h', 'h')).toBe(false)
  })
})

describe('rankPlayers', () => {
  it('クリアした人が未クリアより上', () => {
    const ranked = rankPlayers([
      player({ userId: 'a', finishedAt: null, bestRank: 2 }),
      player({ userId: 'b', finishedAt: '2026-10-01T00:00:10.000Z', bestRank: 1 }),
    ])
    expect(ranked[0]?.userId).toBe('b')
  })

  it('クリア同士は早い順', () => {
    const ranked = rankPlayers([
      player({ userId: 'a', finishedAt: '2026-10-01T00:00:20.000Z' }),
      player({ userId: 'b', finishedAt: '2026-10-01T00:00:10.000Z' }),
    ])
    expect(ranked.map((p) => p.userId)).toEqual(['b', 'a'])
  })

  it('未クリア同士はランクが良い順、同率なら手数が少ない順', () => {
    const ranked = rankPlayers([
      player({ userId: 'a', bestRank: 5, moveCount: 3 }),
      player({ userId: 'b', bestRank: 5, moveCount: 2 }),
      player({ userId: 'c', bestRank: 2, moveCount: 9 }),
    ])
    expect(ranked.map((p) => p.userId)).toEqual(['c', 'b', 'a'])
  })

  it('完全に同値なら userId で決める（表示が毎秒入れ替わらないように）', () => {
    const ranked = rankPlayers([player({ userId: 'b' }), player({ userId: 'a' })])
    expect(ranked.map((p) => p.userId)).toEqual(['a', 'b'])
  })

  /**
   * **ヒントは順位で課金する（デイリーのランキングと同じ原則）。**
   *
   * ヒントの一番上に従うと実測で 51% がクリア圏に着地する。対戦で無料なら
   * 押した側が数秒で勝ち、真面目に混ぜている側はまず勝てない。
   * 禁止も隠蔽もせず、**使ったぶんだけ順位で不利**にする。
   */
  it('同じ状況なら、ヒントを使っていない人が上', () => {
    const ranked = rankPlayers([
      player({ userId: 'a', bestRank: 5, moveCount: 2, hintCount: 1 }),
      player({ userId: 'b', bestRank: 5, moveCount: 2, hintCount: 0 }),
    ])
    expect(ranked.map((p) => p.userId)).toEqual(['b', 'a'])
  })

  // ヒントは手数より先に効く（デイリーの「ヒント数 → 手数」と同じ順序）。
  it('ヒント数は手数より先に効く', () => {
    const ranked = rankPlayers([
      player({ userId: 'a', bestRank: 5, moveCount: 1, hintCount: 2 }),
      player({ userId: 'b', bestRank: 5, moveCount: 9, hintCount: 0 }),
    ])
    expect(ranked.map((p) => p.userId)).toEqual(['b', 'a'])
  })

  // ヒントより「ゴールにどれだけ近いか」が先。未クリアの順序が逆転しない。
  it('ヒントを使っていても、ランクが良ければ上', () => {
    const ranked = rankPlayers([
      player({ userId: 'a', bestRank: 2, hintCount: 3 }),
      player({ userId: 'b', bestRank: 40, hintCount: 0 }),
    ])
    expect(ranked.map((p) => p.userId)).toEqual(['a', 'b'])
  })

  /**
   * **対戦の主ルールは「最初にゴールへ着いた人が勝ち」。**
   * ヒントを使って先に着いた人を後着の人より下げてはいけない
   * （レースの勝者が後から入れ替わると、その場で見ていた全員の理解と食い違う）。
   */
  it('クリア済み同士はヒント数より着順が優先', () => {
    const ranked = rankPlayers([
      player({ userId: 'a', finishedAt: '2026-10-01T00:00:10.000Z', hintCount: 3 }),
      player({ userId: 'b', finishedAt: '2026-10-01T00:00:20.000Z', hintCount: 0 }),
    ])
    expect(ranked.map((p) => p.userId)).toEqual(['a', 'b'])
  })

  // 同着（サーバーが打つ時刻がミリ秒まで並んだとき）はヒント数で解く。
  it('クリアが同着ならヒント数の少ない人が上', () => {
    const at = '2026-10-01T00:00:10.000Z'
    const ranked = rankPlayers([
      player({ userId: 'a', finishedAt: at, hintCount: 2 }),
      player({ userId: 'b', finishedAt: at, hintCount: 0 }),
    ])
    expect(ranked.map((p) => p.userId)).toEqual(['b', 'a'])
  })

  it('入力を破壊しない', () => {
    const input = [player({ userId: 'b' }), player({ userId: 'a' })]
    rankPlayers(input)
    expect(input.map((p) => p.userId)).toEqual(['b', 'a'])
  })
})

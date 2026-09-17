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

  it('入力を破壊しない', () => {
    const input = [player({ userId: 'b' }), player({ userId: 'a' })]
    rankPlayers(input)
    expect(input.map((p) => p.userId)).toEqual(['b', 'a'])
  })
})

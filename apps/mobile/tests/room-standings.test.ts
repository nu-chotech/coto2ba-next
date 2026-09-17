/**
 * レース中の順位オーバーレイを畳んだときに、**どの行を残すか**（SPEC §9.2）。
 *
 * 8 人ぶんを全部出すとゲームの入力欄が画面外に落ちる
 * （390×844 の画面で input の top が 987 になっていた ＝ 満員に近いほど遊べない）。
 * 畳んでも「誰が勝っているか」「自分は何位か」「あと誰を抜けばいいか」は残す。
 *
 * **順位は元の並びのまま**であること（詰め直して 1,2,3 に見せない）もここで固定する。
 * 詰め直すと 5 位の人が 3 位に見えてレースが成立しない。
 */
import type { RoomPlayer } from '@coto2ba/contracts'
import { describe, expect, it } from 'vitest'
import { ROOM_STANDING_COLLAPSED_ROWS } from '../src/features/rooms/constants'
import { collapsedRowsFor, pickImportantRows } from '../src/features/rooms/standings'

function player(id: string, isMe = false): RoomPlayer {
  return {
    user_id: id,
    display_name: id,
    move_count: 0,
    best_rank: 100,
    finished_at: null,
    is_me: isMe,
  }
}

/** サーバーが返した並び（1 位から）。 */
function room(size: number, meIndex: number): RoomPlayer[] {
  return Array.from({ length: size }, (_, i) => player(`p${i + 1}`, i === meIndex))
}

describe('pickImportantRows', () => {
  it('人数が収まるときは全員そのまま', () => {
    const picked = pickImportantRows(room(3, 1), ROOM_STANDING_COLLAPSED_ROWS)
    expect(picked.map((e) => e.player.user_id)).toEqual(['p1', 'p2', 'p3'])
    expect(picked.map((e) => e.rank)).toEqual([1, 2, 3])
  })

  it('8 人でも畳めば 3 行に収まる', () => {
    const picked = pickImportantRows(room(8, 4), ROOM_STANDING_COLLAPSED_ROWS)
    expect(picked).toHaveLength(ROOM_STANDING_COLLAPSED_ROWS)
  })

  it('首位・自分のすぐ上・自分を残す', () => {
    // 自分は 5 位（index 4）。
    const picked = pickImportantRows(room(8, 4), ROOM_STANDING_COLLAPSED_ROWS)
    expect(picked.map((e) => e.player.user_id)).toEqual(['p1', 'p4', 'p5'])
  })

  // 1 行しか残せないときに首位を出すと、**自分が何位か分からなくなる**。
  it('1 行しか残せないときは自分を残す', () => {
    const picked = pickImportantRows(room(8, 4), 1)
    expect(picked).toHaveLength(1)
    expect(picked[0]?.player.is_me).toBe(true)
    expect(picked[0]?.rank).toBe(5)
  })

  it('自分がいなくて 1 行なら首位を残す', () => {
    const picked = pickImportantRows(room(8, -1), 1)
    expect(picked.map((e) => e.rank)).toEqual([1])
  })

  // **順位を詰め直さない。** 5 位の人が 3 位に見えるとレースにならない。
  it('残した行の順位は元のまま', () => {
    const picked = pickImportantRows(room(8, 4), ROOM_STANDING_COLLAPSED_ROWS)
    expect(picked.map((e) => e.rank)).toEqual([1, 4, 5])
  })

  it('自分が首位なら上から埋める', () => {
    const picked = pickImportantRows(room(8, 0), ROOM_STANDING_COLLAPSED_ROWS)
    expect(picked.map((e) => e.rank)).toEqual([1, 2, 3])
  })

  it('自分が最下位でも自分の行は必ず残る', () => {
    const picked = pickImportantRows(room(8, 7), ROOM_STANDING_COLLAPSED_ROWS)
    expect(picked.some((e) => e.player.is_me)).toBe(true)
    expect(picked.map((e) => e.rank)).toEqual([1, 7, 8])
  })

  // 自分の行がまだ無い（参加直後など）でも落ちない。
  it('自分がいなくても上から埋める', () => {
    const picked = pickImportantRows(room(8, -1), ROOM_STANDING_COLLAPSED_ROWS)
    expect(picked.map((e) => e.rank)).toEqual([1, 2, 3])
  })

  it('常に順位の昇順で返る', () => {
    const picked = pickImportantRows(room(8, 6), ROOM_STANDING_COLLAPSED_ROWS)
    const ranks = picked.map((e) => e.rank)
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
  })
})

describe('collapsedRowsFor', () => {
  // 少人数なら全員出しても操作系を押し下げない。
  it('3 人までは全員出す', () => {
    expect(collapsedRowsFor(1)).toBe(1)
    expect(collapsedRowsFor(2)).toBe(2)
    expect(collapsedRowsFor(ROOM_STANDING_COLLAPSED_ROWS)).toBe(ROOM_STANDING_COLLAPSED_ROWS)
  })

  // 4 人以上は見出しだけ。ここが崩れると入力欄と「混ぜる」が画面外に落ちる。
  // 自分の順位と温度はゲーム画面本体が出しているので、行が無くても困らない。
  it('4 人以上は見出しだけに畳む', () => {
    expect(collapsedRowsFor(4)).toBe(0)
    expect(collapsedRowsFor(8)).toBe(0)
  })
})

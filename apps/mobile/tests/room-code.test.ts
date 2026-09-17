/**
 * 参加コードの正規化と、QR のディープリンクからの取り出し（設計 §9.5）。
 *
 * ブースの導線は 2 つある。
 * 1. ホスト端末のコードを**口で読み上げて**来場者が手で入れる
 * 2. QR（`exp://…?room=CODE`）をカメラで読む
 *
 * どちらも**打ち間違い・全角・小文字**が普通に混ざる。ここが緩すぎると
 * 「コードを入れたのに入れない」がブースで起きるので、吸収する範囲を固定しておく。
 */
import type { RoomResponse } from '@coto2ba/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  isHost,
  markRoomJoinAttempted,
  myStanding,
  normalizeRoomCode,
  openRoomFromDeepLink,
  rememberCode,
  resetRoomCodeMemory,
  roomCodeFromUrl,
  shouldJoinOnArrival,
  winnerOf,
} from '../src/features/rooms/code'

describe('normalizeRoomCode', () => {
  it('小文字を大文字にする', () => {
    expect(normalizeRoomCode('q83d')).toBe('Q83D')
  })

  it('前後の空白と途中の空白を落とす', () => {
    expect(normalizeRoomCode('  Q 83 D ')).toBe('Q83D')
  })

  // 日本語キーボードだと全角で入ることがある。
  it('全角英数を半角にする', () => {
    expect(normalizeRoomCode('Ｑ８３Ｄ')).toBe('Q83D')
    expect(normalizeRoomCode('ｑ８３ｄ')).toBe('Q83D')
  })

  it('区切り文字を落とす', () => {
    expect(normalizeRoomCode('Q-83-D')).toBe('Q83D')
    expect(normalizeRoomCode('Q・83・D')).toBe('Q83D')
  })

  it('英数字以外は落とす', () => {
    expect(normalizeRoomCode('あQ8い3うD')).toBe('Q83D')
  })

  it('空文字は空文字のまま', () => {
    expect(normalizeRoomCode('')).toBe('')
    expect(normalizeRoomCode('   ')).toBe('')
  })
})

describe('roomCodeFromUrl', () => {
  it('EAS Update のディープリンクから取り出す', () => {
    const url =
      'exp://u.expo.dev/73c7cda9?channel-name=production&runtime-version=exposdk%3A57.0.0&room=Q83D'
    expect(roomCodeFromUrl(url)).toBe('Q83D')
  })

  it('ランディングへのフォールバック形式からも取り出す', () => {
    expect(roomCodeFromUrl('https://coto2ba-next.chotech.dev/?room=Q83D')).toBe('Q83D')
  })

  // `room` が付かない普通の起動（開発サーバーの URL など）では何もしない。
  it('room が無ければ null', () => {
    expect(roomCodeFromUrl('exp://192.168.1.5:8081')).toBeNull()
    expect(roomCodeFromUrl('https://example.com/?transfer=ABCD')).toBeNull()
  })

  it('room が空なら null', () => {
    expect(roomCodeFromUrl('exp://x?room=')).toBeNull()
    expect(roomCodeFromUrl('exp://x?room=%20')).toBeNull()
  })

  // `transfer=` の中に room という字が含まれても拾わない。
  it('別のクエリの一部を拾わない', () => {
    expect(roomCodeFromUrl('exp://x?bedroom=Q83D')).toBeNull()
  })

  // 壊れた QR を読んだときに**例外で画面を落とさない**ことが要件。
  // 取れた値が無効なら、最終的にサーバーが 404 で弾く（判定の権威はサーバー）。
  it('壊れたエスケープでも例外にならない', () => {
    expect(() => roomCodeFromUrl('exp://x?room=%E3%81')).not.toThrow()
    expect(roomCodeFromUrl('exp://x?room=%E3%81')).toBe('E381')
  })
})

function room(over: Partial<RoomResponse> = {}): RoomResponse {
  return {
    code: 'Q83D',
    status: 'playing',
    host_user_id: 'host',
    difficulty: 'normal',
    goal: 'ゴール',
    start: 'スタート',
    players: [],
    my_game_id: null,
    my_game_status: null,
    next_code: null,
    join_url: 'exp://x?room=Q83D',
    ...over,
  }
}

const player = (id: string, over: Partial<RoomResponse['players'][number]> = {}) => ({
  user_id: id,
  display_name: id,
  move_count: 0,
  hint_count: 0,
  best_rank: 100,
  finished_at: null,
  is_me: false,
  ...over,
})

describe('winnerOf', () => {
  // サーバーが並べた順（rankPlayers）の 1 番目だけを見る。端末で並べ替えない。
  it('先頭がゴール済みならその人', () => {
    const r = room({
      players: [player('a', { finished_at: '2026-10-01T00:00:00.000Z' }), player('b')],
    })
    expect(winnerOf(r)?.user_id).toBe('a')
  })

  it('まだ誰も着いていなければ null', () => {
    expect(winnerOf(room({ players: [player('a'), player('b')] }))).toBeNull()
  })

  it('部屋がまだ無ければ null', () => {
    expect(winnerOf(undefined)).toBeNull()
  })
})

describe('myStanding', () => {
  it('is_me の行を返す', () => {
    const r = room({ players: [player('a'), player('b', { is_me: true })] })
    expect(myStanding(r)?.user_id).toBe('b')
  })

  it('自分がいなければ null', () => {
    expect(myStanding(room({ players: [player('a')] }))).toBeNull()
  })
})

describe('isHost', () => {
  it('host_user_id と一致すれば true', () => {
    expect(isHost(room(), 'host')).toBe(true)
  })

  it('違えば false', () => {
    expect(isHost(room(), 'guest')).toBe(false)
  })

  // まだ /api/me が返っていないときに誤ってホスト扱いしない。
  it('userId が null なら false', () => {
    expect(isHost(room(), null)).toBe(false)
  })

  it('部屋がまだ無ければ false', () => {
    expect(isHost(undefined, 'host')).toBe(false)
  })
})

/**
 * **QR（ディープリンク）で着地したとき、参加リクエストが実際に投げられること。**
 *
 * ここは一度、沈黙して壊れた。ディープリンクの「飛ばした」印を
 * 「参加を投げた」印と共有した瞬間、着地した部屋の画面が
 * 「もう投げた」と判断して **join を 1 本も投げなくなった**。
 * ポーリングは参加が通るまで止めてあるので join も poll も飛ばず、
 * エラーも出ないまま画面が固まった。**QR ＝ ブースの主動線**が死ぬ。
 *
 * だから固定するのは「Set がいくつあるか」ではなく、
 * **ゲートが処理したあとで着地先が join を投げるか**という外から見た結果。
 */
describe('QR で着地したときの参加', () => {
  beforeEach(() => resetRoomCodeMemory())

  it('ゲートが処理したあと、着地した画面は参加を投げる', () => {
    const code = openRoomFromDeepLink('exp://u.expo.dev/proj?channel-name=production&room=Q83D')
    expect(code).toBe('Q83D')
    // ここが false になると、join も poll も飛ばないまま画面が固まる。
    expect(shouldJoinOnArrival(code as string)).toBe(true)
  })

  it('手入力で来たときも参加を投げる', () => {
    // 入口を経由せず直接 /play/room/Q83D を開いた場合。
    expect(shouldJoinOnArrival('Q83D')).toBe(true)
  })

  it('着地先が二度描かれても参加は 1 回だけ', () => {
    const code = openRoomFromDeepLink('exp://x?room=Q83D') as string
    expect(shouldJoinOnArrival(code)).toBe(true)
    // Web は hydrate 直後にルート木を 1 度作り直す。2 本目は投げない。
    expect(shouldJoinOnArrival(code)).toBe(false)
  })

  it('入口から投げた直後に着地しても、二重には投げない', () => {
    markRoomJoinAttempted('Q83D')
    expect(shouldJoinOnArrival('Q83D')).toBe(false)
  })

  it('同じ URL が何度も届いても、飛ばすのは 1 回だけ', () => {
    expect(openRoomFromDeepLink('exp://x?room=Q83D')).toBe('Q83D')
    expect(openRoomFromDeepLink('exp://x?room=Q83D')).toBeNull()
  })

  it('room が付かない起動では何もしない', () => {
    expect(openRoomFromDeepLink('exp://192.168.1.5:8081')).toBeNull()
  })

  it('別の部屋の QR なら、それぞれ参加を投げる', () => {
    const a = openRoomFromDeepLink('exp://x?room=AAAA') as string
    const b = openRoomFromDeepLink('exp://x?room=BBBB') as string
    expect(shouldJoinOnArrival(a)).toBe(true)
    expect(shouldJoinOnArrival(b)).toBe(true)
  })

  // 上限で忘れたコードに出会い直しても、参加は投げ直せる（サーバーは冪等）。
  it('覚えきれずに忘れた部屋には、もう一度参加を投げる', () => {
    expect(shouldJoinOnArrival('Q83D', 1)).toBe(true)
    expect(shouldJoinOnArrival('ZZZZ', 1)).toBe(true)
    // 上限 1 なので Q83D は忘れられている。
    expect(shouldJoinOnArrival('Q83D', 1)).toBe(true)
  })
})

describe('rememberCode', () => {
  it('上限までは全部覚える', () => {
    const set = new Set<string>()
    for (const code of ['A', 'B', 'C']) rememberCode(set, code, 3)
    expect([...set]).toEqual(['A', 'B', 'C'])
  })

  // ブースは 1 台で何十戦も回すので、際限なく貯めない。
  it('上限を超えたら古いものから捨てる', () => {
    const set = new Set<string>()
    for (const code of ['A', 'B', 'C', 'D']) rememberCode(set, code, 3)
    expect([...set]).toEqual(['B', 'C', 'D'])
  })

  it('同じコードを入れ直すと新しい扱いになる', () => {
    const set = new Set<string>()
    for (const code of ['A', 'B', 'C']) rememberCode(set, code, 3)
    rememberCode(set, 'A', 3)
    rememberCode(set, 'D', 3)
    // A を入れ直したので、捨てられるのは B。
    expect([...set]).toEqual(['C', 'A', 'D'])
  })
})

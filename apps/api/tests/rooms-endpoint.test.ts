/**
 * 対戦ルームのエンドポイント（設計 §9.4）の統合テスト。
 *
 * ここで守りたいのは「**端末が zod で parse できる形**が返る」こと。
 * `apps/mobile/src/lib/api.ts` はレスポンスを必ず契約スキーマに通すので、
 * 形が 1 つずれると画面が「サーバーの応答を解釈できません」で止まる。
 *
 * goal_pool のデータが無ければ skipped として報告する（実行 0 件の passed にしない）。
 */
import { moveResponseSchema, ROOM_CODE_LENGTH, roomResponseSchema } from '@coto2ba/contracts'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { db, pool } from '../src/db/client'
import { games, session, user } from '../src/db/schema'
import { SKIP_WITHOUT_GOAL_POOL_ROWS } from './db-available'

const createdUserIds: string[] = []

afterAll(async () => {
  for (const id of createdUserIds) {
    await db
      .delete(user)
      .where(eq(user.id, id))
      .catch(() => {})
  }
  await pool.end().catch(() => {})
})

async function signIn(displayName: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(user).values({
    id,
    name: displayName,
    email: `${id}@test.coto2ba.invalid`,
    emailVerified: false,
    isAnonymous: true,
    displayName,
    bestFreeMoves: {},
    booth: false,
  })
  createdUserIds.push(id)
  const token = crypto.randomUUID().replaceAll('-', '')
  await db.insert(session).values({
    id: crypto.randomUUID(),
    token,
    userId: id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  return token
}

async function post(path: string, bearer: string, body?: unknown): Promise<Response> {
  return await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body ?? {}),
  })
}

/**
 * 通る語が見つかるまで順に打つ。
 * ゴール次第で「ゴールに近すぎる語」になるものがあるので、1 語に賭けない。
 */
const PROBE_WORDS = ['光', '海', '夜', '星', '船', '岩', '港', '火', '風', '山'] as const

async function playAnyMove(bearer: string, gameId: string): Promise<unknown> {
  for (const word of PROBE_WORDS) {
    const res = await post(`/api/games/${gameId}/moves`, bearer, {
      input_word: word,
      ratio: 0.5,
    })
    if (res.status === 200) return await res.json()
  }
  throw new Error('どの語も打てませんでした')
}

/**
 * 順位の 1 行が持ってよいキー。**ここに語（current / input / result）を足さないこと。**
 * 増やすとレース中に他人の手が見えて、真似で解かれる（§9.2）。
 */
const ALLOWED_STANDING_KEYS = [
  'best_rank',
  'display_name',
  'finished_at',
  'is_me',
  'move_count',
  'user_id',
].sort()

/** そのユーザーのルーム戦のゲーム ID。 */
async function myGameId(bearer: string, code: string): Promise<string> {
  const room = roomResponseSchema.parse(await (await get(`/api/rooms/${code}`, bearer)).json())
  const gameId = room.my_game_id
  if (gameId === null) throw new Error('ゲームがありません')
  return gameId
}

/** ホストの Bearer を覚えておく（部屋のコードから引けるように）。 */
const hostBearerByCode = new Map<string, string>()
async function hostOf(code: string): Promise<string> {
  const bearer = hostBearerByCode.get(code)
  if (bearer === undefined) throw new Error('ホストが分かりません')
  return bearer
}

/**
 * ゲームの現在語を直接書き換える。
 * **漏れ検査の目印を仕込むためだけ**に使う（語彙に無い文字列でよい）。
 */
async function setCurrentWord(gameId: string, word: string): Promise<void> {
  await db.update(games).set({ current: word }).where(eq(games.id, gameId))
}

/** 2 人が入って開始済みの部屋を作る。 */
async function startedRoom(): Promise<{
  host: string
  guest: string
  code: string
  hostGameId: string
}> {
  const host = await signIn('打つ人')
  const guest = await signIn('待つ人')
  const created = roomResponseSchema.parse(
    await (await post('/api/rooms', host, { difficulty: 'normal' })).json(),
  )
  hostBearerByCode.set(created.code, host)
  await post(`/api/rooms/${created.code}/join`, guest)
  const started = roomResponseSchema.parse(
    await (await post(`/api/rooms/${created.code}/start`, host)).json(),
  )
  const hostGameId = started.my_game_id
  if (hostGameId === null) throw new Error('ホストのゲームがありません')
  return { host, guest, code: created.code, hostGameId }
}

async function get(path: string, bearer: string): Promise<Response> {
  return await app.request(path, { headers: { authorization: `Bearer ${bearer}` } })
}

describe.skipIf(SKIP_WITHOUT_GOAL_POOL_ROWS)('対戦ルームのエンドポイント', () => {
  it('作成 → 参加 → 開始 → 取得が、すべて契約どおりの形で返る', async () => {
    const host = await signIn('ホスト')
    const guest = await signIn('ゲスト')

    const createdRes = await post('/api/rooms', host, { difficulty: 'easy' })
    expect(createdRes.status).toBe(200)
    const created = roomResponseSchema.parse(await createdRes.json())
    expect(created.status).toBe('waiting')
    expect(created.goal).toBeNull()
    expect(created.join_url).toContain(created.code)

    // 小文字で入力されても拾う（読み上げてもらって手入力する導線）。
    const joinedRes = await post(`/api/rooms/${created.code.toLowerCase()}/join`, guest)
    expect(joinedRes.status).toBe(200)
    const joined = roomResponseSchema.parse(await joinedRes.json())
    expect(joined.players).toHaveLength(2)

    // ホスト以外は開始できない。
    const forbidden = await post(`/api/rooms/${created.code}/start`, guest)
    expect(forbidden.status).toBe(403)

    const startedRes = await post(`/api/rooms/${created.code}/start`, host)
    expect(startedRes.status).toBe(200)
    const started = roomResponseSchema.parse(await startedRes.json())
    expect(started.status).toBe('playing')
    expect(started.goal).not.toBeNull()
    expect(started.my_game_id).not.toBeNull()

    const polledRes = await get(`/api/rooms/${created.code}`, guest)
    expect(polledRes.status).toBe(200)
    const polled = roomResponseSchema.parse(await polledRes.json())
    expect(polled.goal).toBe(started.goal)
    expect(polled.players.filter((p) => p.is_me)).toHaveLength(1)
  })

  it('ルーム戦の手のレスポンスに、その時点の順位が入る', async () => {
    const { host, code, hostGameId } = await startedRoom()
    const move = await playAnyMove(host, hostGameId)
    const standings = moveResponseSchema.parse(move).room_standings
    expect(standings).not.toBeNull()
    expect(standings?.length).toBe(2)
    expect(code).toHaveLength(ROOM_CODE_LENGTH)
  })

  /**
   * **競技性の核心。** 進行中に他人が打った語が見えると、真似で解かれてレースにならない。
   *
   * 検証は 2 段構えにしてある。
   *
   * 1. **目印になる語を相手のゲームに埋めて、生のレスポンスに出てこないこと**
   *    相手の `current` を「他のどこにも存在しない文字列」にするので、
   *    1 文字でも漏れれば必ず捕まる。
   * 2. **順位の各行が持つキーが決まった 6 つだけであること**
   *    将来フィールドが増えたときに、語を載せる隙間ができたら落ちる
   *
   * **どちらも `moveResponseSchema.parse()` を通す前の生の JSON で見る。**
   * zod の object は既定で未知のキーを捨てるので、パース後の値を見ると
   * **漏れていても消えてしまう**（前の版はそれで実質何も検証していなかった）。
   */
  it('手のレスポンスの順位に、他人が打った語は入らない', async () => {
    const { host, guest, code, hostGameId } = await startedRoom()

    // 相手だけが知っている語（他のどこにも現れない）。
    const sentinel = `ゲストだけの秘密語-${crypto.randomUUID()}`
    await setCurrentWord(await myGameId(guest, code), sentinel)

    const raw = await playAnyMove(host, hostGameId)
    expect(JSON.stringify(raw)).not.toContain(sentinel)
  })

  it('順位の各行が持つキーは決まった 6 つだけ', async () => {
    const { host, hostGameId } = await startedRoom()
    const raw = (await playAnyMove(host, hostGameId)) as {
      room_standings?: Record<string, unknown>[]
    }
    const rows = raw.room_standings ?? []
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(ALLOWED_STANDING_KEYS)
    }
  })

  it('部屋の状態（ポーリング先）にも他人が打った語は入らない', async () => {
    const { guest, code } = await startedRoom()

    const sentinel = `ホストだけの秘密語-${crypto.randomUUID()}`
    const hostGame = await myGameId(await hostOf(code), code)
    await setCurrentWord(hostGame, sentinel)

    const raw = await (await get(`/api/rooms/${code}`, guest)).json()
    expect(JSON.stringify(raw)).not.toContain(sentinel)
  })

  it('ルーム戦でない手には順位が入らない', async () => {
    const solo = await signIn('ひとり')
    const game = (await (
      await post('/api/games', solo, { mode: 'free', difficulty: 'normal' })
    ).json()) as { id: string }
    const move = await playAnyMove(solo, game.id)
    expect(moveResponseSchema.parse(move).room_standings ?? null).toBeNull()
  })

  it('存在しないコードは 404', async () => {
    const someone = await signIn('通りすがり')
    const res = await get('/api/rooms/ZZZZ', someone)
    expect(res.status).toBe(404)
  })

  it('POST /api/games に mode=room は投げられない（ルーム戦はサーバーだけが作る）', async () => {
    const someone = await signIn('直接作る人')
    const res = await post('/api/games', someone, { mode: 'room' })
    expect(res.status).toBe(400)
  })
})

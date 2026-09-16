/**
 * API クライアント。
 *
 * - レスポンスは **必ず packages/contracts の zod スキーマで parse する**。
 *   サーバーの形が変わったらここで落ちる（画面の奥で静かに壊れない）。
 * - エラーは `{ code, message }` を `ApiError` に変換して throw する。
 * - `Authorization: Bearer <token>` は auth.ts のトークンから自動で付ける。
 * - タイムアウト 15 秒（AbortController）。
 * - 401 が返ったら **1 回だけ** セッションを検証し、サーバーが「このセッションは無い」と
 *   明示したときだけ作り直して同じリクエストを再送する
 *   （ブースモードで長時間動かすため。展示中の DB リセットから自力で戻る）。
 *   ネットワーク失敗・5xx ではトークンを捨てない（匿名アカウントを失わないため）。
 */

import {
  achievementsResponseSchema,
  apiErrorSchema,
  type CreateGameRequest,
  collectionResponseSchema,
  createGameRequestSchema,
  dailyResponseSchema,
  deviceRegisterResponseSchema,
  ERROR_MESSAGES_JA,
  type ErrorCode,
  gameDetailSchema,
  gameSchema,
  hintResponseSchema,
  leaderboardResponseSchema,
  type MoveRequest,
  meResponseSchema,
  moveRequestSchema,
  moveResponseSchema,
  type PatchMeRequest,
  patchMeRequestSchema,
  transferClaimRequestSchema,
  transferClaimResponseSchema,
  transferCreateResponseSchema,
  wordCheckResponseSchema,
  wordDescriptionResponseSchema,
  wordDetailResponseSchema,
} from '@coto2ba/contracts'
import type { z } from 'zod'
import { ensureSession, fetchSession, getToken, setToken } from './auth'
import { apiUrl } from './config'
import { API_TIMEOUT_MS } from './constants'

/** API が返したエラー、またはネットワーク/パースの失敗。 */
export class ApiError extends Error {
  readonly code: ErrorCode
  /** HTTP ステータス。ネットワーク到達前は 0。 */
  readonly status: number
  /** サーバーに届かなかった（オフライン・タイムアウト・DNS）。 */
  readonly isNetworkError: boolean

  constructor(code: ErrorCode, message: string, status = 0, isNetworkError = false) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.isNetworkError = isNetworkError
  }

  /** UI に出す日本語。サーバーの message が空でも必ず何か返る。 */
  get messageJa(): string {
    return this.message.length > 0 ? this.message : ERROR_MESSAGES_JA[this.code]
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** 特定のコードかどうか（OOV の赤枠表示などで使う）。 */
export function hasErrorCode(error: unknown, code: ErrorCode): boolean {
  return isApiError(error) && error.code === code
}

const NETWORK_ERROR_MESSAGE = 'サーバーに接続できません'
const PARSE_ERROR_MESSAGE = 'サーバーの応答を解釈できません'

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

type RequestOptions<TSchema extends z.ZodType> = {
  method?: HttpMethod
  /** JSON ボディ。undefined なら送らない。 */
  body?: unknown
  /** レスポンスの検証スキーマ。 */
  schema: TSchema
  /** Authorization を付けるか（既定 true）。 */
  auth?: boolean
  /** 呼び出し側の中断シグナル（react-query の signal をそのまま渡す）。 */
  signal?: AbortSignal
}

function statusToCode(status: number): ErrorCode {
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'GAME_NOT_FOUND'
  if (status === 429) return 'RATE_LIMITED'
  if (status === 400) return 'VALIDATION'
  return 'INTERNAL'
}

async function toApiError(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null)
  const parsed = apiErrorSchema.safeParse(body)
  if (parsed.success) {
    return new ApiError(parsed.data.code, parsed.data.message, res.status)
  }
  const code = statusToCode(res.status)
  return new ApiError(code, ERROR_MESSAGES_JA[code], res.status)
}

async function send(
  path: string,
  method: HttpMethod,
  body: unknown,
  auth: boolean,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    // **必ずセッションが立つのを待ってから送る。**
    // 起動直後は ensureSession() がまだ走っている最中なので、待たずに送ると
    // Authorization 無しのリクエストが飛んで 401 になる（実際に起きた）。
    // ensureSession() は inflight を共有するので、同時に何本呼んでも往復は 1 回。
    let token = await getToken()
    if (token === null || token.length === 0) token = await ensureSession()
    if (token !== null && token.length > 0) headers.Authorization = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  try {
    return await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    throw new ApiError('INTERNAL', NETWORK_ERROR_MESSAGE, 0, true)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * 401 からの自己修復。
 *
 * **トークンを捨てるのは、サーバーが「このセッションは無い」と明示したときだけ。**
 * サーバーの `requireAuth` は `auth.api.getSession()` の例外も 401 に落とすため、
 * 一過性の障害で 1 回 401 が返るだけでプレイヤーの匿名アカウント
 * （図鑑・実績・連続記録）が差し替わってしまう。必ず検証してから捨てる。
 *
 * 戻り値が null のときは「回復しなかった」＝呼び出し側は元の 401 をそのまま投げる。
 *
 * 同時多発の 401 で何度もサインインしないよう、進行中のものを共有する
 * （`ensureSession()` 自体も inflight を持つが、こちらでも再入を止める）。
 */
let recovering: Promise<string | null> | null = null

function recoverSession(): Promise<string | null> {
  if (recovering !== null) return recovering
  recovering = (async () => {
    try {
      const current = await getToken()
      // そもそもトークンが無い（起動直後など）→ 素直に匿名サインイン。
      if (current === null || current.length === 0) return await ensureSession()

      const check = await fetchSession(current)
      // 'unknown'（ネットワーク失敗・5xx）：捨てない。元の 401 を投げさせる。
      // 'valid'：セッションは生きている（別要因の 401）。再送しても無駄なので投げさせる。
      if (check.status !== 'invalid') return null

      await setToken(null)
      return await ensureSession()
    } finally {
      recovering = null
    }
  })()
  return recovering
}

async function request<TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const { method = 'GET', body, schema, auth = true, signal } = options

  let res = await send(path, method, body, auth, signal)

  // 401 は 1 回だけ、セッションを検証 → 本当に無効なら作り直して再送する。
  if (res.status === 401 && auth) {
    const token = await recoverSession()
    // 回復しなかった（判定不能 / まだ有効）→ 元の 401 をそのまま返す。
    if (token === null) throw await toApiError(res)
    res = await send(path, method, body, auth, signal)
  }

  if (!res.ok) throw await toApiError(res)

  const json: unknown = await res.json().catch(() => null)
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new ApiError('INTERNAL', PARSE_ERROR_MESSAGE, res.status)
  }
  return parsed.data
}

// ── ユーザー ────────────────────────────────────────────────

export function getMe(signal?: AbortSignal) {
  return request('/api/me', { schema: meResponseSchema, signal })
}

export function patchMe(input: PatchMeRequest, signal?: AbortSignal) {
  return request('/api/me', {
    method: 'PATCH',
    body: patchMeRequestSchema.parse(input),
    schema: meResponseSchema,
    signal,
  })
}

// ── デイリー ────────────────────────────────────────────────

export function getDaily(signal?: AbortSignal) {
  return request('/api/daily', { schema: dailyResponseSchema, signal })
}

// ── ゲーム ──────────────────────────────────────────────────

export function createGame(input: CreateGameRequest, signal?: AbortSignal) {
  return request('/api/games', {
    method: 'POST',
    body: createGameRequestSchema.parse(input),
    schema: gameSchema,
    signal,
  })
}

export function getGame(gameId: string, signal?: AbortSignal) {
  return request(`/api/games/${encodeURIComponent(gameId)}`, {
    schema: gameDetailSchema,
    signal,
  })
}

/** フリーモードかつ 0 手のときだけ。start を引き直す。 */
export function shuffleStart(gameId: string, signal?: AbortSignal) {
  return request(`/api/games/${encodeURIComponent(gameId)}/shuffle-start`, {
    method: 'POST',
    schema: gameSchema,
    signal,
  })
}

export function postMove(gameId: string, input: MoveRequest, signal?: AbortSignal) {
  return request(`/api/games/${encodeURIComponent(gameId)}/moves`, {
    method: 'POST',
    body: moveRequestSchema.parse(input),
    schema: moveResponseSchema,
    signal,
  })
}

export function postHint(gameId: string, signal?: AbortSignal) {
  return request(`/api/games/${encodeURIComponent(gameId)}/hints`, {
    method: 'POST',
    schema: hintResponseSchema,
    signal,
  })
}

export function giveUp(gameId: string, signal?: AbortSignal) {
  return request(`/api/games/${encodeURIComponent(gameId)}/give-up`, {
    method: 'POST',
    schema: gameSchema,
    signal,
  })
}

// ── ランキング ──────────────────────────────────────────────

/** date は `YYYY-MM-DD`。省略すると今日。 */
export function getLeaderboard(date?: string, signal?: AbortSignal) {
  const query = date === undefined ? '' : `?date=${encodeURIComponent(date)}`
  return request(`/api/leaderboard/daily${query}`, {
    schema: leaderboardResponseSchema,
    signal,
  })
}

// ── 語 ──────────────────────────────────────────────────────

export function getWordDescription(word: string, signal?: AbortSignal) {
  return request(`/api/words/${encodeURIComponent(word)}/description`, {
    schema: wordDescriptionResponseSchema,
    signal,
  })
}

/** 図鑑のボトムシート用（説明 + pos3 + 実コサインの近傍 5 語）。 */
export function getWordDetail(word: string, signal?: AbortSignal) {
  return request(`/api/words/${encodeURIComponent(word)}/detail`, {
    schema: wordDetailResponseSchema,
    signal,
  })
}

/** 端末側の語彙判定の保険。通常は使わない（認証不要）。 */
export function checkWord(word: string, signal?: AbortSignal) {
  return request(`/api/words/check?w=${encodeURIComponent(word)}`, {
    schema: wordCheckResponseSchema,
    auth: false,
    signal,
  })
}

// ── 図鑑 / 実績 ─────────────────────────────────────────────

export function getCollection(signal?: AbortSignal) {
  return request('/api/collection', { schema: collectionResponseSchema, signal })
}

export function getAchievements(signal?: AbortSignal) {
  return request('/api/achievements', { schema: achievementsResponseSchema, signal })
}

// ── 引き継ぎ ────────────────────────────────────────────────

export function createTransfer(signal?: AbortSignal) {
  return request('/api/transfer', {
    method: 'POST',
    schema: transferCreateResponseSchema,
    signal,
  })
}

export function claimTransfer(token: string, signal?: AbortSignal) {
  return request('/api/transfer/claim', {
    method: 'POST',
    body: transferClaimRequestSchema.parse({ token }),
    schema: transferClaimResponseSchema,
    signal,
  })
}

// ── 端末トークン（Better Auth のフォールバック）──────────────

export function registerDevice(signal?: AbortSignal) {
  return request('/api/devices', {
    method: 'POST',
    schema: deviceRegisterResponseSchema,
    auth: false,
    signal,
  })
}

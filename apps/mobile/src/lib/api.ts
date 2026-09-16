/**
 * API クライアント。
 *
 * - レスポンスは **必ず packages/contracts の zod スキーマで parse する**。
 *   サーバーの形が変わったらここで落ちる（画面の奥で静かに壊れない）。
 * - エラーは `{ code, message }` を `ApiError` に変換して throw する。
 * - `Authorization: Bearer <token>` は auth.ts のトークンから自動で付ける。
 * - タイムアウト 15 秒（AbortController）。
 * - 401 が返ったら **1 リクエストにつき 1 回だけ** 回復を試みる（`recoverSession()`）。
 *   - セッションが生きていた → 同じトークンで再送（サーバー側の一過性の障害）
 *   - 無効と確認できた     → 作り直して再送（展示中の DB リセットから自力で戻る）
 *   - 判定不能             → **何も捨てず**元の 401 を投げる
 *   ネットワーク失敗・5xx・403 ではトークンを捨てない。捨てると来場者の匿名アカウント
 *   （図鑑・実績・連続記録）が復旧不能に失われる。判定は `sessionState.ts` の表を参照。
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
import { ensureSessionResult, getToken, recoverSession } from './auth'
import { apiUrl } from './config'
import { API_TIMEOUT_MS } from './constants'
import { SESSION_MESSAGE_UNREACHABLE_JA } from './sessionState'

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

/** 「届かなかった」の文言は 1 か所に揃える（「セッションが切れました」とは別物）。 */
const NETWORK_ERROR_MESSAGE = SESSION_MESSAGE_UNREACHABLE_JA
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

/** 401 だけは判定に使うので名前を付ける。 */
const UNAUTHORIZED_STATUS = 401

function statusToCode(status: number): ErrorCode {
  if (status === UNAUTHORIZED_STATUS) return 'UNAUTHORIZED'
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
    // ensureSessionResult() は inflight を共有するので、同時に何本呼んでも往復は 1 回。
    let token = await getToken()
    if (token === null || token.length === 0) {
      const session = await ensureSessionResult()
      if (!session.ok) {
        // トークンを用意できなかった。無認証で投げても 401 になるだけなので、
        // ここで理由の分かるエラーにして止める（トークンは auth.ts 側で保持されている）。
        const unreachable = session.reason === 'unreachable'
        throw new ApiError(
          unreachable ? 'INTERNAL' : 'UNAUTHORIZED',
          session.messageJa,
          0,
          unreachable,
        )
      }
      token = session.token
    }
    headers.Authorization = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  // 呼び出し側が既に中断していたら、往復せずに畳む。
  if (signal?.aborted === true) controller.abort()
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

async function request<TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const { method = 'GET', body, schema, auth = true, signal } = options

  let res = await send(path, method, body, auth, signal)

  // 401 の回復は **1 リクエストにつき 1 回まで**。
  // まず get-session でトークンの生死を確かめ、生きていれば同じトークンで再送、
  // 死んでいると確認できたときだけ作り直す（判定不能なら何も捨てない）。
  if (res.status === UNAUTHORIZED_STATUS && auth) {
    const recovery = await recoverSession()
    if (!recovery.retry) {
      // 回復しなかった（判定不能 / サインイン失敗）→ 401 をそのまま投げる。
      // ただし文言は「何が起きたか」が分かるものに差し替える。
      const original = await toApiError(res)
      if (recovery.messageJa === null) throw original
      throw new ApiError(
        original.code,
        recovery.messageJa,
        original.status,
        recovery.status === 'kept',
      )
    }
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

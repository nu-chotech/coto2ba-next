/**
 * 認証（Better Auth の Bearer 運用。Cookie は使わない）。
 *
 * ARCHITECTURE §2 の確定事項：
 * - Expo Go のオリジン（`exp://192.168.x.x:8081/--/`）は DHCP 依存で安定しない。
 *   Cookie ヘッダが無いリクエストは Better Auth がオリジン検証をスキップするので、
 *   Bearer だけで運用するとオリジン問題が構造的に起きない。
 * - `@better-auth/expo` の SecureStore cookie jar は使わない（失敗モードが
 *   「session が黙って null」で最悪）。素の fetch + `set-auth-token` ヘッダで足りる。
 * - **`signIn.anonymous()` は冪等ではない。** 既に匿名だと
 *   `ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY` を投げる。
 *   必ず `get-session` で確認してから呼ぶ。
 *
 * サーバーがまだ無い状態でもアプリが起動できるように、失敗は投げずに null を返す。
 */

import * as SecureStore from 'expo-secure-store'
import { apiUrl } from './config'
import { API_TIMEOUT_MS, AUTH_TOKEN_HEADER, SECURE_STORE_AUTH_TOKEN_KEY } from './constants'

const SIGN_IN_ANONYMOUS_PATH = '/api/auth/sign-in/anonymous'
const GET_SESSION_PATH = '/api/auth/get-session'

/** SecureStore は非同期なので、読んだ値をメモリにも持つ（毎リクエストの往復を避ける）。 */
let cachedToken: string | null = null
let cacheLoaded = false

type TokenListener = (token: string | null) => void
const listeners = new Set<TokenListener>()

function notify(token: string | null): void {
  for (const listener of listeners) listener(token)
}

/** トークンの変化を購読する（ブースモードの「次の人へ」で画面を作り直すため）。 */
export function subscribeToken(listener: TokenListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 同期で読める最後の値。初回起動直後は null になりうる。 */
export function getCachedToken(): string | null {
  return cachedToken
}

export async function getToken(): Promise<string | null> {
  if (cacheLoaded) return cachedToken
  try {
    cachedToken = await SecureStore.getItemAsync(SECURE_STORE_AUTH_TOKEN_KEY)
  } catch {
    cachedToken = null
  }
  cacheLoaded = true
  return cachedToken
}

export async function setToken(token: string | null): Promise<void> {
  cachedToken = token
  cacheLoaded = true
  try {
    if (token === null) {
      await SecureStore.deleteItemAsync(SECURE_STORE_AUTH_TOKEN_KEY)
    } else {
      await SecureStore.setItemAsync(SECURE_STORE_AUTH_TOKEN_KEY, token)
    }
  } catch {
    // SecureStore が使えない環境（web など）でもメモリ上では動かす。
  }
  notify(token)
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export type SessionUser = {
  id: string
  name?: string | null
  isAnonymous?: boolean | null
}

/**
 * セッション検証の結果。**3 状態あることが重要**。
 * - `valid`   : サーバーが「このセッションは有効」と答えた
 * - `invalid` : サーバーが「このセッションは無い」と明示した（200 かつ user 無し、または 401）
 * - `unknown` : サーバーに届かなかった / 5xx / 応答が壊れている。**判定不能**
 *
 * `unknown` でトークンを捨ててはいけない。捨てると匿名アカウント
 * （図鑑・実績・連続記録・ランキング上の同一性）が復旧不能に失われる。
 */
export type SessionCheck =
  | { status: 'valid'; user: SessionUser }
  | { status: 'invalid' }
  | { status: 'unknown' }

/** 本文を読む。JSON として壊れていたら `ok: false`（＝判定不能）。 */
async function readJsonBody(res: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const text = await res.text()
    if (text.trim().length === 0) return { ok: true, value: null }
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

/**
 * `GET /api/auth/get-session` でトークンを検証する。
 * オフライン・タイムアウト・DNS 失敗・5xx は `unknown`（トークンは捨てない）。
 */
export async function fetchSession(token: string): Promise<SessionCheck> {
  const res = await fetchWithTimeout(apiUrl(GET_SESSION_PATH), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  })
  // サーバーに届かなかった（オフライン・タイムアウト・DNS）。
  if (res === null) return { status: 'unknown' }
  // サーバーが「このセッションは無い」と明示した。
  if (res.status === 401) return { status: 'invalid' }
  // 5xx はサーバー側の一過性の障害。セッションの有無については何も言っていない。
  if (res.status >= 500) return { status: 'unknown' }
  // その他の非 2xx（404 でエンドポイントが無い等）も判定不能として扱う。
  if (!res.ok) return { status: 'unknown' }

  const body = await readJsonBody(res)
  if (!body.ok) return { status: 'unknown' }
  // Better Auth はセッションが無いと `null` を返す。
  if (body.value === null || typeof body.value !== 'object') return { status: 'invalid' }
  const user = (body.value as { user?: unknown }).user
  if (user === null || user === undefined || typeof user !== 'object') return { status: 'invalid' }
  const id = (user as { id?: unknown }).id
  if (typeof id !== 'string' || id.length === 0) return { status: 'invalid' }
  return { status: 'valid', user: user as SessionUser }
}

/**
 * `POST /api/auth/sign-in/anonymous`。
 * 新しい匿名ユーザーを作り、`set-auth-token` ヘッダのトークンを保存する。
 * **既存セッションがあるときに呼んではいけない。**
 */
async function signInAnonymous(): Promise<string | null> {
  const res = await fetchWithTimeout(apiUrl(SIGN_IN_ANONYMOUS_PATH), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!res?.ok) return null

  const header = res.headers.get(AUTH_TOKEN_HEADER)
  if (header && header.length > 0) {
    await setToken(header)
    return header
  }

  // ヘッダが無い構成（bearer プラグイン未設定など）の保険としてボディも見る。
  const body: unknown = await res.json().catch(() => null)
  const token = (body as { token?: unknown } | null)?.token
  if (typeof token === 'string' && token.length > 0) {
    await setToken(token)
    return token
  }
  return null
}

let inflight: Promise<string | null> | null = null

/**
 * 有効なトークンを用意する。
 * 1. 保存済みトークンがあれば `get-session` で検証して、通れば再利用
 * 2. サーバーが「無効」と明示したときだけ捨てて、匿名サインイン
 * 3. 判定不能（オフライン・タイムアウト・5xx）なら **何も捨てず既存トークンを返す**。
 *    オフライン起動で匿名アカウントを失わないため。次の呼び出しでリトライされる。
 *
 * 失敗しても投げない（サーバー未起動でもアプリは起動する）。UI 側でリトライできる。
 */
export function ensureSession(): Promise<string | null> {
  if (inflight !== null) return inflight
  inflight = (async () => {
    try {
      const existing = await getToken()
      if (existing !== null && existing.length > 0) {
        const check = await fetchSession(existing)
        if (check.status === 'valid') return existing
        // 判定不能：捨てない・新規サインインもしない。既存トークンのまま後でリトライ。
        if (check.status === 'unknown') return existing
        await setToken(null)
      }
      return await signInAnonymous()
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * ブースモードの「次の人へ」。
 * いまのトークンを捨てて、新しい匿名ユーザーを作る。
 */
export async function resetSession(): Promise<string | null> {
  await setToken(null)
  return await ensureSession()
}

/** サインイン済みか（トークンを持っているか）。検証はしない。 */
export function hasToken(): boolean {
  return cachedToken !== null && cachedToken.length > 0
}

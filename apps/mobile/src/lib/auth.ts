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
 * このファイルの二大原則（展示で最も痛い事故の対策）：
 *
 * 1. **保存済みトークンを消す・上書きしてよいのは、サーバーが「このセッションは無い」と
 *    明示したときだけ。** 「届かなかった」と「無効だった」を区別する判定は
 *    `sessionState.ts`（純粋関数 + 判定表）に切り出してある。
 *    会場の Wi-Fi が一瞬切れただけで来場者の匿名アカウントが消えてはいけない。
 *    同じ理由で **SecureStore が読めなかったときも「トークンが無い」とは見なさない**
 *    （`readToken()` が `ok: false` を返す）。匿名サインインは、
 *    「本当にトークンが無い」と確認できたときだけ走らせる。
 * 2. **匿名サインインはグローバルに直列化する。** 同時に何本も走らせると
 *    来場者 1 人に対して匿名ユーザーが複数できて、図鑑も記録も分裂する。
 *
 * サーバーがまだ無い状態でもアプリが起動できるように、失敗は投げずに結果型で返す。
 */

import * as SecureStore from 'expo-secure-store'
import { apiUrl } from './config'
import { API_TIMEOUT_MS, AUTH_TOKEN_HEADER, SECURE_STORE_AUTH_TOKEN_KEY } from './constants'
import {
  type BodyRead,
  classifySessionBody,
  classifySessionResponse,
  describeSessionCheck,
  type HttpOutcome,
  SESSION_MESSAGE_RECREATED_JA,
  SESSION_MESSAGE_SIGN_IN_FAILED_JA,
  SESSION_MESSAGE_UNREACHABLE_JA,
  type SessionCheck,
  type SessionUser,
  shouldDiscardToken,
} from './sessionState'

export type { SessionCheck, SessionUser }
export {
  SESSION_MESSAGE_RECREATED_JA,
  SESSION_MESSAGE_SIGN_IN_FAILED_JA,
  SESSION_MESSAGE_UNREACHABLE_JA,
}

const SIGN_IN_ANONYMOUS_PATH = '/api/auth/sign-in/anonymous'
const GET_SESSION_PATH = '/api/auth/get-session'

/** ログの目印。展示中に Metro のログを追えるように。 */
const LOG = '[auth]'

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

/**
 * 保存済みトークンの読み取り結果。
 *
 * **`ok: false`（読めなかった）と `ok: true, token: null`（本当に無い）を
 * 型で分けているのがこの関数の存在理由。** 混ぜると「キーチェーンが一度読めなかった」
 * だけで「トークンが無い」と解釈され、本物のトークンを上書きしてしまう。
 */
export type TokenRead = { ok: true; token: string | null } | { ok: false }

/**
 * 保存済みトークンを読む。
 *
 * **SecureStore の読み取りに失敗しても「トークンが無い」とは見なさない。**
 * キーチェーンは起動直後（デバイスがまだロック解除されていない等）に一時的に
 * 読めないことがある。失敗したときはキャッシュを確定させず（＝次回もう一度読む）、
 * `ok: false` を返して呼び出し側に「判定不能」であることを伝える。
 */
export async function readToken(): Promise<TokenRead> {
  if (cacheLoaded) return { ok: true, token: cachedToken }
  try {
    const stored = await SecureStore.getItemAsync(SECURE_STORE_AUTH_TOKEN_KEY)
    cachedToken = stored
    cacheLoaded = true
    return { ok: true, token: stored }
  } catch (error) {
    console.warn(`${LOG} SecureStore の読み取りに失敗。トークンの有無は判定不能`, error)
    // cacheLoaded は立てない（= 次回もう一度読む）。
    return { ok: false }
  }
}

/**
 * `readToken()` の薄いラッパ。読めなかったときも `null` になる。
 *
 * **セッションを作り直すかどうかの判断にこれを使ってはいけない**（`null` が
 * 「無い」なのか「読めなかった」なのか区別できない）。その判断には `readToken()` を使う。
 */
export async function getToken(): Promise<string | null> {
  const read = await readToken()
  return read.ok ? read.token : null
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
  } catch (error) {
    // SecureStore が使えない環境（web など）でもメモリ上では動かす。
    // ただしアプリを閉じるとトークンは消えるので、黙って握り潰さない。
    console.warn(`${LOG} SecureStore に保存できませんでした（この起動中だけ有効）`, error)
  }
  notify(token)
}

/**
 * 応答が返ったかどうかまで含めて返す fetch。
 * 例外（圏外・DNS・タイムアウト）は `reachable: false` に畳む。
 */
async function fetchOutcome(
  url: string,
  init: RequestInit,
): Promise<{ outcome: HttpOutcome; res: Response | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    return { outcome: { reachable: true, status: res.status }, res }
  } catch {
    return { outcome: { reachable: false }, res: null }
  } finally {
    clearTimeout(timer)
  }
}

/** 本文を読む。JSON として壊れていたら `ok: false`（＝判定不能）。 */
async function readJsonBody(res: Response): Promise<BodyRead> {
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
 *
 * 判定の表は `sessionState.ts` の JSDoc にある。要点だけ再掲：
 * **消してよいのは `invalid`（401 か、サーバーが明示的にセッション無しと答えた）だけ。**
 * オフライン・タイムアウト・5xx・403・壊れた本文は `unreachable` で、トークンは残す。
 */
export async function fetchSession(token: string): Promise<SessionCheck> {
  const { outcome, res } = await fetchOutcome(apiUrl(GET_SESSION_PATH), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  })

  const decided = classifySessionResponse(outcome)
  if (decided !== 'read-body') return decided
  // classifySessionResponse が 'read-body' を返した = 2xx。応答は必ずある。
  if (res === null) return { status: 'unreachable', reason: 'no-response' }
  return classifySessionBody(await readJsonBody(res))
}

/**
 * `POST /api/auth/sign-in/anonymous` を叩いて新しいトークンを取る。
 * **保存はしない**（呼び出し側が、古いトークンを捨てる前に成否を見られるように）。
 * **既存セッションがあるときに呼んではいけない。**
 */
async function requestAnonymousToken(): Promise<string | null> {
  const { res } = await fetchOutcome(apiUrl(SIGN_IN_ANONYMOUS_PATH), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (res === null) {
    console.warn(`${LOG} 匿名サインイン: サーバーに届きませんでした`)
    return null
  }
  if (!res.ok) {
    console.warn(`${LOG} 匿名サインイン: サーバーが ${res.status} を返しました`)
    return null
  }

  const header = res.headers.get(AUTH_TOKEN_HEADER)
  if (header !== null && header.length > 0) return header

  // ヘッダが無い構成（bearer プラグイン未設定など）の保険としてボディも見る。
  const body = await readJsonBody(res)
  const token = body.ok ? (body.value as { token?: unknown } | null)?.token : undefined
  if (typeof token === 'string' && token.length > 0) return token
  console.warn(`${LOG} 匿名サインイン: 応答にトークンがありません`)
  return null
}

// ── 直列化 ──────────────────────────────────────────────────
// セッションを触る操作（検証・破棄・匿名サインイン）は必ずこの 1 本の鎖に並べる。
// 並行に走らせると、来場者 1 人に対して匿名ユーザーが複数できてしまう。

let lock: Promise<unknown> = Promise.resolve()

function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = lock.then(task, task)
  // 鎖は「前の処理が終わったこと」だけを表す。失敗を伝播させない。
  lock = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

// ── セッションの確保 ────────────────────────────────────────

/** 失敗の理由。UI はこれで文言を出し分ける。 */
export type SessionFailureReason = 'unreachable' | 'sign-in-failed'

export type EnsureSessionResult =
  | {
      ok: true
      token: string
      /** 新しい匿名ユーザーを作ったか（既存の再利用なら false）。 */
      created: boolean
      messageJa: string | null
    }
  | {
      ok: false
      reason: SessionFailureReason
      /** 判定不能で保持し続けているトークン（あれば）。捨ててはいけない。 */
      token: string | null
      messageJa: string
    }

async function ensureSessionOnce(): Promise<EnsureSessionResult> {
  const read = await readToken()

  // **保存済みトークンを読めなかった＝「無い」ではない。**
  // 起動時の `_layout.tsx` が最初の読み手なので、キーチェーンが一度でも読めないときに
  // ここで匿名サインインしてしまうと、本物のトークンを恒久的に上書きして
  // 来場者のアカウントが失われる。何もせずに次回リトライする。
  if (!read.ok) {
    console.warn(
      `${LOG} 保存済みトークンを読めませんでした。` +
        '新しい匿名ユーザーは作らず、次回もう一度読みます',
    )
    return {
      ok: false,
      reason: 'unreachable',
      token: null,
      messageJa: SESSION_MESSAGE_UNREACHABLE_JA,
    }
  }

  const existing = read.token

  if (existing !== null && existing.length > 0) {
    const check = await fetchSession(existing)
    if (check.status === 'valid') {
      return { ok: true, token: existing, created: false, messageJa: null }
    }
    if (check.status === 'unreachable') {
      // **ここが事故の分かれ目。** 判定不能なので何も捨てない・作らない。
      // トークンは残したままエラーを返し、次の呼び出しでリトライする。
      console.warn(
        `${LOG} セッションを確認できませんでした（${describeSessionCheck(check)}）。` +
          'トークンは保持したままリトライします',
      )
      return {
        ok: false,
        reason: 'unreachable',
        token: existing,
        messageJa: SESSION_MESSAGE_UNREACHABLE_JA,
      }
    }
    // invalid のときだけ捨てる。
    console.warn(
      `${LOG} セッションが無効でした（${describeSessionCheck(check)}）。匿名ユーザーを作り直します`,
    )
    if (shouldDiscardToken(check)) await setToken(null)
  }

  const created = await requestAnonymousToken()
  if (created === null) {
    return {
      ok: false,
      reason: 'sign-in-failed',
      token: await getToken(),
      messageJa: SESSION_MESSAGE_SIGN_IN_FAILED_JA,
    }
  }
  await setToken(created)
  return { ok: true, token: created, created: true, messageJa: SESSION_MESSAGE_RECREATED_JA }
}

/** 同時に何本呼ばれても往復は 1 回で済ませる（起動直後に画面が一斉に叩く）。 */
let ensureInflight: Promise<EnsureSessionResult> | null = null

/**
 * 有効なトークンを用意する。
 *
 * 1. 保存済みトークンがあれば `get-session` で検証して、通れば再利用
 * 2. サーバーが「無効」と明示したときだけ捨てて、匿名サインイン
 * 3. 判定不能（オフライン・タイムアウト・5xx・403）なら **何も捨てず**
 *    `ok: false, reason: 'unreachable'` を返す。トークンは保持したまま。
 *
 * 投げない（サーバー未起動でもアプリは起動する）。
 */
export function ensureSessionResult(): Promise<EnsureSessionResult> {
  if (ensureInflight !== null) return ensureInflight
  const shared: Promise<EnsureSessionResult> = runExclusive(ensureSessionOnce).finally(() => {
    if (ensureInflight === shared) ensureInflight = null
  })
  ensureInflight = shared
  return shared
}

/**
 * `ensureSessionResult()` の薄いラッパ。
 * 使えるトークン（判定不能のときは保持中のトークン）を返す。無ければ null。
 */
export async function ensureSession(): Promise<string | null> {
  const result = await ensureSessionResult()
  return result.token
}

// ── 401 からの回復 ──────────────────────────────────────────

export type SessionRecovery = {
  /** 同じリクエストを再送してよいか。 */
  retry: boolean
  /**
   * - `reused`    : トークンは生きていた（サーバー側の一過性の障害）。同じトークンで再送する
   * - `recreated` : 無効と確認できたので作り直した。新しいトークンで再送する
   * - `kept`      : 判定不能。**何も捨てず**諦める（元の 401 を呼び出し側が投げる）
   * - `failed`    : 作り直そうとして失敗した
   */
  status: 'reused' | 'recreated' | 'kept' | 'failed'
  token: string | null
  messageJa: string | null
}

async function recoverOnce(): Promise<SessionRecovery> {
  const read = await readToken()

  // **読めなかった＝「無い」ではない。** 判定不能なので作り直さない。
  // ここで匿名サインインすると、生きているトークンを上書きして別人になる。
  if (!read.ok) {
    console.warn(
      `${LOG} 401 を受けたが保存済みトークンを読めませんでした。` +
        '新しい匿名ユーザーは作らず、次回リトライします',
    )
    return {
      retry: false,
      status: 'kept',
      token: null,
      messageJa: SESSION_MESSAGE_UNREACHABLE_JA,
    }
  }

  const current = read.token

  // そもそもトークンが無い（起動直後など）→ 素直に匿名サインイン。
  if (current === null || current.length === 0) {
    const created = await requestAnonymousToken()
    if (created === null) {
      return {
        retry: false,
        status: 'failed',
        token: null,
        messageJa: SESSION_MESSAGE_SIGN_IN_FAILED_JA,
      }
    }
    await setToken(created)
    return {
      retry: true,
      status: 'recreated',
      token: created,
      messageJa: SESSION_MESSAGE_RECREATED_JA,
    }
  }

  const check = await fetchSession(current)

  // トークンは生きている。サーバー側の一過性の障害（requireAuth は
  // `auth.api.getSession()` の例外も 401 に落とす）。同じトークンで 1 回だけ再送する。
  if (check.status === 'valid') {
    console.warn(`${LOG} 401 を受けたがセッションは有効。同じトークンで 1 回だけ再送します`)
    return { retry: true, status: 'reused', token: current, messageJa: null }
  }

  // 判定不能。**絶対に捨てない。** 匿名ユーザーも作らない。
  if (check.status === 'unreachable') {
    console.warn(
      `${LOG} 401 を受けたがセッションの生死を確認できません（${describeSessionCheck(check)}）。` +
        'トークンは保持します',
    )
    return {
      retry: false,
      status: 'kept',
      token: current,
      messageJa: SESSION_MESSAGE_UNREACHABLE_JA,
    }
  }

  // ここまで来たときだけ「本当に無効」。
  console.warn(
    `${LOG} セッションが無効と確認（${describeSessionCheck(check)}）。匿名ユーザーを作り直します`,
  )
  await setToken(null)
  const created = await requestAnonymousToken()
  if (created === null) {
    return {
      retry: false,
      status: 'failed',
      token: null,
      messageJa: SESSION_MESSAGE_SIGN_IN_FAILED_JA,
    }
  }
  await setToken(created)
  return {
    retry: true,
    status: 'recreated',
    token: created,
    messageJa: SESSION_MESSAGE_RECREATED_JA,
  }
}

/** 同時多発の 401 で何本も匿名ユーザーを作らないよう、進行中のものを共有する。 */
let recoverInflight: Promise<SessionRecovery> | null = null

/**
 * 401 を受けたときの回復。**検証してから捨てる。**
 *
 * サーバーの `requireAuth` は `auth.api.getSession()` の例外も `.catch(() => null)` で
 * 401 に落とすため、DB の一過性障害で 1 回 401 が返るだけでプレイヤーが別人になりうる。
 * 必ず `get-session` で生死を確かめ、**死んでいると確認できたときだけ**作り直す。
 */
export function recoverSession(): Promise<SessionRecovery> {
  if (recoverInflight !== null) return recoverInflight
  const shared: Promise<SessionRecovery> = runExclusive(recoverOnce).finally(() => {
    if (recoverInflight === shared) recoverInflight = null
  })
  recoverInflight = shared
  return shared
}

// ── ブースモード ────────────────────────────────────────────

/**
 * ブースモードの「次の人へ」（SPEC §8.8）。
 * 新しい匿名ユーザーを作って、**成功したときだけ**トークンを差し替える。
 *
 * 先に捨ててから作ると、その瞬間に通信が切れていた場合
 * 「前の人のトークンも無い・新しいトークンも無い」状態になる。
 * サインインは Authorization を送らないので、古いトークンを持ったままでも
 * 必ず別の匿名ユーザーが作られる。
 */
export function resetSession(): Promise<string | null> {
  return runExclusive(async () => {
    const created = await requestAnonymousToken()
    if (created === null) {
      console.warn(`${LOG} 「次の人へ」に失敗しました。いまのセッションを維持します`)
      return await getToken()
    }
    await setToken(created)
    return created
  })
}

/** サインイン済みか（トークンを持っているか）。検証はしない。 */
export function hasToken(): boolean {
  return cachedToken !== null && cachedToken.length > 0
}

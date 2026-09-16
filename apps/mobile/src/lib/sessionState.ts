/**
 * セッション判定の純粋関数。**ここには I/O を一切書かない。**
 *
 * 分けてある理由：展示で最も痛い事故が「保存済みトークンを消してしまう」ことだから。
 * 匿名アカウントを失うと図鑑・実績・連続記録・ランキング上の同一性が復旧不能になる
 * （引き継ぎコードを発行していない限り、来場者には戻す手段が無い）。
 * 「消してよいか」の判断だけを fetch から切り離し、表にして残す。
 *
 * apps/mobile には vitest が無いので自動テストは置けない。代わりに
 * **意図を表として書き、実装がこの表からずれたら読んで分かる**ようにしてある。
 *
 * ## 判定表（`GET /api/auth/get-session` の結果 → 分類 → トークンの扱い）
 *
 * | 起きたこと                                   | 観測                     | 分類          | トークン |
 * | -------------------------------------------- | ------------------------ | ------------- | -------- |
 * | セッションが生きている                       | 200 + `user.id` あり     | `valid`       | 保持     |
 * | サーバーが「セッションは無い」と明示          | 200 + `null` / user 無し | `invalid`     | **破棄** |
 * | サーバーが「認証できない」と明示              | 401                      | `invalid`     | **破棄** |
 * | 圏外・DNS 失敗・タイムアウト（会場の Wi-Fi）  | 応答なし                 | `unreachable` | 保持     |
 * | サーバー側の一過性の障害                      | 5xx                      | `unreachable` | 保持     |
 * | オリジン拒否                                  | 403                      | `unreachable` | 保持     |
 * | エンドポイントが無い・プロキシが挟まった       | その他の非 2xx           | `unreachable` | 保持     |
 * | 応答が JSON として壊れている（captive portal）| 200 + 壊れた本文         | `unreachable` | 保持     |
 * | SecureStore が読めない（ロック中・一過性）    | 検証に行く前              | `unreachable` | 保持     |
 *
 * ### 最後の行（SecureStore が読めない）について
 * これだけは HTTP の話ではなく `auth.ts` 側の条件だが、扱いは同じなので表に入れてある。
 * `readToken()` が `ok: false` を返したら **「トークンが無い」と見なしてはいけない**。
 * 起動直後（デバイスがまだロック解除されていない等）にキーチェーンが一度読めないだけで
 * 匿名サインインしてしまうと、生きている本物のトークンを上書きして恒久的に失う。
 * 何もせず次回にリトライする（`ensureSessionOnce()` / `recoverOnce()` の先頭のガード）。
 *
 * ### 403 を `invalid` にしない理由（ARCHITECTURE §2）
 * 403 は「このセッションは無い」ではなく「このリクエストを受け付けない」。
 * `trustedOrigins` の設定ミス（`exp://*` はワイルドカードが `/` を跨げず
 * `exp://192.168.1.23:8081/--/` に 403 を返す）は **全来場者に同時に** 起きるので、
 * これを `invalid` にすると会場全員のアカウントを一斉に消す。迷ったら消さない。
 *
 * ### 「壊れた本文」を `invalid` にしない理由
 * 会場の Wi-Fi が captive portal を挟むと、200 で HTML のログインページが返る。
 * JSON として読めない応答は「セッションの有無について何も言っていない」と扱う。
 */

/** `get-session` が返すユーザー。必要な分だけ。 */
export type SessionUser = {
  id: string
  name?: string | null
  isAnonymous?: boolean | null
}

/** `invalid` と判断した根拠（ログ用）。 */
export type InvalidReason = 'http-401' | 'null-session' | 'no-user'

/** `unreachable` と判断した根拠（ログ用）。 */
export type UnreachableReason =
  | 'no-response'
  | 'server-error'
  | 'forbidden'
  | 'unexpected-status'
  | 'broken-body'

/**
 * セッション検証の結果。**3 状態あることがこのモジュールの存在理由**。
 * `invalid`（サーバーが無いと明示した）と `unreachable`（判定不能）を混ぜると、
 * 一瞬の通信断で来場者のアカウントが消える。
 */
export type SessionCheck =
  | { status: 'valid'; user: SessionUser }
  | { status: 'invalid'; reason: InvalidReason }
  | { status: 'unreachable'; reason: UnreachableReason }

/** HTTP 層の観測結果。`reachable: false` は応答が一切無かったこと（圏外・タイムアウト）。 */
export type HttpOutcome = { reachable: false } | { reachable: true; status: number }

/** 本文の読み取り結果。`ok: false` は JSON として壊れていたこと。 */
export type BodyRead = { ok: true; value: unknown } | { ok: false }

const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_SERVER_ERROR_MIN = 500
const HTTP_OK_MIN = 200
const HTTP_OK_MAX = 299

/**
 * ステータスコードだけで決まる分類。
 * 本文を読まないと決まらないときだけ `'read-body'` を返す。
 */
export function classifySessionResponse(outcome: HttpOutcome): SessionCheck | 'read-body' {
  // サーバーに届かなかった。セッションの有無については何も分かっていない。
  if (!outcome.reachable) return { status: 'unreachable', reason: 'no-response' }
  const { status } = outcome
  // サーバーが「このトークンでは認証できない」と明示した。ここだけが破棄してよい HTTP。
  if (status === HTTP_UNAUTHORIZED) return { status: 'invalid', reason: 'http-401' }
  // オリジン拒否。設定ミスなら全員に同時に起きるので絶対に破棄しない。
  if (status === HTTP_FORBIDDEN) return { status: 'unreachable', reason: 'forbidden' }
  // 一過性のサーバー障害。
  if (status >= HTTP_SERVER_ERROR_MIN) return { status: 'unreachable', reason: 'server-error' }
  // 404（エンドポイント違い）・302（captive portal）など。判定不能。
  if (status < HTTP_OK_MIN || status > HTTP_OK_MAX) {
    return { status: 'unreachable', reason: 'unexpected-status' }
  }
  return 'read-body'
}

/** `unknown` から `SessionUser` を取り出す。取り出せなければ null。 */
export function extractSessionUser(value: unknown): SessionUser | null {
  if (value === null || typeof value !== 'object') return null
  const user = (value as { user?: unknown }).user
  if (user === null || user === undefined || typeof user !== 'object') return null
  const id = (user as { id?: unknown }).id
  if (typeof id !== 'string' || id.length === 0) return null
  const name = (user as { name?: unknown }).name
  const isAnonymous = (user as { isAnonymous?: unknown }).isAnonymous
  return {
    id,
    name: typeof name === 'string' ? name : null,
    isAnonymous: typeof isAnonymous === 'boolean' ? isAnonymous : null,
  }
}

/**
 * 2xx が返ったときの本文の分類。
 * Better Auth はセッションが無いと `null` を返す（＝サーバーの明示的な「無い」）。
 */
export function classifySessionBody(body: BodyRead): SessionCheck {
  // JSON として読めない = captive portal などに差し替えられた。判定不能。
  if (!body.ok) return { status: 'unreachable', reason: 'broken-body' }
  if (body.value === null) return { status: 'invalid', reason: 'null-session' }
  const user = extractSessionUser(body.value)
  if (user === null) return { status: 'invalid', reason: 'no-user' }
  return { status: 'valid', user }
}

/**
 * **保存済みトークンを消してよいか。** 上の表の「トークン」列そのもの。
 * `invalid` 以外では絶対に true を返さない。
 */
export function shouldDiscardToken(check: SessionCheck): boolean {
  return check.status === 'invalid'
}

// ── ユーザーに見せる文言 ────────────────────────────────────
// 「届かなかった」と「セッションが切れた」は原因も対処も違う。混ぜない。

/** 通信できなかった（トークンは残っている。電波が戻れば元のアカウントで続けられる）。 */
export const SESSION_MESSAGE_UNREACHABLE_JA = '通信できませんでした。電波を確認してください'
/** セッションが無効だった（作り直す。前のアカウントには戻れない）。 */
export const SESSION_MESSAGE_RECREATED_JA = 'セッションが切れました。作り直します'
/** 作り直そうとして失敗した。 */
export const SESSION_MESSAGE_SIGN_IN_FAILED_JA =
  'セッションを作れませんでした。少し待ってからもう一度お試しください'

/** 判定結果に対応する文言。`valid` のときは出すものが無いので null。 */
export function sessionMessageJa(check: SessionCheck): string | null {
  if (check.status === 'valid') return null
  if (check.status === 'unreachable') return SESSION_MESSAGE_UNREACHABLE_JA
  return SESSION_MESSAGE_RECREATED_JA
}

/** ログ 1 行用の短い説明（`console.warn` に出す）。 */
export function describeSessionCheck(check: SessionCheck): string {
  if (check.status === 'valid') return 'valid'
  return `${check.status}(${check.reason})`
}

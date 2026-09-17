/**
 * 認証トークンの保存先。**プラットフォーム分岐はこのファイルだけ。**
 *
 * - ネイティブ（Expo Go / iOS / Android）: `expo-secure-store`（キーチェーン）
 * - Web: `localStorage`
 *
 * ## なぜ Web だけ別なのか
 *
 * `expo-secure-store` の **Web 実装は空のスタブ**（`ExpoSecureStore.web.js` が
 * `export default {}`）で、`getItemAsync()` が中で存在しない関数を呼んで必ず例外になる。
 * その結果 `readToken()` が毎回「判定不能」を返し、匿名サインインが一度も走らず、
 * **Web 版は一度も遊べない**状態だった。
 *
 * ## localStorage の安全性について（意図的な判断。docs/QUESTIONS.md C を参照）
 *
 * `localStorage` は SecureStore（キーチェーン）より**安全ではない**。
 * 同一オリジンの JavaScript から読めるので、XSS があれば盗まれる。
 *
 * それでも採ったのは、**保存するのが PII を含まない匿名の端末トークン 1 個だけ**だから。
 * 紐づくのは表示名・図鑑・記録だけで、メールアドレスも電話番号も決済情報も持たない。
 * 盗まれて起きる最悪は「他人がその匿名アカウントとして遊べる」ことで、
 * 展示用のブラウザ版としては受け入れられる。
 * **Web に本人性のあるログインを足すときは、この判断を見直すこと。**
 *
 * ## 失敗の扱い
 *
 * 読めないときは **例外を投げる**（`null` を返さない）。
 * 呼び出し側（`lib/auth.ts` の `readToken()`）が「読めなかった」と「本当に無い」を
 * 区別していて、混ぜると本物のトークンを上書きしてしまうため。
 * プライベートブラウジングなどで `localStorage` に触れないときも例外になり、
 * 「判定不能」として扱われる（＝落ちないし、トークンも消さない）。
 */

import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { SECURE_STORE_AUTH_TOKEN_KEY as TOKEN_KEY } from './constants'

const isWeb = Platform.OS === 'web'

/**
 * Web の保存先。
 *
 * **プロパティに触るだけで例外が飛ぶ**ブラウザがある（サイトデータをブロックする設定、
 * プライベートブラウジングなど）ので、必ず try の内側から呼ぶこと。
 * 呼び出し側がそのまま「判定不能」に畳む。
 */
function webStorage(): Storage {
  const storage = globalThis.localStorage
  if (storage === undefined || storage === null) {
    throw new Error('localStorage が使えません')
  }
  return storage
}

/** 保存済みトークン。無ければ `null`。**読めなければ例外。** */
export async function readStoredToken(): Promise<string | null> {
  if (isWeb) return webStorage().getItem(TOKEN_KEY)
  return await SecureStore.getItemAsync(TOKEN_KEY)
}

/** トークンを保存する。**書けなければ例外。** */
export async function writeStoredToken(token: string): Promise<void> {
  if (isWeb) {
    webStorage().setItem(TOKEN_KEY, token)
    return
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token)
}

/** トークンを消す。**消せなければ例外。** */
export async function deleteStoredToken(): Promise<void> {
  if (isWeb) {
    webStorage().removeItem(TOKEN_KEY)
    return
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}

/** ログや警告に出す保存先の名前（どちらに書いたのか分かるように）。 */
export const TOKEN_STORE_NAME = isWeb ? 'localStorage' : 'SecureStore'

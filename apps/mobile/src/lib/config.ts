/**
 * API のベース URL の解決。
 *
 * 1. `EXPO_PUBLIC_API_URL` があればそれ（明示指定が最優先）
 * 2. `__DEV__` のときだけ Expo Go の `hostUri`（= Metro を動かしている PC）の
 *    ホスト部 + :8787。Expo Go は実機なので `localhost` では開発サーバに届かない。
 *    hostUri が取れなければ `http://localhost:8787`。
 * 3. それ以外（本番 / EAS Update）は contracts の `API_BASE_URL`。
 *
 * 本番で env を入れ忘れても localhost に落ちない（黙ってどこにも繋がらないのを防ぐ）。
 */

import { API_BASE_URL } from '@coto2ba/contracts'
import Constants from 'expo-constants'
import { DEV_API_PORT, FALLBACK_API_URL } from './constants'

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** `192.168.1.23:8081` や `exp://192.168.1.23:8081` からホスト部だけ取り出す。 */
function hostOf(hostUri: string): string | null {
  const withoutScheme = hostUri.replace(/^[a-z+]+:\/\//i, '')
  const authority = withoutScheme.split('/')[0] ?? ''
  const host = authority.split(':')[0]
  return host && host.length > 0 ? host : null
}

function devHostUri(): string | null {
  const config = Constants.expoConfig as { hostUri?: string } | null
  const fromConfig = config?.hostUri
  if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig
  const fromManifest = (Constants as { experienceUrl?: string }).experienceUrl
  return typeof fromManifest === 'string' && fromManifest.length > 0 ? fromManifest : null
}

let cached: string | null = null

export function resolveApiBaseUrl(): string {
  if (cached !== null) return cached

  const fromEnv = process.env.EXPO_PUBLIC_API_URL
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    cached = stripTrailingSlash(fromEnv.trim())
    return cached
  }

  if (__DEV__) {
    const hostUri = devHostUri()
    const host = hostUri ? hostOf(hostUri) : null
    cached = host ? `http://${host}:${DEV_API_PORT}` : FALLBACK_API_URL
    return cached
  }

  cached = stripTrailingSlash(API_BASE_URL)
  return cached
}

/** テスト・設定画面から手動で差し替える用。 */
export function overrideApiBaseUrl(url: string | null): void {
  cached = url === null ? null : stripTrailingSlash(url)
}

/** ベース URL + パスを結合する。パスは `/api/...` の形で渡す。 */
export function apiUrl(path: string): string {
  const base = resolveApiBaseUrl()
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
}

/** API のオリジンが開発用（LAN / localhost）か。設定画面のデバッグ表示に使う。 */
export function isDevApiUrl(): boolean {
  return resolveApiBaseUrl().startsWith('http://')
}

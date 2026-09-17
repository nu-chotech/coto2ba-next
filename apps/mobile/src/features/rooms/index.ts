/**
 * 対戦ルーム（設計 §9）。
 *
 * **「設計 §9」は `docs/superpowers/specs/2026-09-17-exhibition-ux-overhaul-design.md` §9**
 * を指す（SPEC.md に対戦ルームの節は無い。SPEC の §9 は図鑑で別物）。
 *
 * **この feature は他から参照されない形に保つこと。** 間に合わなければ
 * ロビーの入口（`play/index.tsx` の「みんなで対戦」）とルートの
 * `RoomDeepLinkGate` を外すだけで機能ごと落とせる。
 */
export * from './code'
export * from './constants'
export * from './queries'
export * from './RoomDeepLinkGate'
export * from './RoomLobby'
export * from './RoomRace'
export * from './RoomResult'
export * from './RoomStandings'
export * from './routes'

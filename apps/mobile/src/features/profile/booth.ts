/**
 * ブースモードの「次の人へ」の判断（SPEC §8.8）。
 *
 * **`booth` の権威はサーバー（`users.booth`）だが、「次の人へ」が作る匿名ユーザーの
 * `booth` は DB 既定の `false`。** 何もしないと、係員が設定タブを開くか
 * Expo Go をリロードした瞬間にブースモードが OFF に落ち、以後の来場者が
 * **同一アカウントを共有**する（ランキング・図鑑・引き継ぎ QR が混ざる）。
 * 展示中に必ず踏むので、新しいユーザーに `PATCH /api/me {booth:true}` を打ち直す。
 *
 * 端末ローカルの永続設定に寄せる手もあるが、`booth` をサーバーが持つ設計
 * （`store/settings.ts` / `features/profile/queries.ts`）をそのまま残したいので、
 * **サーバーを権威のままにして入れ直す**ほうを採った。リロードしても
 * `GET /api/me` が true を返すので、この方式なら再起動にも耐える。
 *
 * **React にも react-native にも依存しない**（`tests/booth-handover.test.ts` が
 * 画面を描かずに振る舞いを検証できるように）。
 */

/** 「次の人へ」の結果。切り替え自体が失敗したときの一言。 */
export const BOOTH_HANDOVER_FAILED_JA = '次の人に切り替えられませんでした。もう一度押してください'

/** 切り替えはできたが、ブースモードを引き継げなかったときの一言。 */
export const BOOTH_LOST_JA = 'ブースモードを引き継げませんでした。設定タブで入れ直してください'

export type NextPlayerDeps = {
  /** 端末が覚えているブースモード（`store/settings.ts`）。 */
  boothMode: boolean
  /** 新しい匿名ユーザーに差し替える（`lib/auth` の `resetSession`）。 */
  resetSession: () => Promise<{ switched: boolean; token: string | null }>
  /** 新しいユーザーに `booth` を入れ直す（`PATCH /api/me`）。失敗したら投げる。 */
  applyBooth: () => Promise<unknown>
}

export type NextPlayerResult = {
  /** 新しい匿名ユーザーに切り替わったか。false なら前の人のまま。 */
  switched: boolean
  /** ブースモードを新しい人にも引き継げたか（元から OFF なら true）。 */
  boothKept: boolean
  /** 画面に出す一言。問題なければ null。 */
  messageJa: string | null
}

/**
 * 「次の人へ」。**切り替わったときだけ** `booth` を入れ直す。
 *
 * 切り替えに失敗した状態で PATCH すると、**いまの人**（前の来場者）に打つことになる。
 */
export async function handOverToNextPlayer(deps: NextPlayerDeps): Promise<NextPlayerResult> {
  const reset = await deps.resetSession()
  if (!reset.switched) {
    return { switched: false, boothKept: deps.boothMode, messageJa: BOOTH_HANDOVER_FAILED_JA }
  }
  if (!deps.boothMode) return { switched: true, boothKept: true, messageJa: null }

  try {
    await deps.applyBooth()
    return { switched: true, boothKept: true, messageJa: null }
  } catch {
    // 黙って落とさない。係員が設定タブで入れ直せるように画面に出す。
    return { switched: true, boothKept: false, messageJa: BOOTH_LOST_JA }
  }
}

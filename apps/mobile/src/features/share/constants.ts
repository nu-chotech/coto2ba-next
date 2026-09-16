/**
 * シェア画像の定数。
 *
 * テキスト版の書式は contracts / `features/game/result.ts` の `shareText()` が持つ。
 * ここに置くのは画像の寸法と保存先だけ。
 */

/** Skia で書き出すときの実寸（px）。4:5 は X / Instagram / LINE で切られにくい。 */
export const SHARE_IMAGE_WIDTH = 1080
export const SHARE_IMAGE_HEIGHT = 1350

/** RN の結果カード（`captureRef` の対象）の論理幅。実解像度は端末の倍率ぶん上がる。 */
export const SHARE_CARD_WIDTH = 340
/** RN カードのゴール語の字送り。 */
export const SHARE_CARD_GOAL_FONT_SIZE = 44
export const SHARE_CARD_GOAL_LINE_HEIGHT = 56
/** tier のマスの行。 */
export const SHARE_CARD_PATH_FONT_SIZE = 26
export const SHARE_CARD_PATH_LINE_HEIGHT = 34
/** カードを画面外に置くときのオフセット（描画はされるが見えない位置）。 */
export const SHARE_CARD_OFFSCREEN = -2000

/** キャッシュ下の保存先ディレクトリ名。 */
export const SHARE_DIRECTORY = 'share'
export const SHARE_MIME_TYPE = 'image/png'
/** iOS のシェアシートに渡す UTI。 */
export const SHARE_UTI = 'public.png'
export const SHARE_DIALOG_TITLE = 'コトコトバの結果'

/** PNG の品質（PNG は可逆なので実質サイズの指標）。 */
export const SHARE_PNG_QUALITY = 100

// ── Skia 版カードのレイアウト（px）────────────────────────────
export const SHARE_PADDING = 96
export const SHARE_TITLE_SIZE = 44
export const SHARE_GOAL_SIZE = 132
export const SHARE_BODY_SIZE = 48
export const SHARE_FOOTER_SIZE = 34
/** tier のマス 1 つの一辺と間隔。 */
export const SHARE_CELL_SIZE = 56
export const SHARE_CELL_GAP = 12
export const SHARE_CELL_RADIUS = 12
/** Skia がシステムから引く和文フォント（iOS）。Android では既定にフォールバックする。 */
export const SHARE_FONT_FAMILY = 'Hiragino Sans'

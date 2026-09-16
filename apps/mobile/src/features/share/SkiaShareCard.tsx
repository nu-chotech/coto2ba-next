/**
 * 結果カード（Skia 版）。`captureRef` が使えなかったときのフォールバック。
 *
 * `drawAsImage` でオフスクリーンに 1080×1350 で描くので、
 * **画面にマウントする必要がない**（`captureRef` と違って Canvas のサイズにも縛られない）。
 *
 * フォントは `matchFont` でシステムから引く（iOS はヒラギノ）。
 * `@expo-google-fonts/noto-sans-jp` は依存に無いので、Skia 用にフォントを
 * 同梱せずに和文を出せるこの道を使う。Android では既定の和文フォントになる。
 *
 * tier のマスは絵文字ではなく塗りの角丸で描く（Skia のシステムフォントでは
 * 絵文字が豆腐になることがあるため）。
 */

import {
  DIFFICULTY_LABELS_JA,
  type GameDetail,
  LANDING_URL,
  MAX_MOVES,
  type TierId,
} from '@coto2ba/contracts'
import {
  Fill,
  Group,
  LinearGradient,
  matchFont,
  RoundedRect,
  rect,
  rrect,
  type SkFont,
  Text as SkiaText,
  vec,
} from '@shopify/react-native-skia'
import { palette, paletteForTier, tierPalettes } from '../../theme'
import { currentTier, shortDate } from '../game'
import {
  SHARE_BODY_SIZE,
  SHARE_CELL_GAP,
  SHARE_CELL_RADIUS,
  SHARE_CELL_SIZE,
  SHARE_FONT_FAMILY,
  SHARE_FOOTER_SIZE,
  SHARE_GOAL_SIZE,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  SHARE_PADDING,
  SHARE_TITLE_SIZE,
} from './constants'

function font(size: number, weight: 'normal' | 'bold'): SkFont {
  return matchFont({ fontFamily: SHARE_FONT_FAMILY, fontSize: size, fontWeight: weight })
}

/** 中央に置くための x 座標。 */
function centerX(text: string, textFont: SkFont): number {
  return (SHARE_IMAGE_WIDTH - textFont.getTextWidth(text)) / 2
}

export type SkiaShareCardProps = {
  game: GameDetail
}

export function SkiaShareCard({ game }: SkiaShareCardProps) {
  const tier: TierId = currentTier(game)
  const colors = paletteForTier(tier)
  const cleared = game.status === 'cleared'

  const titleFont = font(SHARE_TITLE_SIZE, 'normal')
  const goalFont = font(SHARE_GOAL_SIZE, 'bold')
  const bodyFont = font(SHARE_BODY_SIZE, 'normal')
  const footerFont = font(SHARE_FOOTER_SIZE, 'normal')

  const headline = game.perfect ? '完全錬成' : cleared ? 'クリア' : 'ギブアップ'
  const summary = cleared
    ? `${game.move_count} 手で${game.perfect ? '完全錬成' : 'クリア'}（ヒント ${game.hint_count}）`
    : `${game.move_count} 手でギブアップ（ヒント ${game.hint_count}）`
  const route = `${game.start} → ${game.goal}`
  const meta = `${DIFFICULTY_LABELS_JA[game.difficulty]} ・ 最大 ${MAX_MOVES} 手`

  // 縦の配置（px）。上から順に積む。
  const titleY = SHARE_PADDING + SHARE_TITLE_SIZE
  const headlineY = titleY + SHARE_TITLE_SIZE * 3
  const goalY = headlineY + SHARE_GOAL_SIZE * 1.6
  const routeY = goalY + SHARE_BODY_SIZE * 2
  const cellsY = routeY + SHARE_BODY_SIZE * 1.6
  const summaryY = cellsY + SHARE_CELL_SIZE + SHARE_BODY_SIZE * 1.8
  const metaY = summaryY + SHARE_BODY_SIZE * 1.6
  const footerY = SHARE_IMAGE_HEIGHT - SHARE_PADDING

  const cells = game.moves.map((move) => move.tier)
  const cellsWidth = cells.length * SHARE_CELL_SIZE + Math.max(0, cells.length - 1) * SHARE_CELL_GAP
  const cellsStartX = (SHARE_IMAGE_WIDTH - cellsWidth) / 2

  return (
    <Group>
      <Fill>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT)}
          colors={[colors.bg, palette.base]}
        />
      </Fill>

      <SkiaText
        x={centerX('コトコトバ', titleFont)}
        y={titleY}
        text="コトコトバ"
        font={titleFont}
        color={colors.sub}
      />
      <SkiaText
        x={centerX(shortDate(game), titleFont)}
        y={titleY + SHARE_TITLE_SIZE * 1.4}
        text={shortDate(game)}
        font={titleFont}
        color={colors.sub}
      />
      <SkiaText
        x={centerX(headline, bodyFont)}
        y={headlineY}
        text={headline}
        font={bodyFont}
        color={colors.accent}
      />
      <SkiaText
        x={centerX(game.goal, goalFont)}
        y={goalY}
        text={game.goal}
        font={goalFont}
        color={colors.text}
      />
      <SkiaText
        x={centerX(route, bodyFont)}
        y={routeY}
        text={route}
        font={bodyFont}
        color={colors.sub}
      />

      {cells.map((cellTier, index) => (
        <RoundedRect
          // 手の並びは固定で、並べ替えも差し込みも起きない。
          // 同じ tier が連続するので index を含めないと key が衝突する。
          // biome-ignore lint/suspicious/noArrayIndexKey: 並べ替えの無い固定長の列
          key={`${index}-${cellTier}`}
          rect={rrect(
            rect(
              cellsStartX + index * (SHARE_CELL_SIZE + SHARE_CELL_GAP),
              cellsY,
              SHARE_CELL_SIZE,
              SHARE_CELL_SIZE,
            ),
            SHARE_CELL_RADIUS,
            SHARE_CELL_RADIUS,
          )}
          color={tierPalettes[cellTier].accent}
        />
      ))}

      <SkiaText
        x={centerX(summary, bodyFont)}
        y={summaryY}
        text={summary}
        font={bodyFont}
        color={colors.text}
      />
      <SkiaText
        x={centerX(meta, footerFont)}
        y={metaY}
        text={meta}
        font={footerFont}
        color={colors.sub}
      />
      <SkiaText
        x={centerX(LANDING_URL, footerFont)}
        y={footerY}
        text={LANDING_URL}
        font={footerFont}
        color={colors.sub}
      />
    </Group>
  )
}

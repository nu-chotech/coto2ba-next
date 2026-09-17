/**
 * 図鑑（SPEC §9 / §7 の再設計）。
 *
 * **主役は「自分が歩いた軌跡」。** 全画面の Skia Canvas に、選択中の経路を
 * 光る折れ線で描き、出会った語・未取得のゴースト点・今日のゴールを背景に置く。
 * 開いた瞬間にその経路が画面に収まるようカメラを置く（アニメーションで寄せない。
 * 寄せると「まず放り出されて、それから連れて行かれる」ことになる）。
 *
 * 上は検索ではなく**経路の切り替え**。検索は右上のアイコンからシートで開く。
 * 結果画面の「この軌跡を見る」からは `?game=<id>` で入ってくる。これは
 * **一度きりの指示**として扱い、読んだら消す（何度でも同じ軌跡に寄れる）。
 * パンで回し、ピンチで寄り、二本指タップで経路に戻り、タップで語の詳細。
 *
 * **サーバーが空でも落ちない。** `GET /api/collection` が失敗しても
 * ゴースト点だけの宇宙が出て、「まだ語に出会っていません」と案内する。
 */

import { SPACE_GHOST_COUNT } from '@coto2ba/contracts'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GlassCard, SkiaGate, SymbolIcon, toMessageJa } from '../../../components'
import {
  buildSpaceScene,
  collectionSummary,
  type GoalMarker,
  hasRealGhosts,
  overviewPoints,
  pathOptions,
  pathPoints,
  SearchSheet,
  SPACE_SEARCH_BUTTON_SIZE,
  SpaceCanvas,
  SpaceLabels,
  selectPath,
  useCollectionQuery,
  useSpaceCamera,
  useWordDetailQuery,
  WordSheet,
} from '../../../features/collection'
import { useDailyQuery } from '../../../features/game'
import { jstToday } from '../../../features/ranking'
import { feedback } from '../../../lib/feedback'
import {
  borderWidth,
  iconSize,
  layout,
  radius,
  SCREEN_TOP_PADDING,
  SPACE_TIER,
  spacing,
  typography,
  useTheme,
} from '../../../theme'

export default function SpaceScreen() {
  /**
   * **ここは必ずダークのパレットになる。** 図鑑は宇宙なので、端末がライトでも
   * 地は暗いまま（意図的な例外）。固定しているのは `_layout.tsx` の
   * `<ThemeProvider scheme={SPACE_SCHEME}>` で、この画面はただフックを読むだけでよい。
   */
  const { palette, paletteForTier } = useTheme()
  const colors = paletteForTier(SPACE_TIER)
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { game } = useLocalSearchParams<{ game?: string }>()

  const collection = useCollectionQuery()
  const daily = useDailyQuery()
  // 今日のゴールの座標はコレクションに無いことがあるので、語の詳細から取る。
  const goalWord = daily.data?.goal ?? null
  const goalDetail = useWordDetailQuery(goalWord)

  const goalMarker = useMemo<GoalMarker | null>(() => {
    if (goalWord === null) return null
    const pos3 = goalDetail.data?.pos3 ?? null
    return pos3 === null ? null : { word: goalWord, pos3 }
  }, [goalWord, goalDetail.data])

  const scene = useMemo(
    () => buildSpaceScene(collection.data, goalMarker),
    [collection.data, goalMarker],
  )
  /** 点の数が変わったら Canvas ごと作り直す（共有値の長さを合わせるため）。 */
  const sceneKey = `${collection.dataUpdatedAt}:${goalMarker?.word ?? ''}`

  const { camera, gesture, reset, focusOn, frameTo, onRecenterRef } = useSpaceCamera()

  const [size, setSize] = useState({ width: 0, height: 0 })
  const onResize = useCallback((width: number, height: number) => {
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    )
  }, [])

  // ── どの軌跡を見るか ──────────────────────────────────────
  // 既定はいちばん新しいクリア。選ぶのは game_id（経路の並びが変わっても迷子にならない）。
  const [pickedGameId, setPickedGameId] = useState<string | null>(null)
  /** フレーミングをやり直させるための合図（同じ経路をもう一度指されたとき）。 */
  const [frameRequest, setFrameRequest] = useState(0)
  /**
   * **指された軌跡が無いときに黙って別の軌跡を開かない。**
   * 図鑑に残るのはクリアした挑戦だけなので、ギブアップした挑戦を指されると外れる。
   * 落ちたことは下の一言で伝える（`pathNotice`）。
   */
  const selection = useMemo(
    () => selectPath(scene.paths, pickedGameId),
    [scene.paths, pickedGameId],
  )
  const activePathIndex = selection.index
  const activePath = activePathIndex === null ? null : (scene.paths[activePathIndex] ?? null)
  const options = useMemo(() => pathOptions(scene.paths, jstToday()), [scene.paths])
  /**
   * カメラを合わせる先。経路があればその節、無ければ**宇宙そのもの**。
   * クリアが 1 本も無い人（＝ブースで最初に図鑑を開いた来場者）を、
   * 「中央やや左の小さな染み」の前に放り出さない。
   */
  const framingPoints = useMemo(() => {
    const points = pathPoints(scene, activePathIndex)
    return points.length > 0 ? points : overviewPoints(scene)
  }, [scene, activePathIndex])

  /**
   * 選択中の経路にカメラを合わせる。
   * **最初の 1 回は待たせずにその位置から始める**（開いた瞬間に軌跡が見えること）。
   */
  const framedRef = useRef<string | null>(null)
  useEffect(() => {
    if (framingPoints.length === 0) return
    // 合図（frameRequest）を鍵に混ぜる。同じ軌跡をもう一度指されても寄せ直すため。
    const key = `${frameRequest}:${
      activePathIndex === null ? 'overview' : (scene.paths[activePathIndex]?.gameId ?? '')
    }`
    if (framedRef.current === key) return
    const first = framedRef.current === null
    framedRef.current = key
    frameTo(framingPoints, first)
  }, [scene, activePathIndex, framingPoints, frameTo, frameRequest])

  /**
   * 結果画面の「この軌跡を見る」から `?game=<id>` で入ってきたとき。
   * **読んだらパラメータを消す。** 残しておくと、そのあとチップで別の軌跡を
   * 選んでも、タブに戻るたびに指示が生き返ってしまう。
   */
  useEffect(() => {
    if (typeof game !== 'string' || game.length === 0) return
    setPickedGameId(game)
    // 待たせずにその位置から始める（結果画面から続いている一連の動きなので）。
    framedRef.current = null
    setFrameRequest((current) => current + 1)
    router.setParams({ game: undefined })
  }, [game, router])

  /** 迷子からの復帰。二本指タップと画面下のボタンの両方から呼ぶ。 */
  const recenter = useCallback(() => {
    setSelectedIndex(-1)
    setSheetIndex(-1)
    if (framingPoints.length === 0) reset()
    else frameTo(framingPoints, false)
  }, [framingPoints, frameTo, reset])
  useEffect(() => {
    onRecenterRef.current = recenter
  }, [recenter, onRecenterRef])

  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [sheetIndex, setSheetIndex] = useState(-1)
  const [searchOpen, setSearchOpen] = useState(false)

  const focusIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= scene.count) return
      setSelectedIndex(index)
      focusOn([
        scene.xyz[index * 3] as number,
        scene.xyz[index * 3 + 1] as number,
        scene.xyz[index * 3 + 2] as number,
      ])
    },
    [scene, focusOn],
  )

  const onHit = useCallback((index: number) => {
    setSelectedIndex(index)
    setSheetIndex(index)
    if (index >= 0) feedback('hint_open')
  }, [])

  const onPickWord = useCallback(
    (word: string) => {
      const index = scene.indexByWord.get(word)
      if (index === undefined) return
      setSheetIndex(-1)
      focusIndex(index)
    },
    [scene, focusIndex],
  )

  const sheetNode = sheetIndex >= 0 ? (scene.nodes[sheetIndex] ?? null) : null
  const summary = collectionSummary(collection.data)
  /**
   * 指された軌跡を開けなかったときの一言。**無言のフォールバックにしない。**
   * 読み込み中は `scene.paths` が空なので、**コレクションが届いてから**判断する
   * （届く前に出すと、正しい軌跡が開く直前に一瞬だけ赤い文字が出る）。
   */
  const pathNotice =
    collection.data === undefined || !selection.fellBack
      ? null
      : activePathIndex === null
        ? 'この挑戦の軌跡は図鑑にありません（残るのはクリアした挑戦だけです）'
        : 'この挑戦の軌跡は図鑑にありません。いちばん新しい軌跡を出しています'
  const activeGameId = activePathIndex === null ? null : scene.paths[activePathIndex]?.gameId

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* Skia が使えないときに図鑑タブごとアプリを落とさないためのゲート。
          Web では CanvasKit の WASM を読み終わるまで待つ。 */}
      <SkiaGate label="図鑑">
        <SpaceCanvas
          key={sceneKey}
          scene={scene}
          camera={camera}
          gesture={gesture}
          onHit={onHit}
          selectedIndex={selectedIndex}
          activePathIndex={activePathIndex}
          onResize={onResize}
        />
      </SkiaGate>
      <SpaceLabels
        scene={scene}
        camera={camera}
        width={size.width}
        height={size.height}
        color={colors.text}
        subColor={colors.sub}
        activePath={activePath}
      />

      {/* ── 上：どの軌跡を見るか（検索ではない）── */}
      {/* 浮いている操作なので中身は絶対配置だが、上端の余白は他の画面と揃える。 */}
      <View
        style={[styles.top, { paddingTop: insets.top + SCREEN_TOP_PADDING }]}
        pointerEvents="box-none"
      >
        <View style={styles.topRow} pointerEvents="box-none">
          {options.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              style={styles.chipsScroll}
            >
              {options.map((option) => {
                const selected = option.gameId === activeGameId
                return (
                  <Pressable
                    key={option.gameId}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setPickedGameId(option.gameId)}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        borderColor: selected ? colors.accent : colors.sub,
                        backgroundColor: selected
                          ? colors.accent
                          : pressed
                            ? palette.pressed
                            : colors.surface,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        typography.label,
                        { color: selected ? colors.onAccent : colors.text },
                      ]}
                    >
                      {option.label}
                    </Text>
                    <Text
                      style={[typography.label, { color: selected ? colors.onAccent : colors.sub }]}
                    >
                      {option.detail}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : (
            <View style={styles.chipsScroll} pointerEvents="none" />
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="語を探す"
            onPress={() => setSearchOpen(true)}
            style={({ pressed }) => [
              styles.searchButton,
              {
                borderColor: colors.sub,
                backgroundColor: pressed ? palette.pressed : colors.surface,
              },
            ]}
          >
            <SymbolIcon name="magnifyingglass" size={iconSize.md} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {/* ── 下：状態と操作 ── */}
      <View
        style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}
        pointerEvents="box-none"
      >
        {scene.ownedCount === 0 ? (
          <GlassCard tint={colors.glassTint} style={styles.notice}>
            <Text style={[typography.subtitle, { color: colors.text }]}>
              まだ語に出会っていません
            </Text>
            <Text style={[typography.caption, { color: colors.sub }]}>
              {collection.isError
                ? toMessageJa(collection.error)
                : 'プレイして語に出会うと、この宇宙に色のついた星が増えます。'}
            </Text>
            <Text style={[typography.label, { color: colors.sub }]}>
              いま見えているのは
              {hasRealGhosts()
                ? `まだ出会っていない ${SPACE_GHOST_COUNT.toLocaleString('ja-JP')} 語`
                : '仮の星'}
              です
            </Text>
          </GlassCard>
        ) : (
          <View style={styles.statusRow} pointerEvents="box-none">
            <Text
              style={[
                typography.label,
                styles.status,
                { color: pathNotice === null ? colors.sub : colors.accent },
              ]}
            >
              {pathNotice ??
                (options.length === 0
                  ? 'クリアすると、歩いた軌跡がここに残ります'
                  : (summary ?? ''))}
            </Text>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={recenter}
          style={({ pressed }) => [
            styles.resetButton,
            {
              borderColor: colors.sub,
              backgroundColor: pressed ? palette.pressed : colors.surface,
            },
          ]}
        >
          <Text style={[typography.label, { color: colors.text }]}>
            {activePathIndex === null ? '視点をもどす' : '軌跡にもどす'}
          </Text>
        </Pressable>
      </View>

      <SearchSheet
        visible={searchOpen}
        scene={scene}
        onClose={() => setSearchOpen(false)}
        onPick={onPickWord}
      />
      <WordSheet node={sheetNode} onClose={() => setSheetIndex(-1)} onPickWord={onPickWord} />
    </View>
  )
}

const styles = StyleSheet.create({
  // 地の色は描画時に入れる（図鑑のパレットは Provider が決める）。
  root: { flex: 1 },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: spacing.sm,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chipsScroll: { flex: 1 },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: borderWidth.hairline,
  },
  searchButton: {
    width: SPACE_SEARCH_BUTTON_SIZE,
    height: SPACE_SEARCH_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: borderWidth.hairline,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: spacing.sm,
    alignItems: 'stretch',
  },
  notice: { gap: spacing.xs },
  statusRow: { alignItems: 'center' },
  status: { textAlign: 'center' },
  resetButton: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: borderWidth.hairline,
  },
})

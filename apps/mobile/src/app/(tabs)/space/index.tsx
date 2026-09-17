/**
 * 図鑑（SPEC §9 / §7 の再設計）。
 *
 * **主役は「自分が歩いた軌跡」。** 全画面の Skia Canvas に、選択中の経路を
 * 光る折れ線で描き、出会った語・未取得のゴースト点・今日のゴールを背景に置く。
 * 開いた瞬間にその経路が画面に収まるようカメラを置く（アニメーションで寄せない。
 * 寄せると「まず放り出されて、それから連れて行かれる」ことになる）。
 *
 * 上は検索ではなく**経路の切り替え**。検索は右上のアイコンからシートで開く。
 * パンで回し、ピンチで寄り、二本指タップで経路に戻り、タップで語の詳細。
 *
 * **サーバーが空でも落ちない。** `GET /api/collection` が失敗しても
 * ゴースト点だけの宇宙が出て、「まだ語に出会っていません」と案内する。
 */

import { SPACE_GHOST_COUNT } from '@coto2ba/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GlassCard, SkiaGate, SymbolIcon, toMessageJa } from '../../../components'
import {
  buildSpaceScene,
  collectionSummary,
  defaultPathIndex,
  findPathByGameId,
  type GoalMarker,
  hasRealGhosts,
  pathOptions,
  pathPoints,
  SearchSheet,
  SPACE_SEARCH_BUTTON_SIZE,
  SpaceCanvas,
  SpaceLabels,
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
  palette,
  paletteForTier,
  radius,
  SCREEN_TOP_PADDING,
  spacing,
  typography,
} from '../../../theme'

/**
 * 図鑑は宇宙。tier は固定。
 *
 * **意図的な例外：ライトモードでも地は暗いまま**（SPEC §4.3）。
 * `useTheme()` ではなくダーク固定の互換シムを読む。宇宙が白いと figure が壊れる。
 */
const SPACE_TIER = 'cosmos'
const colors = paletteForTier(SPACE_TIER)

export default function SpaceScreen() {
  const insets = useSafeAreaInsets()

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
  const activePathIndex = useMemo(
    () => findPathByGameId(scene.paths, pickedGameId) ?? defaultPathIndex(scene.paths),
    [scene.paths, pickedGameId],
  )
  const activePath =
    activePathIndex === null ? null : (scene.paths[activePathIndex]?.indices ?? null)
  const options = useMemo(() => pathOptions(scene.paths, jstToday()), [scene.paths])
  const activePoints = useMemo(() => pathPoints(scene, activePathIndex), [scene, activePathIndex])

  /**
   * 選択中の経路にカメラを合わせる。
   * **最初の 1 回は待たせずにその位置から始める**（開いた瞬間に軌跡が見えること）。
   */
  const framedRef = useRef<string | null>(null)
  useEffect(() => {
    if (activePathIndex === null || activePoints.length === 0) return
    const key = scene.paths[activePathIndex]?.gameId ?? ''
    if (framedRef.current === key) return
    const first = framedRef.current === null
    framedRef.current = key
    frameTo(activePoints, first)
  }, [scene, activePathIndex, activePoints, frameTo])

  /** 迷子からの復帰。二本指タップと画面下のボタンの両方から呼ぶ。 */
  const recenter = useCallback(() => {
    setSelectedIndex(-1)
    if (activePoints.length === 0) reset()
    else frameTo(activePoints, false)
  }, [activePoints, frameTo, reset])
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
  const activeGameId = activePathIndex === null ? null : scene.paths[activePathIndex]?.gameId

  return (
    <View style={styles.root}>
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
            <Text style={[typography.label, styles.status, { color: colors.sub }]}>
              {options.length === 0 ? 'クリアすると、歩いた軌跡がここに残ります' : (summary ?? '')}
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
            {activePoints.length > 0 ? '軌跡にもどす' : '視点をもどす'}
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
  root: { flex: 1, backgroundColor: palette.tiers.cosmos.bg },
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

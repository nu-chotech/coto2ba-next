# 混合ホイールと画面フロー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 比率の指定をオリジナルのこだわりだった **iPod 風の回転ホイール**に戻し、Alert に埋もれていたギブアップ等の動線を iOS の作法に沿った形に立て直す。

**Architecture:** 角度→段のスナップ判定を純粋関数に切り出してテストし、描画は Skia、ジェスチャは gesture-handler + Reanimated。新しいネイティブモジュールは不要。画面フローはネイティブのナビゲーションバー＋コンテキストメニューに置き換える。

**Tech Stack:** react-native-gesture-handler 2.32, Reanimated 4.5, @shopify/react-native-skia 2.6, expo-router 57

**Spec:** `docs/superpowers/specs/2026-09-17-exhibition-ux-overhaul-design.md` §5, §6

## Global Constraints

- Expo Go で動くこと。新しいネイティブモジュールを追加しない
- **`ratio` は `RATIOS` の 8 段階のみ。連続値にしない**（サーバーが厳密一致で検証しており、丸めると 422）
- 段が変わるたびにハプティクス（`selectionAsync`）＋クリック音。**既存の `feedback` の仕組みを使う**
- ハプティクスの既存実装は良い評価を得ている。**壊さないこと**
- 定数は `packages/contracts/src/constants.ts`（ゲーム定数）または
  `apps/mobile/src/components/constants.ts`（見た目の定数）に置く。マジックナンバー禁止
- TypeScript strict、Biome、`pnpm lint` / `pnpm typecheck` / `pnpm test` が緑であること

---

### Task 1: ホイールの幾何計算を純粋関数にする

worklet 内の計算をテストできる形に切り出す。

**Files:**
- Create: `apps/mobile/src/components/wheel-geometry.ts`
- Test: `apps/mobile/tests/wheel-geometry.test.ts`（テスト基盤が無ければ `packages/contracts` と同じ vitest 構成を `apps/mobile` に足す）

**Interfaces:**
- Consumes: `RATIOS`（contracts）
- Produces:
  - `angleToIndex(angleRad: number, count: number, sweepRad: number): number`
  - `indexToAngle(index: number, count: number, sweepRad: number): number`
  - `unwrapDelta(prevRad: number, nextRad: number): number` — ±π をまたぐ差分を連続にする
  - `clampIndex(index: number, count: number): number`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { angleToIndex, clampIndex, indexToAngle, unwrapDelta } from '../src/components/wheel-geometry'

const SWEEP = Math.PI * 1.5 // ホイールが使う扇の角度
const COUNT = 8

describe('angleToIndex / indexToAngle', () => {
  it('往復して同じ段に戻る', () => {
    for (let i = 0; i < COUNT; i++) {
      expect(angleToIndex(indexToAngle(i, COUNT, SWEEP), COUNT, SWEEP)).toBe(i)
    }
  })

  it('両端を超えた角度は端に丸める', () => {
    expect(angleToIndex(-10, COUNT, SWEEP)).toBe(0)
    expect(angleToIndex(10, COUNT, SWEEP)).toBe(COUNT - 1)
  })

  it('段の境界のちょうど真ん中で切り替わる', () => {
    const a = indexToAngle(3, COUNT, SWEEP)
    const b = indexToAngle(4, COUNT, SWEEP)
    const mid = (a + b) / 2
    // 真ん中より少しでも b 寄りなら 4 段目
    expect(angleToIndex(mid + 1e-4, COUNT, SWEEP)).toBe(4)
    expect(angleToIndex(mid - 1e-4, COUNT, SWEEP)).toBe(3)
  })
})

describe('unwrapDelta', () => {
  // atan2 は ±π をまたぐと符号が飛ぶ。そのまま差分を取ると
  // ホイールが 1 周ぶん暴れるので、ここで連続化する。
  it('π をまたいでも小さい差分になる', () => {
    expect(unwrapDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 6)
    expect(unwrapDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 6)
  })

  it('普通の差分はそのまま', () => {
    expect(unwrapDelta(0.1, 0.3)).toBeCloseTo(0.2, 6)
  })
})

describe('clampIndex', () => {
  it('範囲外を丸める', () => {
    expect(clampIndex(-1, COUNT)).toBe(0)
    expect(clampIndex(COUNT, COUNT)).toBe(COUNT - 1)
    expect(clampIndex(3, COUNT)).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coto2ba/mobile test`
Expected: FAIL

- [ ] **Step 3: 実装する**

すべて `'worklet'` ディレクティブ付きで書く（Reanimated の worklet から呼ぶため）。
純粋関数なので vitest からもそのまま呼べる。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coto2ba/mobile test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/wheel-geometry.ts apps/mobile/tests
git commit -m "feat(mobile): 回転ホイールの幾何計算と、その単体テスト"
```

---

### Task 2: `MixWheel` を実装して `MixSlider` を置き換える

**Files:**
- Create: `apps/mobile/src/components/MixWheel.tsx`
- Delete: `apps/mobile/src/components/MixSlider.tsx`
- Modify: `apps/mobile/src/components/index.ts`, `apps/mobile/src/components/constants.ts`
- Modify: `apps/mobile/src/app/(tabs)/play/game/[id].tsx`

**Interfaces:**
- Consumes: `wheel-geometry`（Task 1）、`feedback`（既存）、`RATIOS` / `indexToRatio` / `ratioToIndex`（contracts）
- Produces:
  - `MixWheel({ value, onChange, tier, disabled, style }): JSX.Element`
    — props は既存の `MixSliderProps` と同じにする（差し替えを 1 行で済ませるため）

- [ ] **Step 1: 既存の `MixSlider` を読む**

Run: `cat apps/mobile/src/components/MixSlider.tsx`
**踏襲すること**: `committed`（真の値）と `index`（表示専用）を分ける設計、
外から値が変わったときの追従、`feedback('slider_detent')` の呼び方。
ここは既に良くできているので、ジェスチャと描画だけ差し替える。

- [ ] **Step 2: ジェスチャを実装する**

- `Gesture.Pan()` で、ホイール中心から指への角度を `Math.atan2` で取る
- 前フレームとの差分を `unwrapDelta` で連続化して累積角にする
- 累積角を `angleToIndex` で段に変換し、**変わった瞬間だけ** `runOnJS` で
  `feedback('slider_detent')` と `onChange(indexToRatio(index))` を呼ぶ
- 指を離したら最寄りの段の角度に `withSpring` で収める
- 端では回り続けないよう `clampIndex` で止める（無限回転にしない。8 段階なので端がある）

- [ ] **Step 3: Skia で描画する**

- 目盛り 8 本を扇状に配置し、現在の段を強調する
- 中央に現在の比率を「今の語 : 混ぜる語」の割合として表示する
- tier のパレット（`paletteForTier`）で着色する
- `SkiaGate`（既存）でフォールバックを担保する。**Skia が使えない環境では
  既存のスライダー相当の代替を出す**（Web プレビューで確認するため）

- [ ] **Step 4: ゲーム画面で差し替える**

`play/game/[id].tsx` の `MixSlider` を `MixWheel` に置き換える。props は同じ。

- [ ] **Step 5: 8 段階が厳密に出ることを確認する**

Web プレビューでホイールを回し、送信される `ratio` をログに出して
`RATIOS` の値と**厳密に一致**することを確認する（0.30000000000000004 のような値が出ないこと）。
Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
Expected: 8 つの値以外が出ないこと

- [ ] **Step 6: `MixSlider` を削除する**

Run: `grep -rn "MixSlider" apps/mobile/src`
Expected: 参照が 0 件。その上でファイルを削除する

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src
git rm apps/mobile/src/components/MixSlider.tsx
git commit -m "feat(mobile): 比率の指定を iPod 風の回転ホイールに戻す"
```

---

### Task 3: ゲーム画面の動線を iOS の作法に直す

現状、ギブアップは `Alert.alert('メニュー', …)` の入れ子に埋まっている
（`play/game/[id].tsx:184`）。発見しづらく、確認も 2 段で過剰。

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/play/game/[id].tsx`
- Modify: `apps/mobile/src/app/(tabs)/play/_layout.tsx`

**Interfaces:**
- Consumes: `SymbolIcon`（design-system プランの Task 1）
- Produces: なし

- [ ] **Step 1: ナビゲーションバーを持たせる**

`play/_layout.tsx` のゲーム画面に、ネイティブのヘッダを出す。
タイトルは「ゴール語」か日付（デイリーなら日付、フリーなら難易度）。
**Large Title は使わない**（ゲーム中は盤面が主役）。

- [ ] **Step 2: 右上にメニューを置く**

`ellipsis.circle` の `SymbolIcon` を `headerRight` に置く。
押すとメニューが出て、項目は「遊び方」「ギブアップ」。
**Alert の入れ子をやめる。**

- [ ] **Step 3: ギブアップの確認を 1 段にする**

確認は 1 回だけ。破壊的操作として `destructive` スタイルにする。
文面は現行の「この挑戦は終了します。やり直しはできません。」を流用する。

```ts
const confirmGiveUp = useCallback(() => {
  Alert.alert('ギブアップしますか？', 'この挑戦は終了します。やり直しはできません。', [
    { text: 'やめる', style: 'cancel' },
    {
      text: 'ギブアップする',
      style: 'destructive',
      onPress: () =>
        surrender.mutate(undefined, {
          onSuccess: () => router.replace(resultHref(gameId)),
        }),
    },
  ])
}, [gameId, router, surrender])
```

- [ ] **Step 4: 戻る動線を整える**

ゲーム中に戻ると進行中の挑戦がどうなるかが分かるようにする。
**ロビーに戻っても挑戦は残る**（サーバー側で `playing` のまま）ので、
それが伝わる文言にする。破棄されるかのような表現にしないこと。

- [ ] **Step 5: 結果画面から図鑑への動線を有効にする**

`play/result/[id].tsx:6` のコメントに「図鑑で見る（未実装なので無効）」とある。
図鑑プラン（`2026-09-17-collection-trajectory.md`）の Task 4 で有効化するので、
**ここではボタンの配置だけ整え、遷移先の実装はそちらに任せる**。

- [ ] **Step 6: 全画面の遷移を通しで確認する**

Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
ロビー → デイリー → ヒント → 混ぜる → クリア → 結果 → 戻る、を通す。
Expected: どの画面でも「戻る」が期待どおりの場所に戻ること

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src
git commit -m "fix(mobile): ゲーム画面の動線を iOS の作法に直す"
```

---

### Task 4: 「混ぜた瞬間」と「クリア」の演出を厚くする

トーンの決定は「静かな土台＋演出で爆発」。土台を静かにした分、ここで落差を作る。

**Files:**
- Modify: `apps/mobile/src/components/MixOverlay.tsx`
- Modify: `apps/mobile/src/app/(tabs)/play/result/[id].tsx`

**Interfaces:**
- Consumes: `feedback`（既存のハプティクス／SE 対応表）、`TierBackground`（既存）
- Produces: なし

- [ ] **Step 1: 現行の演出を読む**

Run: `cat apps/mobile/src/components/MixOverlay.tsx`
既存のタイミング（演出 600ms）と、`withSequence` を避けている理由のコメントを把握する。
**このタイミングは体感 1 秒以内の根拠になっているので、大きく伸ばさないこと。**

- [ ] **Step 2: 混合の演出を厚くする**

- 結果が `tier` を上げたときは、背景の温度変化を**はっきり見せる**
- ランクが大きく縮んだときほど強い演出にする（`RankMeter` の差分を使う）
- ハプティクスは既存の対応表のまま。**強度だけ演出に合わせる**

- [ ] **Step 3: クリアの演出を作る**

結果画面に入った瞬間を山場にする。tier が `gold` に到達しているので、
`TierBackground` の gold を活かす。完全錬成（`perfect`）はさらに別格に扱う。

**やらないこと**: 紙吹雪のような汎用的な既製感のある演出。
この作品は「意味空間を歩いてゴールに着く」ゲームなので、
**軌跡が繋がる**ことを見せる演出にする（図鑑の経路描画と視覚的に揃える）。

- [ ] **Step 4: 通しで見る**

Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
Expected: 混合の体感が 1 秒以内に収まっていること（SPEC の展示可能条件）

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): 混合とクリアの演出を厚くする"
```

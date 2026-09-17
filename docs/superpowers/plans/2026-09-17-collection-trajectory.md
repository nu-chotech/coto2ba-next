# 図鑑「自分の軌跡」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「ただの点群で何を見ればいいか分からない」図鑑を、**自分がどう意味空間を歩いたか**が一目で伝わる画面にする。

**Architecture:** 主役を「点群」から「経路」に入れ替える。ゴースト点は背景に降格し、`start → 各手 → goal` の折れ線を光らせる。開いた瞬間に経路が画面に収まるようカメラを自動フレーミングし、上部は検索ではなく経路の切り替えを既定にする。フレーミングの算術は純粋関数に切り出してテストする。

**Tech Stack:** @shopify/react-native-skia 2.6, Reanimated 4.5, react-native-gesture-handler 2.32, TanStack Query

**Spec:** `docs/superpowers/specs/2026-09-17-exhibition-ux-overhaul-design.md` §7

## Global Constraints

- Expo Go で動くこと。新しいネイティブモジュールを追加しない
- **サーバーが空でも落ちないこと**（既存の設計方針。`GET /api/collection` が失敗しても画面は出る）
- 図鑑は宇宙なので、ライトモードでも**暗い背景を維持する**（意図的な例外）
- 定数は `apps/mobile/src/features/collection/constants.ts` に置く。マジックナンバー禁止
- **前提**: `2026-09-17-critical-fixes.md` の Task 2（本番 Neon への `pos3` バックフィル）が
  完了していること。未完了だと所持語の座標が全部 null で、この画面は検証できない
- TypeScript strict、Biome、`pnpm lint` / `pnpm typecheck` / `pnpm test` が緑であること

---

### Task 1: 経路のフレーミング計算を純粋関数にする

「開いた瞬間に経路が画面に収まる」を実現する算術。worklet から呼ぶがテスト可能にする。

**Files:**
- Create: `apps/mobile/src/features/collection/framing.ts`
- Test: `apps/mobile/tests/collection-framing.test.ts`

**Interfaces:**
- Consumes: なし（純粋な数値計算）
- Produces:
  - `boundingSphere(points: readonly (readonly [number, number, number])[]): { center: [number, number, number]; radius: number }`
  - `framingDistance(radius: number, fovRad: number, margin: number): number`
  - `yawPitchToFace(center: readonly [number, number, number], points: …): { yaw: number; pitch: number }`
    — 経路が最も広く見える向きを返す

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { boundingSphere, framingDistance, yawPitchToFace } from '../src/features/collection/framing'

type P = readonly [number, number, number]

describe('boundingSphere', () => {
  it('1 点なら半径 0 でその点が中心', () => {
    const s = boundingSphere([[1, 2, 3]])
    expect(s.center).toEqual([1, 2, 3])
    expect(s.radius).toBeCloseTo(0, 6)
  })

  it('全部の点を含む', () => {
    const points: P[] = [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]
    const s = boundingSphere(points)
    for (const p of points) {
      const d = Math.hypot(p[0] - s.center[0], p[1] - s.center[1], p[2] - s.center[2])
      expect(d).toBeLessThanOrEqual(s.radius + 1e-6)
    }
  })

  it('空配列は原点・半径 0（落ちないこと）', () => {
    const s = boundingSphere([])
    expect(s.center).toEqual([0, 0, 0])
    expect(s.radius).toBe(0)
  })
})

describe('framingDistance', () => {
  it('半径が大きいほど離れる', () => {
    const fov = Math.PI / 3
    expect(framingDistance(2, fov, 1.2)).toBeGreaterThan(framingDistance(1, fov, 1.2))
  })

  it('余白が大きいほど離れる', () => {
    const fov = Math.PI / 3
    expect(framingDistance(1, fov, 1.5)).toBeGreaterThan(framingDistance(1, fov, 1.0))
  })

  // 半径 0（1 点だけの経路）でも 0 距離にならないこと。カメラがめり込む。
  it('半径 0 でも正の距離を返す', () => {
    expect(framingDistance(0, Math.PI / 3, 1.2)).toBeGreaterThan(0)
  })
})

describe('yawPitchToFace', () => {
  it('有限の角度を返す', () => {
    const points: P[] = [
      [0, 0, 0],
      [1, 1, 1],
      [2, 0, 1],
    ]
    const { yaw, pitch } = yawPitchToFace(boundingSphere(points).center, points)
    expect(Number.isFinite(yaw)).toBe(true)
    expect(Number.isFinite(pitch)).toBe(true)
  })

  it('同じ入力なら同じ向き（決定論）', () => {
    const points: P[] = [
      [0, 0, 0],
      [1, 1, 1],
    ]
    const c = boundingSphere(points).center
    expect(yawPitchToFace(c, points)).toEqual(yawPitchToFace(c, points))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coto2ba/mobile test collection-framing`
Expected: FAIL

- [ ] **Step 3: 実装する**

- `boundingSphere`: 軸並行境界箱の中心を取り、そこからの最大距離を半径にする
  （厳密な最小包含球でなくてよい。**単純で決定論的であることを優先する**）
- `framingDistance`: `radius / Math.tan(fov / 2) * margin`。
  `radius` が 0 のときは定数の最小距離（`constants.ts` に置く）を返す
- `yawPitchToFace`: 点群の主要な広がりの方向に対して**直交する**向きを返す。
  共分散行列の固有ベクトルまでやらず、**最も離れた 2 点を結ぶ軸に直交する向き**でよい。
  同点は添字の小さいほうを採る（決定論のため）

すべて `'worklet'` 付きで書く。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coto2ba/mobile test collection-framing`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/collection/framing.ts apps/mobile/tests/collection-framing.test.ts
git commit -m "feat(mobile): 図鑑の経路フレーミング計算と単体テスト"
```

---

### Task 2: 経路を主役にして描く

**Files:**
- Modify: `apps/mobile/src/features/collection/SpaceCanvas.tsx`
- Modify: `apps/mobile/src/features/collection/scene.ts`
- Modify: `apps/mobile/src/features/collection/constants.ts`

**Interfaces:**
- Consumes: `buildSpaceScene`（既存）、`framing`（Task 1）
- Produces: `SpaceScene` に `activePathIndex: number | null` が増える

- [ ] **Step 1: 現行の描画順を読む**

Run: `sed -n '200,300p' apps/mobile/src/features/collection/SpaceCanvas.tsx`
`scene.ts` の並び順は「所持語 → ゴール → ゴースト」。経路は `SpaceCanvas.tsx:242` 付近。

- [ ] **Step 2: ゴースト点を背景に降格する**

- 点を小さく、不透明度を下げる（値は `constants.ts` に定数として置く）
- **選択中の経路が無いときだけ**ゴーストを今より少し強く出す
  （何も無い画面にしないため）

- [ ] **Step 3: 経路を主役として描く**

- `start → 各手の結果 → goal` を**太めの折れ線**で描き、発光させる
- 節（各手）に点を打ち、**順番が分かるように**手数を添える
- 経路上の語は tier 色で塗る（初遭遇時の tier。既存の `first_tier` を使う）
- 選択中でない経路は淡く描く

**やらないこと**: 汎用的なパーティクル演出。この作品の見せ場は
「意味空間を歩いた軌跡」そのものなので、**線が繋がることを見せる**。

- [ ] **Step 4: 結果画面の演出と視覚を揃える**

`mix-wheel-and-flow` プランの Task 4 でクリア演出を「軌跡が繋がる」表現にしている。
**同じ線の描き方・同じ色**を使うこと（定数を共有する）。

- [ ] **Step 5: Web プレビューで確認する**

Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
Expected: 開いた瞬間に「線」が目に入ること。点群が主役に見えたら失敗

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/collection
git commit -m "feat(mobile): 図鑑の主役を点群から経路に入れ替える"
```

---

### Task 3: 上部を経路の切り替えにし、操作を軽くする

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/space/index.tsx`
- Modify: `apps/mobile/src/features/collection/camera.ts`

**Interfaces:**
- Consumes: `framing`（Task 1）、`useCollectionQuery`（既存）
- Produces: なし

- [ ] **Step 1: 上部を経路セレクタにする**

現行は `TextInput`（検索）が既定で最上部にある（`space/index.tsx:152`）。
これを**経路の切り替え**に置き換える:

- 「今日」と、過去のクリア済みゲームを新しい順に並べたセグメント／チップ
- 経路が 1 つも無いときだけ、現行の案内（「まだ語に出会っていません」）を出す
- **検索は残す**が、副次的な位置（上部のアイコン → シート）に移す

- [ ] **Step 2: 開いたときに自動フレーミングする**

選択中の経路の点から `boundingSphere` → `framingDistance` → `yawPitchToFace` を求め、
カメラをそこへ `withTiming` で寄せる。**初回表示は即座にその位置から始める**
（アニメーションで寄せると「放り出された」印象が残る）。

- [ ] **Step 3: 迷子にならないよう自由度を絞る**

`camera.ts` に:
- ピッチの上下限を設ける（真上・真下を向いて方向感覚を失わないように）
- 距離の上下限を設ける
- **二本指タップで選択中の経路へ戻る**（`reset()` を経路中心に戻す形に変える）

現行の `reset` ボタンは残し、常に見える位置に置く。

- [ ] **Step 4: 語のシートは現行どおり**

タップで `WordSheet` が出る挙動は維持する。説明文が無い語の文言も現行どおり。

- [ ] **Step 5: Web プレビューで確認する**

Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
経路を切り替える → 自動で収まる → 回す → 二本指タップで戻る
Expected: 迷子にならないこと

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): 図鑑を経路の切り替え中心にして操作を軽くする"
```

---

### Task 4: 結果画面から図鑑へ直接飛ばす

`play/result/[id].tsx:6` のコメントに「図鑑で見る（未実装なので無効）」とある。有効化する。

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/play/result/[id].tsx`
- Modify: `apps/mobile/src/app/(tabs)/space/index.tsx`
- Modify: `apps/mobile/src/features/game/routes.ts`

**Interfaces:**
- Consumes: expo-router の型付きルート
- Produces: `spaceHref(gameId: string): Href` — `features/game/routes.ts` に既存の
  `resultHref` と同じ作法で置く

- [ ] **Step 1: ルートにクエリを足す**

図鑑タブが `?game=<id>` を受け取り、その経路を選択状態で開くようにする。
`experiments.typedRoutes` が有効なので、**型が通る形で**書くこと。

- [ ] **Step 2: 結果画面のボタンを有効にする**

「この軌跡を見る」で `spaceHref(gameId)` に飛ぶ。
**タブ間の遷移になる**ので、戻ったときに結果画面が残っていること（タブのスタックを壊さない）。

- [ ] **Step 3: 通しで確認する**

Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
クリア → 結果 → この軌跡を見る → 図鑑がその経路にフォーカスして開く → 戻る
Expected: 結果画面に戻れること

- [ ] **Step 4: 該当コメントを直す**

`play/result/[id].tsx:6` の「図鑑で見る（未実装なので無効）」を実態に合わせて書き換える。

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): 結果画面から図鑑の該当経路へ直接飛ばす"
```

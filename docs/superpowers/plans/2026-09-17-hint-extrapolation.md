# ヒントの外挿化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「ヒントの語を使っても順位が上がらない」を解消し、**実際に順位が上がる語と、その混ぜ方（比率）** を提案するヒントにする。

**Architecture:** 現行は `0.8·v_current + 0.2·v_goal` の近傍（内挿）を返しており、
それを混ぜても結果が現在からほとんど動かないという構造的欠陥がある。
ゴールに着地させる入力語は外挿 `v_W*(r) = (v_goal − (1−r)·v_current) / r` の方向にあるので、
比率ごとに外挿点の近傍を集め、実際の混合をシミュレートして「ゴールに近づくもの」だけを残す。
ヒントの契約を `string[]` から `{ word, ratio }[]` に変える。

**Tech Stack:** TypeScript, Hono, Drizzle, pgvector (HNSW + 厳密全走査), Zod 4, vitest

**Spec:** `docs/superpowers/specs/2026-09-17-exhibition-ux-overhaul-design.md` §3.3

## Global Constraints

- ルール判定はサーバー。クライアントの値を信用しない
- 定数は `packages/contracts/src/constants.ts` に一元化。マジックナンバー禁止
- `ratio` は `RATIOS` の 8 段階のみ。丸めない（サーバーは厳密一致で検証している）
- ランクは HNSW を使わず厳密全走査（近似だとスコアが再現せずランキングが壊れる）
- `hint_cache` は `(goal, current)` で決定論的にキャッシュされる。**出力が決定論的であること**
- 既存の表記揺れ除外（`isMorphologicalVariant`）と登場済み語の除外を維持する
- TypeScript strict、Biome、`pnpm lint` / `pnpm typecheck` / `pnpm test` が緑であること

---

### Task 1: 外挿ターゲットの算術を純粋関数として実装する

**Files:**
- Create: `apps/api/src/services/hint-target.ts`
- Test: `apps/api/tests/hint-target.test.ts`

**Interfaces:**
- Consumes: なし（純粋な数値計算のみ。DB に触らない）
- Produces:
  - `extrapolationTarget(current: Float32Array, goal: Float32Array, ratio: number): Float32Array`
    — 正規化済みの `v_W*(r)`
  - `blendCosineToGoal(current: Float32Array, candidate: Float32Array, goal: Float32Array, ratio: number): number`
    — その比率で混ぜた点とゴールの余弦類似度
  - `bestRatioForCandidate(current, candidate, goal, ratios: readonly number[]): { ratio: number; cosine: number }`
    — 候補語に対する最良の比率と、その時の類似度

- [ ] **Step 1: Write the failing test**

`apps/api/tests/hint-target.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  bestRatioForCandidate,
  blendCosineToGoal,
  extrapolationTarget,
} from '../src/services/hint-target'

const vec = (...xs: number[]) => Float32Array.from(xs)
const cos = (a: Float32Array, b: Float32Array) => {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

describe('extrapolationTarget', () => {
  // これが本命の性質。外挿点そのものを ratio で混ぜると、ゴールに戻ってくる。
  it('外挿点を同じ比率で混ぜるとゴールに一致する', () => {
    const current = vec(1, 0, 0)
    const goal = vec(0, 1, 0)
    for (const ratio of [0.2, 0.5, 0.8]) {
      const target = extrapolationTarget(current, goal, ratio)
      expect(blendCosineToGoal(current, target, goal, ratio)).toBeCloseTo(1, 5)
    }
  })

  // 内挿（現在とゴールの中間）を混ぜても、ゴールには全く届かない。
  // これが「ヒントが効かない」の正体なので、対比をテストで固定する。
  it('内挿点より外挿点のほうがゴールに近づく', () => {
    const current = vec(1, 0, 0)
    const goal = vec(0, 1, 0)
    const ratio = 0.4
    const interpolated = vec(0.8, 0.2, 0)
    const target = extrapolationTarget(current, goal, ratio)
    expect(blendCosineToGoal(current, target, goal, ratio)).toBeGreaterThan(
      blendCosineToGoal(current, interpolated, goal, ratio),
    )
  })

  it('単位ベクトルを返す', () => {
    const target = extrapolationTarget(vec(1, 0, 0), vec(0, 1, 0), 0.5)
    expect(cos(target, target)).toBeCloseTo(1, 6)
  })

  it('ratio が 0 なら投げる（0 除算になるため）', () => {
    expect(() => extrapolationTarget(vec(1, 0, 0), vec(0, 1, 0), 0)).toThrow(RangeError)
  })
})

describe('bestRatioForCandidate', () => {
  it('候補に対して最良の比率を選ぶ', () => {
    const current = vec(1, 0, 0)
    const goal = vec(0, 1, 0)
    const candidate = vec(0, 1, 0) // ゴールそのもの
    const best = bestRatioForCandidate(current, candidate, goal, [0.1, 0.5, 0.8])
    // ゴールそのものを混ぜるなら、比率が大きいほどゴールに近い
    expect(best.ratio).toBe(0.8)
    expect(best.cosine).toBeGreaterThan(0.9)
  })

  it('候補が空の比率配列なら投げる', () => {
    expect(() => bestRatioForCandidate(vec(1, 0, 0), vec(0, 1, 0), vec(0, 1, 0), [])).toThrow(
      RangeError,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coto2ba/api test hint-target`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`apps/api/src/services/hint-target.ts` を作る。仕様:

- `extrapolationTarget`: `t[i] = (goal[i] − (1 − ratio) * current[i]) / ratio` を計算し、**L2 正規化して返す**。
  `ratio <= 0` または `ratio > 1` なら `RangeError`。長さ不一致なら `TypeError`
- `blendCosineToGoal`: `blend[i] = (1 − ratio) * current[i] + ratio * candidate[i]` を作り、`goal` との余弦を返す
- `bestRatioForCandidate`: `ratios` を走査して `blendCosineToGoal` が最大のものを返す。
  同値なら**小さい比率を優先**する（決定論のため）。`ratios` が空なら `RangeError`

既存の `vector.ts` に `blend` があるならそれを再利用し、無ければこのファイルに閉じる。
**新しい数値ユーティリティを二重に作らないこと。**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coto2ba/api test hint-target`
Expected: PASS（6 件すべて）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/hint-target.ts apps/api/tests/hint-target.test.ts
git commit -m "feat(api): ヒントの外挿ターゲットを計算する純粋関数"
```

---

### Task 2: ヒントの契約を `{ word, ratio }` に変える

**Files:**
- Modify: `packages/contracts/src/schemas.ts`（`hintResponseSchema`）
- Modify: `packages/contracts/src/constants.ts`（候補数などの定数）
- Test: `packages/contracts/tests/schemas.test.ts`

**Interfaces:**
- Consumes: `ratioSchema`（既存。8 段階の厳密一致）
- Produces:
  - `hintSchema = z.object({ word: wordSchema, ratio: ratioSchema })`
  - `hintResponseSchema = z.object({ hints: z.array(hintSchema), hint_count: z.number().int().nonnegative() })`
  - `type Hint = z.infer<typeof hintSchema>`

- [ ] **Step 1: Write the failing test**

```ts
describe('hintResponseSchema', () => {
  it('語と比率の組を受け付ける', () => {
    const parsed = hintResponseSchema.safeParse({
      hints: [{ word: '琥珀', ratio: 0.4 }],
      hint_count: 1,
    })
    expect(parsed.success).toBe(true)
  })

  // ヒントが提案する比率も 8 段階でなければ、そのまま打てない。
  it('8 段階にない比率は弾く', () => {
    expect(
      hintResponseSchema.safeParse({ hints: [{ word: '琥珀', ratio: 0.35 }], hint_count: 1 })
        .success,
    ).toBe(false)
  })

  it('語だけの旧形式は弾く', () => {
    expect(hintResponseSchema.safeParse({ hints: ['琥珀'], hint_count: 1 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coto2ba/contracts test`
Expected: FAIL

- [ ] **Step 3: スキーマを変更し、必要な定数を足す**

`constants.ts` に追加する（マジックナンバー禁止のため）:

```ts
/** 外挿点ごとに HNSW で集める近傍数。 */
export const HINT_EXTRAPOLATION_NEIGHBORS = 24
/** 実際の混合まで走らせて検証する最終候補数。 */
export const HINT_VERIFY_LIMIT = 16
```

既存の `HINT_COUNT = 6` / `HINT_RATIO` は残す（`HINT_RATIO` は使わなくなるので削除してよい。
削除する場合は参照箇所をすべて消すこと）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coto2ba/contracts test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): ヒントを語と比率の組にする"
```

---

### Task 3: 外挿ベースのヒント生成に差し替える

**Files:**
- Modify: `apps/api/src/services/vector.ts`（`hintWords` を置き換える）
- Modify: `apps/api/src/services/game.ts:439-500`（`openHints`）
- Modify: `apps/api/src/db/schema.ts`（`hint_cache.hints` の型が変わる）
- Create: マイグレーション（`apps/api/drizzle`）
- Test: `apps/api/tests/vector.test.ts`

**Interfaces:**
- Consumes: `extrapolationTarget` / `bestRatioForCandidate`（Task 1）、`hintSchema`（Task 2）、
  **`mixCandidateMetrics`（`apps/api/src/services/vector.ts`。main の比較ハーネスで追加済み。
  候補の blend 類似度とゴール類似度をまとめて取る）**。同じ計算を書き直さないこと
- Produces: `hintCandidates(db, goal, current, exclude, limit): Promise<Hint[]>`

- [ ] **Step 1: `hint_cache` のマイグレーションを作る**

`hints` が `text[]` なら `jsonb` に変える必要がある。**既存のキャッシュは捨てる**
（形式が変わるので再計算させるのが正しい）。`drizzle-kit generate` でマイグレーションを作り、
中身を確認してから適用する。`TRUNCATE hint_cache` を含めること。

- [ ] **Step 2: Write the failing test**

`apps/api/tests/vector.test.ts` に追記する（DB が必要なので、既存のスキップ機構に乗せる）。

```ts
describe('hintCandidates', () => {
  it('提案どおりに混ぜるとゴールに近づく', async () => {
    const goal = '温泉'
    const current = await someStartWord() // 既存のヘルパに合わせる
    const hints = await hintCandidates(db, goal, current, [], HINT_COUNT)

    expect(hints.length).toBeGreaterThan(0)
    const before = await similarityToGoal(db, current, goal)
    for (const hint of hints) {
      const result = await mixResult(db, current, hint.word, hint.ratio)
      const after = await similarityToGoal(db, result, goal)
      // ヒントは「順位が上がる手」でなければ意味がない。これが契約。
      expect(after).toBeGreaterThan(before)
    }
  })

  it('比率は 8 段階のいずれか', async () => {
    const hints = await hintCandidates(db, '温泉', await someStartWord(), [], HINT_COUNT)
    for (const hint of hints) expect(RATIOS).toContain(hint.ratio)
  })

  it('除外語を返さない', async () => {
    const current = await someStartWord()
    const hints = await hintCandidates(db, '温泉', current, ['温泉', current], HINT_COUNT)
    for (const hint of hints) expect(['温泉', current]).not.toContain(hint.word)
  })

  it('同じ入力なら同じ結果（キャッシュが決定論であるため）', async () => {
    const current = await someStartWord()
    const a = await hintCandidates(db, '温泉', current, [], HINT_COUNT)
    const b = await hintCandidates(db, '温泉', current, [], HINT_COUNT)
    expect(a).toEqual(b)
  })
})
```

`similarityToGoal` / `mixResult` は既存の `vector.ts` の関数を使うこと。
無ければテスト用のヘルパとして `apps/api/tests/` に置く（本番コードに増やさない）。

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @coto2ba/api test vector`
Expected: FAIL

- [ ] **Step 4: `hintCandidates` を実装する**

アルゴリズム:

1. `current` と `goal` のベクトルを取る
2. `RATIOS` の各比率について `extrapolationTarget(current, goal, ratio)` を作り、
   HNSW で近傍 `HINT_EXTRAPOLATION_NEIGHBORS` 件を引く（**1 本の SQL にまとめる**。
   比率ごとに往復すると 8 往復になる）
3. 和集合から除外語を落とし、各候補のベクトルを 1 回のクエリで取得する
4. 各候補に `bestRatioForCandidate` を適用し、類似度の降順に並べて上位 `HINT_VERIFY_LIMIT` 件に絞る
5. その 16 件について**実際の混合**（`(1−r)·current + r·candidate` の最近傍を HNSW で引く）を走らせ、
   結果語のゴール類似度が **`current` のゴール類似度より高いものだけ残す**
6. 表記揺れ（`isMorphologicalVariant`）で `current` / `goal` / 既に採用した語と被るものを落とす
7. 先頭 `HINT_COUNT` 件を返す。**並びは (類似度降順, 語の昇順) で決定論にする**

足りない場合の埋め合わせ: 現行と同じく検証を通らなかった候補で埋めるのではなく、
**件数が減ることを許す**。効かないヒントを混ぜると元の問題に戻るため。
0 件になった場合のみ、ゴールの近傍（禁止語を除く）を最後の手段として 1 件返す。

- [ ] **Step 5: `openHints` を差し替える**

`apps/api/src/services/game.ts` の `openHints` から `hintWords` の呼び出しを
`hintCandidates` に置き換える。表記揺れ除外は `hintCandidates` の内部に移したので、
`openHints` 側の重複したフィルタは削除する。`hint_cache` への保存も新形式にする。

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @coto2ba/api test`
Expected: PASS（既存 70 件も含めて緑）

- [ ] **Step 7: Commit**

```bash
git add apps/api packages/contracts
git commit -m "feat(api): ヒントを外挿ベースにして、実際に順位が上がる語を返す"
```

---

### Task 4: 改善率をベンチマークで固定する

「効くようになった」を体感ではなく数値で担保する。

**Files:**
- Create: `apps/api/tests/hint-benchmark.test.ts`

**Interfaces:**
- Consumes: `hintCandidates`（Task 3）
- Produces: なし（検証のみ）

- [ ] **Step 1: ベンチマークを書く**

`goal_pool` から 100 局面を**決定論的に**抽出し（`ORDER BY word LIMIT 100` のように
乱数を使わない）、各局面で以下を測る:

- ヒント 1 位を提案どおりの比率で適用したときの **rank 改善率**（改善した局面の割合）
- rank の改善幅の中央値

```ts
it('ヒント 1 位に従うと 9 割以上の局面で順位が上がる', async () => {
  const cases = await sampleSituations(db, 100)
  let improved = 0
  for (const { current, goal } of cases) {
    const [hint] = await hintCandidates(db, goal, current, [], 1)
    if (!hint) continue
    const before = await rankOf(db, current, goal)
    const result = await mixResult(db, current, hint.word, hint.ratio)
    const after = await rankOf(db, result, goal)
    if (after < before) improved++
  }
  // 現行実装はここが極端に低い。改善の証拠として閾値で固定する。
  expect(improved / cases.length).toBeGreaterThanOrEqual(0.9)
})
```

このテストは DB が要るので既存のスキップ機構に乗せる（CI で落ちないこと）。
実行時間が長い場合は `describe.concurrent` を使わず、**逐次で回して計測時間をログに出す**。

- [ ] **Step 2: 現行実装に対して走らせ、ベースラインを記録する**

Task 3 の実装前のコミットに一時的に戻して測るか、旧 `hintWords` を
テスト内で直接呼んで測る。**改善前後の数値を両方コミットメッセージに残す。**

- [ ] **Step 3: 新実装で走らせる**

Run: `pnpm --filter @coto2ba/api test hint-benchmark`
Expected: PASS（改善率 90% 以上）

閾値に届かない場合は**閾値を下げずにアルゴリズムを見直す**。
`HINT_EXTRAPOLATION_NEIGHBORS` と `HINT_VERIFY_LIMIT` を増やすのが最初の一手。

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests/hint-benchmark.test.ts
git commit -m "test(api): ヒントの順位改善率をベンチマークで固定する"
```

---

### Task 5: モバイルをヒントの新契約に追従させる

**Files:**
- Modify: `apps/mobile/src/components/HintSheet.tsx`
- Modify: `apps/mobile/src/app/(tabs)/play/game/[id].tsx:174-181`（`pickHint`）
- Modify: `apps/mobile/src/features/game/queries.ts`（型の追従）

**Interfaces:**
- Consumes: `Hint`（Task 2 の `{ word, ratio }`）
- Produces: ヒントを選ぶと**語と比率の両方**が入力に載る

- [ ] **Step 1: `HintSheet` を新契約にする**

各ヒントに語と「どの比率で混ぜるか」を併記する。比率は生の数値ではなく
**混ぜ具合として読める表示**にする（例: `0.4` を「4 : 6」のように、
既存の `MixSlider`／`MixWheel` のラベル規則に合わせる。表記は 1 箇所に集約すること）。

- [ ] **Step 2: `pickHint` が比率も反映するようにする**

```ts
const pickHint = useCallback(
  (hint: Hint) => {
    inputRef.current?.setWord(hint.word)
    setRatio(hint.ratio) // ヒントは混ぜ方まで含めて 1 つの提案なので、比率も一緒に載せる
    setInputError(null)
    setHintOpen(false)
  },
  [setHintOpen, setRatio],
)
```

`setRatio` はゲーム画面が既に持っている ratio の state に合わせること。

- [ ] **Step 3: 型を通す**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Web プレビューで動作を確認する**

Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
ヒントを開く → 1 つ選ぶ → 語と比率が入力に載る → 混ぜる → **順位が上がる**
Expected: 上がること。上がらなければ Task 3 に戻る

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): ヒントが提案する比率まで入力に反映する"
```

# 重大バグ修正と URL 統一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 実機で確認された 2 つの不具合（設定画面のエラー / 図鑑に自分の語が出ない）を直し、独自ドメインへの URL 参照を一元化する。

**Architecture:** 3 つの独立した修正。Zod スキーマの 1 行修正＋契約テスト、本番 Neon への `pos3` バックフィル（容量制約があるためバッチ＋VACUUM）、URL 定数の一元化。互いに依存しない。

**Tech Stack:** TypeScript, Zod 4, Drizzle, Neon Postgres (pgvector), vitest, Expo

**Spec:** `docs/superpowers/specs/2026-09-17-exhibition-ux-overhaul-design.md`

## Global Constraints

- Expo Go で動くこと。Expo Go 非同梱のネイティブモジュールを追加しない
- ゲームのルール判定はサーバー（`apps/api/src/services/game.ts`）。クライアントの値を信用しない
- 定数は `packages/contracts/src/constants.ts` に一元化。マジックナンバー禁止
- TypeScript strict、Biome、`pnpm lint` / `pnpm typecheck` / `pnpm test` が緑であること
- 本番 Neon のストレージは 512MB 中 318MB 使用済み。大量更新は容量を監視しながら行う
- 独自ドメイン: ランディング `https://coto2ba-next.chotech.dev`、API `https://coto2ba-next-api.chotech.dev`（両方とも稼働確認済み）

---

### Task 1: `/api/me` のレスポンス検証を直す

Zod 4 の `z.record(enumSchema, valueSchema)` は列挙キーの網羅を要求する（Zod 3 からの破壊的変更）。
`best_free_moves` は通常 `{}` なので `/api/me` のレスポンスが毎回検証に落ち、
モバイルの mutation が「サーバーの応答を解釈できません」を出していた。

**Files:**
- Modify: `packages/contracts/src/schemas.ts:53`
- Test: `packages/contracts/tests/schemas.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `meResponseSchema` が `best_free_moves` の部分的な記録を受け付けるようになる。
  型は `Partial<Record<Difficulty, number>>` になる

- [ ] **Step 1: Write the failing test**

`packages/contracts/tests/schemas.test.ts` に追記する。

```ts
describe('meResponseSchema の best_free_moves', () => {
  const base = {
    id: 'u1',
    display_name: '静かな蚕',
    booth: false,
    stats: {
      games_played: 0,
      games_cleared: 0,
      daily_streak: 0,
      words_met: 0,
      perfect_count: 0,
    },
  }

  // 新規ユーザーは必ずこの形。ここが落ちると設定画面が全部エラーになる。
  it('空オブジェクトを受け付ける', () => {
    expect(meResponseSchema.safeParse({ ...base, best_free_moves: {} }).success).toBe(true)
  })

  it('一部の難易度だけでも受け付ける', () => {
    expect(
      meResponseSchema.safeParse({ ...base, best_free_moves: { easy: 3 } }).success,
    ).toBe(true)
  })

  it('全難易度が揃っていても受け付ける', () => {
    expect(
      meResponseSchema.safeParse({
        ...base,
        best_free_moves: { easy: 3, normal: 5, hard: 9 },
      }).success,
    ).toBe(true)
  })

  it('知らない難易度キーは弾く', () => {
    expect(
      meResponseSchema.safeParse({ ...base, best_free_moves: { lunatic: 3 } }).success,
    ).toBe(false)
  })

  it('手数が 0 以下なら弾く', () => {
    expect(
      meResponseSchema.safeParse({ ...base, best_free_moves: { easy: 0 } }).success,
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coto2ba/contracts test`
Expected: 「空オブジェクトを受け付ける」と「一部の難易度だけでも受け付ける」が FAIL

- [ ] **Step 3: Write minimal implementation**

`packages/contracts/src/schemas.ts:53` を書き換える。

```ts
  // Zod 4 の z.record(enum, …) は **列挙キーの網羅を要求する**。
  // best_free_moves は新規ユーザーだと {} なので、partialRecord でないと
  // /api/me のレスポンスが常に検証に落ちる（実際に起きた）。
  best_free_moves: z.partialRecord(difficultySchema, z.number().int().positive()),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coto2ba/contracts test`
Expected: PASS（5 件すべて）

- [ ] **Step 5: 型の追従を確認する**

Run: `pnpm typecheck`
Expected: PASS。`MeResponse['best_free_moves']` が `Partial<…>` になるため、
`apps/mobile` 側で添字アクセスしている箇所が `undefined` を考慮していないと型エラーになる。
出たら `?? null` などで**明示的に未設定を扱う**（`as` でのキャストで黙らせないこと）。

- [ ] **Step 6: 本番に対して回帰を確認する**

Run:
```bash
API=https://coto2ba-next-api.chotech.dev
TOK=$(curl -s -X POST "$API/api/devices" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s -X PATCH -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"booth":true}' "$API/api/me"
```
Expected: `best_free_moves` が `{}` の JSON が返る（このレスポンスが新しいスキーマを通ること）

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/schemas.ts packages/contracts/tests/schemas.test.ts
git commit -m "fix(contracts): best_free_moves が空だと /api/me の検証に落ちるのを直す"
```

---

### Task 2: 本番 Neon に `pos3` をバックフィルする

本番の `vocab.pos3` は 102,520 語すべて NULL で、ローカル DB には計算済みの値がある。
`pos3` が無い語は図鑑のシーンから除外されるため、クリアしても
「まだ語に出会っていません」が出続ける。

**Files:**
- Create: `tools/pipeline/scripts/12_backfill_pos3.py`
- Modify: `package.json`（`pipeline:backfill-pos3` スクリプトの追加）

**Interfaces:**
- Consumes: ローカル DB（`postgresql://coto2ba@localhost:55432/coto2ba`）の `vocab.word` / `vocab.pos3`
- Produces: 本番 Neon の `vocab.pos3` が埋まる。図鑑が所持語を描けるようになる

- [ ] **Step 1: 現状を記録する**

Run:
```bash
URL=$(grep -m1 '^DATABASE_URL_DIRECT=' apps/api/.env.neon | cut -d= -f2- | tr -d '"')
docker run --rm pgvector/pgvector:pg17 psql "$URL" -c \
  "SELECT count(*) FILTER (WHERE pos3 IS NULL) AS null_count, count(*) AS total
   FROM vocab WHERE is_output;" -c \
  "SELECT pg_size_pretty(pg_database_size(current_database()));"
```
Expected: `null_count = total`、DB サイズは 512MB 未満。**この 2 つの数値を控えること**（後で比較する）

- [ ] **Step 2: バックフィルスクリプトを書く**

`tools/pipeline/scripts/12_backfill_pos3.py` を作る。既存スクリプトの作法
（`_db.py` の接続ヘルパ、`_common.py` のログ）に合わせること。要件:

- ローカル DB から `(word, pos3)` を読み、`pos3 IS NOT NULL` のものだけ対象にする
- 対象 DB（`--target` で渡す接続文字列。既定は `DATABASE_URL_DIRECT`）に対して
  **`--batch-size`（既定 5,000）ごとに UPDATE → COMMIT → `VACUUM vocab`** を回す
- 各バッチの後に `pg_database_size(current_database())` を出力し、
  **`--max-bytes`（既定 480MB）を超えたら中断して残件を報告する**
- 冪等にする。`WHERE v.pos3 IS NULL` で絞るので再実行すれば続きから進む
- `--dry-run` で対象件数だけ出して終了する

UPDATE は一時テーブル経由で行う（1 行ずつの UPDATE は遅すぎる）:

```sql
CREATE TEMP TABLE pos3_batch (word text PRIMARY KEY, pos3 real[]) ON COMMIT DROP;
-- COPY で pos3_batch に流し込む
UPDATE vocab v SET pos3 = b.pos3 FROM pos3_batch b
WHERE v.word = b.word AND v.pos3 IS NULL;
```

- [ ] **Step 3: dry-run で対象件数を確認する**

Run: `pnpm pipeline:backfill-pos3 -- --dry-run`
Expected: 対象がローカルの `pos3 IS NOT NULL` 件数と一致し、書き込みが起きないこと

- [ ] **Step 4: ローカルの複製で通しで試す**

**本番にいきなり流さない。** ローカル DB に検証用データベースを作り、
`vocab` を `pos3` を NULL にした状態で複製して `--target` に指定し、全バッチを通す。
Expected: 完走し、`pos3 IS NULL` が 0 件になる

- [ ] **Step 5: 本番に流す**

Run: `pnpm pipeline:backfill-pos3`
Expected: 完走。各バッチで DB サイズが出力され、480MB を超えない

- [ ] **Step 6: 検証する**

Run:
```bash
URL=$(grep -m1 '^DATABASE_URL_DIRECT=' apps/api/.env.neon | cut -d= -f2- | tr -d '"')
docker run --rm pgvector/pgvector:pg17 psql "$URL" -c \
  "SELECT count(*) FILTER (WHERE pos3 IS NULL) AS still_null FROM vocab WHERE is_output;" -c \
  "SELECT pg_size_pretty(pg_database_size(current_database()));"
```
Expected: `still_null = 0`、DB サイズが 512MB 未満

- [ ] **Step 7: API 経由で図鑑のデータが返ることを確認する**

Run:
```bash
API=https://coto2ba-next-api.chotech.dev
TOK=$(curl -s -X POST "$API/api/devices" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s -H "Authorization: Bearer $TOK" "$API/api/words/温泉" | python3 -m json.tool | head -20
```
Expected: `pos3` が 3 要素の配列で返る（null ではない）

- [ ] **Step 8: Commit**

```bash
git add tools/pipeline/scripts/12_backfill_pos3.py package.json
git commit -m "feat(pipeline): 本番 DB に pos3 をバッチでバックフィルする"
```

---

### Task 3: URL 参照を独自ドメインに一元化する

`constants.ts` は `*.vercel.app`、`landing/index.html` と `features/game/result.ts` は
`chotech.dev` を指していて食い違っている。両ドメインとも稼働確認済み。

**Files:**
- Modify: `packages/contracts/src/constants.ts:214-215`
- Modify: `apps/mobile/app.json`（`extra.apiUrl` / `extra.landingUrl`）
- Test: `packages/contracts/tests/constants.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `API_BASE_URL` / `LANDING_URL` が独自ドメインを指す

- [ ] **Step 1: Write the failing test**

`packages/contracts/tests/constants.test.ts` に追記する。

```ts
describe('公開 URL', () => {
  // 展示で配る QR とシェア文面に載る。vercel.app のままだと恰好がつかない。
  it('独自ドメインを指している', () => {
    expect(API_BASE_URL).toBe('https://coto2ba-next-api.chotech.dev')
    expect(LANDING_URL).toBe('https://coto2ba-next.chotech.dev')
  })

  it('末尾にスラッシュを付けない', () => {
    expect(API_BASE_URL.endsWith('/')).toBe(false)
    expect(LANDING_URL.endsWith('/')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coto2ba/contracts test`
Expected: FAIL（現在は `*.vercel.app`）

- [ ] **Step 3: 定数を書き換える**

```ts
export const API_BASE_URL = 'https://coto2ba-next-api.chotech.dev'
export const LANDING_URL = 'https://coto2ba-next.chotech.dev'
```

- [ ] **Step 4: `app.json` を揃える**

`apps/mobile/app.json` の `extra.apiUrl` を `https://coto2ba-next-api.chotech.dev`、
`extra.landingUrl` を `https://coto2ba-next.chotech.dev` にする。

- [ ] **Step 5: 残っている古い URL を洗い出す**

Run: `grep -rn "vercel.app" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.html" --include="*.md" apps packages docs | grep -v node_modules`
Expected: ドキュメント内の記述以外に残っていないこと。残っていれば直す
（`docs/PROGRESS.md` の記録としての URL は**実態に合わせて更新**する）

- [ ] **Step 6: テストと型を通す**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて PASS

- [ ] **Step 7: 新ドメインで疎通を確認する**

Run: `curl -s https://coto2ba-next-api.chotech.dev/api/health`
Expected: `{"ok":true,…,"region":"sin1"}`

- [ ] **Step 8: サーバー側のオリジン設定を確認する**

`BETTER_AUTH_URL` / `API_ORIGIN` / `LANDING_ORIGIN` が Vercel の環境変数で
新ドメインを指しているか確認する。ズレていれば直し、直した場合は
**認証が通ることを必ず実機かスモークテストで確認する**（Bearer 運用なので
オリジン検証には影響しない想定だが、確認せずに進めないこと）。

Run: `python3 apps/api/tests/smoke.py https://coto2ba-next-api.chotech.dev`
Expected: 20 項目すべて PASS

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/constants.ts packages/contracts/tests/constants.test.ts apps/mobile/app.json
git commit -m "fix: 公開 URL を独自ドメインに一元化する"
```

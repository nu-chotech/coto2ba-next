# 展示運用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** コードが仕上がった後、**実際に会場で動く状態**にする。配布経路、保険、当日のお題、開場前の手順まで。

**Architecture:** コード変更はほぼ無く、配布と運用の作業が中心。実装 7 本がすべて `feat/exhibition-ux` にマージされ、main に入った後に実行する。

**Tech Stack:** EAS Update, Expo Go, Vercel, Neon

**Spec:** `docs/superpowers/specs/2026-09-17-exhibition-ux-overhaul-design.md`

## Global Constraints

- 本番 Neon は 512MB 中およそ 318MB 使用済み。書き込みは容量を見ながら行う
- Neon Free は 5 分無通信でコンピュートが休止し、次のクエリで 1〜4 秒かかる
- Expo SDK 58 の安定版が出ると App Store の Expo Go は 58 に切り替わり、
  **SDK 57 のプロジェクトは開けなくなる**
- 展示形態は「ブース端末 2〜3 台 ＋ 持ち帰り QR」の両方

---

### Task 1: EAS Update に publish して配布経路を作る

**Files:**
- Modify: `apps/landing/index.html`（`data-expo-link`）

- [ ] **Step 1: preview チャンネルに publish する**

```bash
cd apps/mobile
npx eas-cli update --channel preview --message "展示版 v1"
```
出力された URL を控える。

- [ ] **Step 2: 実機で開いて通しプレイする**

iPhone の Expo Go で QR を読み、ロビー → デイリー → ヒント → 混ぜる → クリア →
結果 → 図鑑 → ランキング → 設定 を通す。
**ここで初めて分かる不具合（実機でしか出ないもの）を潰してから production に上げる。**

- [ ] **Step 3: production チャンネルに publish する**

```bash
npx eas-cli update --channel production --message "展示版 v1"
```

- [ ] **Step 4: ランディングのリンクを実 URL にする**

`apps/landing/index.html` の `data-expo-link` を production の URL にする。
デプロイして、**別の端末から QR を読んで実際に起動することを確認する**。

- [ ] **Step 5: Commit**

```bash
git add apps/landing/index.html
git commit -m "chore(landing): EAS Update の production URL を反映する"
```

---

### Task 2: Web 版を保険として置く

持ち帰り QR は**来場者の最新 Expo Go** で開かれる。SDK 58 が切り替わると
持ち帰り導線だけ先に死ぬので、ブラウザで遊べる版を置いておく。

**Files:**
- Modify: `apps/landing/index.html`
- Modify: `.github/workflows/deploy-landing.yml`（必要なら）

- [ ] **Step 1: Web ビルドが通ることを確認する**

```bash
cd apps/mobile && pnpm exec expo export --platform web
```
Expected: 成功。`dist/` が出る

- [ ] **Step 2: 通しプレイする**

`dist/` をローカルで配信して、ロビーからクリアまで通す。
**Skia とガラスがフォールバックに落ちても破綻しないこと**を確認する。

- [ ] **Step 3: 配置先を決めて置く**

ランディングと同じ Vercel プロジェクトのサブパス（`/play`）に置く。
ランディングに「ブラウザで試す」の導線を足す。

- [ ] **Step 4: 本番で開いて確認する**

Expected: ブラウザで最後まで遊べること

- [ ] **Step 5: Commit**

```bash
git add apps/landing .github/workflows
git commit -m "feat(landing): ブラウザで遊べる版を置く（SDK 58 切り替わりの保険）"
```

---

### Task 3: 展示日のお題を決める

**Files:**
- なし（データベースの操作）

- [ ] **Step 1: 展示日を確認する**

`daily_challenges` に展示日の行があるか確認する。

```bash
URL=$(grep -m1 '^DATABASE_URL_DIRECT=' apps/api/.env.neon | cut -d= -f2- | tr -d '"')
docker run --rm pgvector/pgvector:pg17 psql "$URL" -c \
  "SELECT date, goal, start, difficulty FROM daily_challenges
   WHERE date BETWEEN '2026-10-01' AND '2026-10-15' ORDER BY date;"
```

- [ ] **Step 2: 見栄えするお題に差し替える**

展示日は**人が見て面白い語**にする（温泉 / 琥珀 / 羅針盤 / 振り子 のような具体名詞）。
`goal_pool` から difficulty が `easy` 〜 `normal` のものを選ぶ。
**hard は選ばない**（来場者は 1 回しか遊ばないので、クリアできないと印象が悪い）。

差し替えは `daily_challenges` を直接 UPDATE する。

- [ ] **Step 3: 実際に遊んで確かめる**

選んだお題を自分で解いてみて、**5〜8 手でクリアできること**を確認する。

- [ ] **Step 4: 記録する**

`docs/PROGRESS.md` に選んだお題と理由を書く。

---

### Task 4: 語の説明を埋める

本番 Neon は `goal_pool` 685 語のうち **316 語にしか説明が入っていない**。
説明が無いと結果画面と図鑑のシートが寂しい。

- [ ] **Step 1: 現状を確認する**

```bash
URL=$(grep -m1 '^DATABASE_URL_DIRECT=' apps/api/.env.neon | cut -d= -f2- | tr -d '"')
docker run --rm pgvector/pgvector:pg17 psql "$URL" -c \
  "SELECT count(*) FILTER (WHERE description IS NOT NULL) AS filled, count(*) FROM goal_pool;"
```

- [ ] **Step 2: バッチを流す**

`pnpm pipeline:descriptions`（`07_descriptions.py`）を本番に対して流す。
**容量を見ながら**行う。ランタイムの Wikipedia 取得は動いているので、
これは「速くする」ための作業であり、失敗しても展示は成立する。

- [ ] **Step 3: 検証する**

埋まった件数を確認し、いくつかの語の説明を目で読む。
**不適切な説明が混ざっていないこと**を確認する（展示に出る文章なので）。

---

### Task 5: 開場前の手順書を書く

**Files:**
- Create: `docs/BOOTH.md`

- [ ] **Step 1: 手順書を書く**

当日その場で見るための短い手順書。以下を含める:

- **開場 30 分前**: API を 1 回叩いて Neon を起こす
  （`curl https://coto2ba-next-api.chotech.dev/api/health`）。
  5 分無通信で休止するので、**開場直前にもう一度**叩く
- 端末の準備: Expo Go で production チャンネルを開き、**ブースモードを ON** にする
- 端末の設定: 画面の自動ロックを切る、音量、明るさ最大、機内モードにしない
- 通信: 会場 Wi-Fi が不安定ならテザリングに切り替える手順
- **来場者への 30 秒の説明**（読み上げ用の台本）
- トラブル時: 「次の人へ」が効かない / 401 が出る / 画面が固まった、の対処
- 撤収: ランキングのスクリーンショットを撮る

- [ ] **Step 2: 実際にリハーサルする**

手順書だけを見て、端末をゼロから展示可能状態にできるか試す。
**書いていない手順が必要になったら書き足す。**

- [ ] **Step 3: Commit**

```bash
git add docs/BOOTH.md
git commit -m "docs: 当日のブース運用手順"
```

---

### Task 6: 展示 1 週間前の確認（リマインダ）

**この Task は展示の 1 週間前に実行する。** それまでは実行しない。

- [ ] **Step 1: Expo Go のバージョンを確認する**

App Store の Expo Go が **SDK 58 に切り替わっていないか**確認する。
切り替わっていたら、SDK 57 のプロジェクトは開けない。

- [ ] **Step 2: 切り替わっていた場合の対応**

1. Web 版（Task 2）が生きていることを確認し、**そちらを主たる導線にする**
2. ブース端末の Expo Go は**更新しない**（古い Expo Go なら SDK 57 が開ける）
3. 時間があれば SDK 58 に追従する

- [ ] **Step 3: 本番の疎通を確認する**

```bash
python3 apps/api/tests/smoke.py https://coto2ba-next-api.chotech.dev
```
Expected: 全項目 PASS

- [ ] **Step 4: 通しプレイをもう一度行う**

実機で最初から最後まで。**この時点で見つかった不具合は直す時間がある。**

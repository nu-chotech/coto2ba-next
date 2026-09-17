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

### Task 0: Neon を Launch tier に上げる（最優先・コードを1行も書かない）

**2026-09-18 の本番実測で、開場直後の 1 秒の犯人が Neon で確定した。**
`/api/health`（DB に触らない）が 161ms で返る**関数がウォームな状態**で、
最初に DB へ到達するリクエストだけが **1,175ms → 162ms**。
Vercel のコールドスタートではない。

**Vercel Cron では解けない**: Hobby は最小 1 日 1 回・精度 ±59 分。5 分の休止に対しカバー率 0.35%。
**常時 keepalive も不可**: Neon Free の月 100 CU-hours に対し 182.5 CU-hours 必要で、
**月の 16 日目に DB が止まる**。

同時に**容量の問題も消える**。Neon Free は 0.5GB を超えると INSERT/UPDATE だけでなく
**DELETE も失敗する**。現在 318/512MB で、展示当日は `calc_cache`・`games`・`moves`・
`word_encounters` が伸び続ける。**当日踏んだら自力復旧の手段がない。**

- [ ] **Step 1: 着手前に今の消費を見る**

Neon コンソールで今月の CU-hours 消費とストレージの内訳を確認し、数値を控える。
（13 分放置で休止が観測されなかったという報告があり、想定より食っている可能性がある）

- [ ] **Step 2: Launch tier に上げ、autosuspend を無効化する**

Vercel Marketplace 経由の統合なので、**接続文字列や環境変数の再設定が要る可能性がある**。
見積もりは展示期間で 1 桁ドル（0.25 CU × 240h × $0.106 ≒ $6.4 + ストレージ従量）。

- [ ] **Step 3: 変更後に疎通を確認する**

```bash
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' \
  -H "Authorization: Bearer x" https://coto2ba-next-api.chotech.dev/api/daily
```
Expected: `401` が返る（= DB に到達している）。連続で叩いて**1 本目も 200ms 台**なら成功。

- [ ] **Step 4: スモークテストを流す**

Run: `python3 apps/api/tests/smoke.py https://coto2ba-next-api.chotech.dev`
Expected: 20 項目すべて PASS

- [ ] **Step 5: 戻す日をカレンダーに入れる**

**scale-to-zero を切ると常時課金になる。展示後に戻し忘れると毎月請求が続く。**
展示翌日に戻す予定を今すぐ入れること。`docs/PROGRESS.md` にも書く。

- [ ] **Step 6: 展示週はパイプラインを流さない**

ストレージが従量になると、パイプライン再実行の WAL で青天井に増えうる。

**注意: 今週やること。展示直前にやる作業ではない。**

---

### Task 0.5: 未認証リクエストが Neon を叩ける穴を塞ぐ

**2026-09-18 の調査で発見。** `gamesRoutes.use('*', requireAuth, rateLimit)` の順序のせいで、
**レート制限が認証の後ろにある**。デタラメな Bearer を投げると、401 が返る前に
Neon に 1〜2 クエリ飛ぶ。**外から叩くだけで DB の枠を削れる。**

既知の「レート制限がインスタンスを跨ぐと甘い」という懸念より、こちらのほうが深刻。
なお `rateLimit` は IP ではなく**ユーザー単位**なので、会場 Wi-Fi の NAT で
3 台が同一 IP になっても締め出されない。そこは今のままで正しい。

- [ ] **Step 1: DB の前に形だけ弾く**

`DEVICE_TOKEN_LENGTH` は既に contracts にある。長さ・文字種が合わない Bearer は
`fromDeviceToken` を呼ばずに 401 を返す。ゴミトークンの洪水が Neon に 1 クエリも投げなくなる。

**Better Auth のセッション経路には適用しないこと**（適用するとログインが壊れる）。
端末トークンの経路にだけ効かせる。

- [ ] **Step 2: IP 単位のバケットを最前段に置く**

`requireAuth` より**前**に置く。閾値は「明らかな異常だけ」を切る緩い値にする。

**ここが唯一の自爆リスク**: 厳しくすると会場 Wi-Fi の NAT で 3 台の iPad が
同一 IP になり、**自分のブースを締め出す**。既存のユーザー単位 5 req/s とは別物として緩く置く。

- [ ] **Step 3: ブースの 3 台で同時プレイして通ることを確認する**

これを確認せずに展示に持ち込まないこと。

- [ ] **Step 4: Vercel Firewall を保険として 1 つ入れる**

ダッシュボードで IP レート制限を設定する（コード 0 行、いつでも切れる）。

---

### Task 0.6: 認証不要のはずのエンドポイントが 401 を返す

`/api/words/check` と `/api/words/ghosts` は、コードのコメントに「認証不要」と書いてあるのに
**本番で 401**（2026-09-18 に実測確認）。`gamesRoutes` が `/api/*` 全体に掛かり、
後から登録される `wordsRoutes` を飲み込んでいる。

- [ ] **Step 1: 登録順を入れ替える**

`apps/api/src/app.ts` の `app.route('/api', wordsRoutes)` を `gamesRoutes` の**前**に移す。
`meRoutes` が先に登録されているから `/api/devices` が無事なのと同じ仕組みで直る。
`wordsRoutes` 自身の `use('/words/:word/*', requireAuth, rateLimit)` は残るので保護は変わらない。

- [ ] **Step 2: 手で 5 本叩いて確認する**

ルーティングの網羅テストが存在しないので、`/api/devices`・`/api/daily`・`/api/words/check`・
`/api/words/ghosts`・`/api/collection` を叩き、**期待どおりの認証要否**になっているか確かめる。

- [ ] **Step 3: 回帰テストを足す**

同じ事故が再発しないよう、**各エンドポイントの認証要否を固定するテスト**を書く。
コメントと実態が食い違っていたのが原因なので、テストで縛る。

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

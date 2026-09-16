# 技術調査結果（2026-09-17 / 全項目を一次ソースで検証済み）

> 実装前に該当ファイルを必ず読むこと。npm registry / 公式 docs / GitHub ソース / 実測ベンチで裏取り済み。

- [reference-repo](reference-repo.md) — coto2-ba (コトコトバ) hackathon reference implementation — full teardown of vector algorithms, game state machine, UI components and visual tiers
- [hono-vercel](hono-vercel.md) — Deploying a Hono API to Vercel (Node.js runtime) from a pnpm/Turborepo monorepo, with headless project + Neon provisioning — as of 2026-09-17
- [better-auth](better-auth.md) — Better Auth 1.7.5 (better-auth + @better-auth/expo) for Hono-on-Vercel + Expo Go anonymous auth
- [expo-sdk](expo-sdk.md) — Expo SDK 57 (current stable, 2026-09-17) — Expo Go compatibility matrix, package versions, and API shapes for a React Native word-puzzle app
- [drizzle-pgvector](drizzle-pgvector.md) — Drizzle ORM + pgvector (halfvec) on Neon Postgres for a vector-search game backend — versions, driver choice, SQL, indexing, bulk load, Neon Free limits (verified 2026-09-17)
- [japanese-nlp](japanese-nlp.md) — Python offline pipeline for a Japanese word2vec word game (uv / Python 3.12 / macOS arm64), verified 2026-09-17
- [rn-game-ui](rn-game-ui.md) — React Native / Expo Go (SDK 57, iOS-first) implementation techniques for a polished Japanese word-puzzle UI: Skia, Reanimated 4, Gesture Handler, detented slider, Japanese IME, share-image capture, data layer, keyboard
- [verification](verification.md) — 敵対的検証（refuted 1件あり: 日本語 NG 語リストは MIT で存在する）

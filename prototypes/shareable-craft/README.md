# craft 実験モードと独立UI試作

## 提案の中心：同じ結果形式で演算を比較する

既存のデイリー／フリーは変更しない。別の `craft` 実験モードで、`nu-chotech/alchemy-python` の `semantic_alchemy.py` にある `mix` / `slerp` / `subtract` / `repel` / `purify` を試す。**1語を自動確定する** `POST /api/craft/games/:id/experiment` が主経路で、候補から選ぶ操作は追加のUI案として残す。

実験リクエストは `{ "input_word": "金", "ratio": 0.5, "operation": "slerp", "expected_turn": 0 }`。現在語と入力語のベクトルに演算を適用し、近傍上位12語からPython案と同じ温度 `0.18` の重み付き選択を行う。再送で結果が変わらないよう、ゲームID・手数・入力を種とした決定的な抽選にした。手番が進んだ後の再送は409で拒否する。Pythonのモデルと現行DBの語彙が違うため、結果語の完全一致は保証しない。

| 演算 | ベクトルの行き先 |
| --- | --- |
| `mix` | 現在語と入力語を線形混合する。既存ゲームに最も近い |
| `slerp` | 2語の方向を球面上で補間する |
| `subtract` | 現在語から入力語の方向を引く |
| `repel` | 目標方向を足しつつ、入力語の方向を弱める |
| `purify` | 現在語と重なる成分を除いた入力語の方向を足す |

確定レスポンスの `result` / `rank` / `tier` / `move_count` / `status` / `perfect` とクリア・手数制限は既存計算を再利用する。実験固有の `operation` / `experimental_score` / `target_similarity` / `delta_similarity` / `breakdown` は追加項目で、既存ランキングや実績の点数には混ぜない。`breakdown` は Python 案の目標近接・整合・希少・意外・リスクを返す。計算内訳は遊び方の説明とUI比較用であり、現行の `rank` と同義ではない。

フロント向けの主提案は「同じゲーム表示のまま演算を切り替えると結果がどう変わるか」。候補カードは別の選択式UI案であり、採用は未決定。アプリへの導入前に実語彙で結果の納得感と応答時間を測る。

Python版との差分も意図的に残す。現行DBの `is_output` 語彙から結果を探し、同じ手番の再送が再現可能なよう乱数を決定的にした。希少性の近傍密度も現行の出力語彙で計算する。モデル・語彙・近傍探索が違うため、Python版と同じ語やスコアを返すことは契約にしない。一方、5演算のベクトル式、近傍上位12語の温度付き選択、評価内訳の重みはPython案を踏襲する。

`python3 -m http.server 8001 --directory prototypes/shareable-craft` をリポジトリのルートで実行する。`http://localhost:8001/experimental.html` は5演算の比較、`http://localhost:8001/` は候補選択の試作。

元案は `nu-chotech/alchemy-python` の `feature/shareable-game-flow`、commit `c024957` の `DESIGN.md` と `candidate_alchemy.py`。この画面は固定の12語だけで、素材A/B、割合、最大3候補、確定後の履歴・コンボを試せる。候補を見るだけでは手数は増えない。この HTML 自体は実モデル、API、保存、認証、3D表示、共有機能に接続しない。サーバー側の実装とフロント向け契約は後述する。

## フロント担当への統合提案

既存のデイリー／フリー画面を変えず、独立した craft 導線を追加する。バックエンドには以下の API を追加した。いずれも既存の Bearer 認証が必要。

| 操作 | API | 入力／結果 |
| --- | --- | --- |
| 開始 | `POST /api/craft/games` | `{difficulty?, combo_enabled?, goal_bias_enabled?}` → ゲーム状態 |
| 再表示 | `GET /api/craft/games/:id` | 保存済み状態（候補は含めない） |
| 候補を見る | `POST /api/craft/games/:id/candidates` | `{material_a, material_b, alpha}`。`alpha` は **A の割合**、0〜1。候補セットIDと最大3候補を返す。手数は増えない |
| 確定 | `POST /api/craft/games/:id/confirm` | `{candidate_set_id, candidate_id}` → 更新後の状態。古い候補や二重送信は409 |
| 演算して1語を自動確定 | `POST /api/craft/games/:id/experiment` | `{input_word, ratio, operation, expected_turn}` → 既存結果項目と実験スコア内訳 |

候補語と表示用スコア以外の内部情報は返さない。確定後は既存画面と共通する `result`、`rank`、`tier`、`move_count`、`status`、`perfect` を返し、状態取得でも `current_rank`、`current_tier`、`move_count` を返す。順位と tier は既存の計算を再利用する。`turn` は元案との対応のため残し、`move_count` と同値にする。追加要素の `combo`、`combo_enabled`、`goal_bias_enabled`、`beta` は craft 専用とする。

候補選択は専用テーブルで保存し、ランキング、実績、既存スコアに混ぜない。候補作成は前の候補セットを無効化し、確定は行ロックを取ったトランザクションで行う。画面は候補の再表示・再取得を許し、ゲーム復帰時には素材と履歴を状態から復元する。共有導線、3Dマップ、難易度別ヒント表示は次のフロント相談事項であり、今回の API/画面には含まない。

## 統合する場合の境界

既存の `/api/games`、`/api/games/:id/moves`、デイリー、ランキング、モバイルのプレイ画面はそのまま使う。候補選択は別の `craft` モードとして追加し、結果のスコアを既存の順位やデイリーランキングへ混ぜない。

| 元案 | このリポジトリでの扱い |
| --- | --- |
| 2素材と `alpha` | 新しい候補リクエストで扱う。`alpha` と既存の `ratio` の向きに注意（元案はAの割合、既存は入力語の割合） |
| 混合位置の近傍24語から最大3語 | 既存の `vocab.w2v` と pgvector を使う別サービスで実装。`is_output=true` とNG語の条件を引き継ぐ |
| ゴール補正 `beta`、コンボ | 候補の順位にのみ適用。補正の有無と数値はゲームに固定し、クライアントに決めさせない |
| 候補表示、確定 | 別エンドポイント。表示時はゲームの手数を更新せず、確定時にだけ進める |
| Python のプロセス内辞書 | Neon の専用テーブルへ置き換える。候補セットの状態と確定を同一トランザクションで更新する |
| 候補前の目標類似度 | normal ではレスポンスから省き、easy だけに含める。スコアは表示・選択に必要なものだけ返す |
| PCA の3D座標 | 現行の図鑑座標とは座標系が違う。表示するなら専用ビューと明示した座標系IDを使う |
| Python Web UI | 画面上の表現を参考にし、現行 Expo 画面の配下へは直接移植しない |

## 次の段階

1. 実語彙で5演算の結果の質と応答時間を測る。元案のPythonモデルと現行DBは語彙・正規化・候補母集団が一致する保証がないため、同じ結果になるとは仮定しない。
2. フロント担当と導線、候補カード、結果画面、ゲーム復帰時の見せ方を合意し、Expo に実装する。既存のデイリーとフリーのプレイ画面は変更しない。
3. 共有導線は保存済みのゲームID／結果IDを参照する方式とし、目標や内部状態をURLのクエリで信頼しない。
4. `craft_games` の候補セット有効期限と、長期保存・削除方針を本番投入前に決める。

なお、現行 `playMove` は `moves` 挿入と `games` 更新の間にトランザクションがない。新モードの確定処理ではこの順序を踏襲せず、原子的な更新を設計する。

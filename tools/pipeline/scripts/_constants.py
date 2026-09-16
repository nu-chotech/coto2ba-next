"""パイプラインの定数。

前半は **`packages/contracts/src/constants.ts` のミラー**。TS なので import できない。
値がずれるとゲームの判定とパイプラインの実測がずれるので、**必ず同期すること**。
後半はパイプラインでしか使わない定数（contracts には置かない）。

マジックナンバーはここにだけ書く（CLAUDE.md の絶対制約）。
"""

from __future__ import annotations

# ══════════════════════════════════════════════════════════════
#  packages/contracts/src/constants.ts のミラー
# ══════════════════════════════════════════════════════════════

# ベクトルの次元。
VECTOR_DIM = 200

# rank <= CLEAR_RANK でクリア。result == goal は rank 0（完全錬成）。
CLEAR_RANK = 10
PERFECT_RANK = 0

# ヒント: v_hint = (1 - HINT_RATIO) * v_current + HINT_RATIO * v_goal
HINT_COUNT = 6
HINT_RATIO = 0.2
HINT_CANDIDATE_COUNT = 30

# 最近傍を取る候補数。除外後に枯れないよう多めに取る。
NEAREST_CANDIDATES = 32

# 混合比率の刻み（0.1 〜 0.8 の 8 段階）。
RATIO_MIN = 0.1
RATIO_MAX = 0.8
RATIO_STEP = 0.1

# スタート語: ゴールから見た rank がこの範囲、かつ頻度順位がこの上限以下。
START_RANK_RANGE = (3_000, 30_000)
START_MAX_FREQ_RANK = 20_000

# 語彙（02_prune の実測値）。
INPUT_MAX_FREQ_RANK = 300_000
OUTPUT_MAX_FREQ_RANK = 180_000
N_INPUT = 208_707
N_OUTPUT = 99_805

# 難易度。
DIFFICULTIES = ("easy", "normal", "hard")
# 難易度ごとのボット手数レンジ（両端を含む）。
# SPEC §6.2 は easy<=4 / normal 5-7 / hard 8-12 だが、実測すると easy は候補全体の
# 0.5% しか出ず、SPEC の目標数（Easy 80）に到達不能だった（候補 13,699 に対し必要 17,000）。
# 実測の分布は 3手:1 / 4手:2 / 5手:12 / 6手:12 / 7手:16 / 8手:12 / 9手以上:4（n=59）なので、
# easy<=5 に緩めると 25% / 47% / 27% の健全な配分になる。
# プレイヤーにとって重要なのは絶対手数ではなく難易度の順序なので、これで支障はない。
# 詳細は docs/QUESTIONS.md。
DIFFICULTY_BOT_MOVES = {
    "easy": (0.0, 5.0),
    "normal": (5.01, 7.0),
    "hard": (7.01, 12.0),
}

# デイリー。
DAILY_TZ = "Asia/Tokyo"
DAILY_SCHEDULE_DAYS = 120
# 曜日 → 難易度（**index 0 = 日曜**）。SPEC §6.4: 月〜金 normal / 土 hard / 日 easy
DAILY_DIFFICULTY_BY_WEEKDAY = (
    "easy",  # 日
    "normal",  # 月
    "normal",  # 火
    "normal",  # 水
    "normal",  # 木
    "normal",  # 金
    "hard",  # 土
)

# 表示名（形容詞 1 語 + 名詞 1 語）。
DISPLAY_NAME_MAX_LENGTH = 12

# 図鑑のゴースト点（未取得語）のサンプル数。06 の入力件数と 10 の出力件数が
# ここからずれるとクライアント（assets/vocab/ghost.json）と食い違う。
SPACE_GHOST_COUNT = 2_000


# ══════════════════════════════════════════════════════════════
#  パイプライン専用（contracts には無い）
# ══════════════════════════════════════════════════════════════

# ── 01_download ──────────────────────────────────────────────
WIKIENTVEC_URL = (
    "https://github.com/singletongue/WikiEntVec/releases/download/"
    "20190520/jawiki.word_vectors.200d.txt.bz2"
)
DOWNLOAD_CHUNK_BYTES = 1 << 20
DOWNLOAD_TIMEOUT_SEC = 60.0
# 元ファイルの語数（ヘッダ検証用）。
WIKIENTVEC_TOTAL_WORDS = 751_361

# ── 03_export_pgvector ───────────────────────────────────────
# HNSW 構築時のメモリ。Neon Free の既定 64MB だと遅い 2 パス経路に落ちる
# （docs/research/drizzle-pgvector.md: 100,080 行で約 225MB 必要）。
MAINTENANCE_WORK_MEM = "256MB"
MAX_PARALLEL_MAINTENANCE_WORKERS = 2
# halfvec は float16。これを超える値は inf になり Postgres に弾かれる。
HALFVEC_MAX_ABS = 65504.0
# COPY の進捗表示の間隔（行）。
COPY_PROGRESS_EVERY = 10_000

# ── 04_goal_pool ─────────────────────────────────────────────
# ゴール候補の頻度順位（SPEC §6.1）。
GOAL_MIN_FREQ_RANK = 500
GOAL_MAX_FREQ_RANK = 30_000
GOAL_MIN_LEN = 2

# 健全性チェック（SPEC §6.1）。
HEALTH_NEIGHBOR_COUNT = 10
HEALTH_AFFIX_LEN = 2
HEALTH_AFFIX_THRESHOLD = 5
HEALTH_DIGIT_THRESHOLD = 3

# ヒント追従ボット（SPEC §6.2）。
BOT_MAX_MOVES = 15
BOT_RATIOS = (0.3, 0.5, 0.8)
BOT_START_COUNT = 5
# 1 回でもこの手数以上 / 未到達なら除外。
BOT_REJECT_MOVES = 13

# 目標サイズ（SPEC §6.2）。
GOAL_POOL_TARGETS = {"easy": 80, "normal": 150, "hard": 70}

# 進捗ファイルへの書き出し間隔（件）。
GOAL_POOL_FLUSH_EVERY = 1

# ── 09_name_parts ────────────────────────────────────────────
# 形容詞（形容詞-一般 / 形状詞-一般 / 形状詞-タリ）。
NAME_ADJ_POS_PREFIXES = ("形容詞", "形状詞")
NAME_ADJ_POS_EXCLUDED = ("非自立可能", "助動詞語幹")
# 「静かだ」型（形状詞）は連体形にするため「な」を付ける。
NAME_ADJ_NA_POS_PREFIX = "形状詞"
NAME_ADJ_NA_SUFFIX = "な"
NAME_ADJ_MAX_FREQ_RANK = 30_000
NAME_ADJ_MIN_LEN = 2
NAME_ADJ_MAX_LEN = 6
NAME_ADJ_TARGET = 200

# 名詞。
NAME_NOUN_MAX_FREQ_RANK = 20_000
NAME_NOUN_MIN_LEN = 2
NAME_NOUN_MAX_LEN = 5
NAME_NOUN_TARGET = 2_000

# 文法的に連結できない / 表示名として成立しない形容詞。
# （「同じな蚕」「そんなな蚕」「たくさんな蚕」「高めな蚕」になってしまうもの）
NAME_ADJ_STOP_WORDS = frozenset(
    {
        "同じ",
        "そんな",
        "どんな",
        "こんな",
        "あんな",
        "たくさん",
        "沢山",
        "余り",
        "まし",
        "高め",
        "深め",
        "強め",
        "広め",
        "空い",
        "おも",
        "滅多",
        "瓜二つ",
        "別々",
        "バラバラ",
        "性的",
        "セクシー",
    }
)
# 名詞は**漢字かカタカナを 1 文字以上含む**こと。
# ひらがなだけの語は「こと / もの / ため / あり / たち」のような形式名詞ばかりで、
# 表示名（「静かなこと」）として成立しない。
NAME_NOUN_REQUIRE_CONTENT_CHAR = True

NAME_PART_KINDS = ("adjective", "noun")

# ── 06_umap_coords ───────────────────────────────────────────
# SPEC §9.1。UMAP のパラメータは固定値（変えると図鑑の「世界地図」の形が変わり、
# 過去に保存した pos3 と一貫しなくなる）。
UMAP_N_COMPONENTS = 3
UMAP_N_NEIGHBORS = 15
UMAP_MIN_DIST = 0.1
UMAP_METRIC = "cosine"
# 各軸をこの範囲に正規化する（SPEC: [-1, 1]）。
POS3_RANGE = (-1.0, 1.0)
# DB 書き込みの一時テーブル名。
POS3_LOAD_TABLE = "pos3_load"

# ── 07_descriptions ──────────────────────────────────────────
# SPEC §6.5 / §7.6。連絡先必須（Wikipedia の利用規約）。
WIKIPEDIA_UA = "coto2ba-next/0.1 (https://coto2ba-next.chotech.dev)"
WIKIPEDIA_SUMMARY_URL = "https://ja.wikipedia.org/api/rest_v1/page/summary"
# 頻度上位何語まで説明文を埋めるか（ゴールプール全語には別途）。
DESCRIPTIONS_FREQ_LIMIT = 50_000
# goal_pool.description の上限文字数。句点で切る。
GOAL_DESCRIPTION_MAX_LEN = 40
# 同時実行数（Wikipedia のレート制限を守る）。
DESCRIPTIONS_CONCURRENCY = 4
DESCRIPTIONS_TIMEOUT_SEC = 15.0
DESCRIPTIONS_MAX_RETRIES = 5
DESCRIPTIONS_BASE_BACKOFF_SEC = 1.0
DESCRIPTIONS_MAX_BACKOFF_SEC = 30.0

# ── 10_mobile_assets ─────────────────────────────────────────
# ゴースト点の座標が未計算（06 未実行）のときの疑似乱数フォールバック。
# シードは日付ベース（04_goal_pool の SHUFFLE_SEED と同じ流儀）。
GHOST_FALLBACK_SEED = 20260917
# フィボナッチ球の半径のゆらぎの下限（apps/mobile/src/features/collection/ghost.ts の
# generateFallbackGhosts と同じ値。中身は空点でなく実語を置く点が違う）。
GHOST_FALLBACK_RADIUS_MIN = 0.45
# JSON の座標精度（桁を絞ってファイルサイズを抑える）。
GHOST_POS3_DECIMALS = 4

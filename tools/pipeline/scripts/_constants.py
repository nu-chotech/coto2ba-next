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
# 難易度ごとのボット手数レンジ（両端を含む）。SPEC §6.2
DIFFICULTY_BOT_MOVES = {
    "easy": (0.0, 4.0),
    "normal": (5.0, 7.0),
    "hard": (8.0, 12.0),
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

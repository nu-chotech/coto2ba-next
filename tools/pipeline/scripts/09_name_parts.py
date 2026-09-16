"""表示名の自動生成用パーツを `name_parts` に入れる（SPEC §7.4）。

display_name は「形容詞 1 語 + 名詞 1 語」（例「静かな蚕」「新しい潤滑油」）。
サーバーは `name_parts` から kind='adjective' と kind='noun' を 1 語ずつ引いて
**そのまま連結するだけ**でよいように、形状詞（「静か」型）には連体形の「な」を
付けた状態で入れる。形容詞（「新しい」型）はそのまま。

長さ: 形容詞 <= 6 文字、名詞 <= 5 文字 なので連結しても
DISPLAY_NAME_MAX_LENGTH（12）を超えない。

使い方:
    uv run python scripts/09_name_parts.py
    uv run python scripts/09_name_parts.py --dry-run
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    KANJI,
    KATAKANA,
    VOCAB_PARQUET,
    database_url,
    has_digit,
    is_ng,
    load_ng_words,
)
from _constants import (  # noqa: E402
    DISPLAY_NAME_MAX_LENGTH,
    NAME_ADJ_MAX_FREQ_RANK,
    NAME_ADJ_MAX_LEN,
    NAME_ADJ_MIN_LEN,
    NAME_ADJ_NA_POS_PREFIX,
    NAME_ADJ_NA_SUFFIX,
    NAME_ADJ_POS_EXCLUDED,
    NAME_ADJ_POS_PREFIXES,
    NAME_ADJ_STOP_WORDS,
    NAME_ADJ_TARGET,
    NAME_NOUN_MAX_FREQ_RANK,
    NAME_NOUN_MAX_LEN,
    NAME_NOUN_MIN_LEN,
    NAME_NOUN_REQUIRE_CONTENT_CHAR,
    NAME_NOUN_TARGET,
)
from _db import connect, ensure_name_parts  # noqa: E402

# 漢字かカタカナを 1 文字でも含むか（ひらがなだけの形式名詞を落とす）。
CONTENT_CHAR_RE = re.compile(f"[{KANJI}{KATAKANA}]")

UPSERT_SQL = """
INSERT INTO name_parts (word, kind) VALUES (%s, %s)
ON CONFLICT (word) DO UPDATE SET kind = EXCLUDED.kind
"""


def attributive(word: str, pos: str) -> str:
    """連体形にする。形状詞（静か）→「静かな」、形容詞（新しい）→ そのまま。"""
    if pos.startswith(NAME_ADJ_NA_POS_PREFIX):
        return word + NAME_ADJ_NA_SUFFIX
    return word


def collect(ng: tuple[set[str], set[str]]) -> tuple[list[str], list[str]]:
    table = pq.read_table(
        VOCAB_PARQUET, columns=["word", "freq_rank", "is_output", "is_common_noun", "pos"]
    )
    words = table["word"].to_pylist()
    freq = table["freq_rank"].to_pylist()
    is_output = table["is_output"].to_pylist()
    is_common = table["is_common_noun"].to_pylist()
    poses = table["pos"].to_pylist()

    adjectives: list[str] = []
    nouns: list[str] = []
    # parquet は freq_rank 昇順なので、先頭から詰めれば頻度上位が取れる。
    for word, rank, out, common, pos in zip(
        words, freq, is_output, is_common, poses, strict=True
    ):
        if not out or has_digit(word) or is_ng(word, ng):
            continue

        if (
            len(adjectives) < NAME_ADJ_TARGET
            and pos
            and rank <= NAME_ADJ_MAX_FREQ_RANK
            and pos.startswith(NAME_ADJ_POS_PREFIXES)
            and not pos.endswith(NAME_ADJ_POS_EXCLUDED)
            and NAME_ADJ_MIN_LEN <= len(word) <= NAME_ADJ_MAX_LEN
            and word not in NAME_ADJ_STOP_WORDS
        ):
            form = attributive(word, pos)
            if len(form) <= NAME_ADJ_MAX_LEN:
                adjectives.append(form)

        if (
            len(nouns) < NAME_NOUN_TARGET
            and common
            and rank <= NAME_NOUN_MAX_FREQ_RANK
            and NAME_NOUN_MIN_LEN <= len(word) <= NAME_NOUN_MAX_LEN
            and (not NAME_NOUN_REQUIRE_CONTENT_CHAR or CONTENT_CHAR_RE.search(word))
        ):
            nouns.append(word)

        if len(adjectives) >= NAME_ADJ_TARGET and len(nouns) >= NAME_NOUN_TARGET:
            break

    return adjectives, nouns


def main() -> None:
    ap = argparse.ArgumentParser(description="表示名のパーツを作る")
    ap.add_argument("--dry-run", action="store_true", help="DB に書かず先頭を出すだけ")
    args = ap.parse_args()

    ng = load_ng_words()
    adjectives, nouns = collect(ng)
    longest = max(len(a) for a in adjectives) + max(len(n) for n in nouns)

    print(f"形容詞 {len(adjectives)} 語 / 目標 {NAME_ADJ_TARGET}", file=sys.stderr)
    print(f"名詞   {len(nouns)} 語 / 目標 {NAME_NOUN_TARGET}", file=sys.stderr)
    print(f"最長の表示名 {longest} 文字 / 上限 {DISPLAY_NAME_MAX_LENGTH}", file=sys.stderr)
    print(f"  例: {adjectives[0]}{nouns[0]} / {adjectives[-1]}{nouns[-1]}", file=sys.stderr)
    if longest > DISPLAY_NAME_MAX_LENGTH:
        print(
            "※ 連結が DISPLAY_NAME_MAX_LENGTH を超えます。"
            "_constants.py の NAME_ADJ_MAX_LEN / NAME_NOUN_MAX_LEN を詰めてください。",
            file=sys.stderr,
        )

    if args.dry_run:
        print("形容詞:", " ".join(adjectives[:30]))
        print("名詞  :", " ".join(nouns[:30]))
        return

    rows = [(w, "adjective") for w in adjectives] + [(w, "noun") for w in nouns]
    with connect(database_url()) as conn:
        ensure_name_parts(conn)
        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, rows)
        total = conn.execute("SELECT count(*) FROM name_parts").fetchone()
    assert total is not None
    print(f"\nname_parts に {len(rows)} 行 upsert しました（合計 {total[0]} 行）", file=sys.stderr)


if __name__ == "__main__":
    main()

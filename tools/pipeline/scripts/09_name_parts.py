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
    NAME_ADJ_NA_POS_PREFIX,
    NAME_ADJ_NA_SUFFIX,
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


# 形容詞は日本語では名前に使える語が限られた閉じた集合なので、頻度順ではなく手で選ぶ。
# 頻度上位を機械的に取ると「可能な」「頻繁な」「主な」ばかりになって名前として面白くない。
CURATED_ADJECTIVES = [
    "静かな", "黄金の", "遠い", "深い", "淡い", "鋭い", "優しい", "小さな", "大きな",
    "古い", "新しい", "温かい", "冷たい", "青い", "白い", "黒い", "赤い", "眩しい",
    "儚い", "強い", "軽い", "重い", "明るい", "暗い", "細い", "丸い", "硬い", "柔らかい",
    "甘い", "苦い", "涼しい", "暖かい", "懐かしい", "美しい", "危うい", "賢い", "眠い",
    "遥かな", "密やかな", "朗らかな", "健やかな", "鮮やかな", "穏やかな", "緩やかな",
    "軽やかな", "涼やかな", "細やかな", "華やかな", "しなやかな", "麗しい", "潔い",
    "清らかな", "秘密の", "永遠の", "最初の", "最後の", "真夜中の", "夜明けの",
    "夕暮れの", "銀の", "鉄の", "硝子の", "琥珀の", "月の", "星の", "海の", "北の",
    "南の", "忘れられた", "名もなき", "眠れる", "旅する", "踊る", "歌う", "光る",
]

ABSTRACT_NOUN_SUBPOS = {"サ変可能", "副詞可能", "サ変形状詞可能", "形状詞可能", "助数詞可能"}
HIRAGANA_TAIL_RE = re.compile(r"[\u3041-\u309F]$")
ALL_KANJI_RE = re.compile(r"[\u4E00-\u9FFF\u3400-\u4DBF]{2,3}")
# 頻度が高すぎる語は名前として平板なので下限を設ける
NAME_NOUN_MIN_FREQ_RANK = 2500


def attributive(word: str, pos: str) -> str:
    """連体形にする。形状詞（静か）→「静かな」、形容詞（新しい）→ そのまま。"""
    if pos.startswith(NAME_ADJ_NA_POS_PREFIX):
        return word + NAME_ADJ_NA_SUFFIX
    return word


def is_concrete_noun(word: str, tagger) -> bool:
    """「閲覧」「当て」のような抽象語・サ変名詞を落として、モノの名前に寄せる。

    unidic の細分類（pos3）は parquet に落ちていないのでここで取り直す。
    サ変可能 / 副詞可能 / 形状詞可能 は「〜する」「〜に」で使う抽象語なので除く。
    また動詞の連用形由来（当て・遊び・売り）も名前としては弱いので、
    ひらがなで終わる 2 文字語を除く。
    """
    # 全部漢字の 2〜3 文字に絞ると具体物（蚕・岩礁・潤滑油）に寄る。
    # ひらがな・カタカナ混じりは抽象語や外来語の比率が高い。
    if not ALL_KANJI_RE.fullmatch(word):
        return False
    toks = tagger(word)
    if not toks or any(tk.is_unk for tk in toks):
        return False
    for tk in toks:
        f = tk.feature
        if f.pos1 == "名詞" and f.pos3 in ABSTRACT_NOUN_SUBPOS:
            return False
    # 「当て」「遊び」のような連用形名詞（漢字 + ひらがな送り）を落とす
    return not (len(word) <= 2 and HIRAGANA_TAIL_RE.search(word))


def collect(ng: tuple[set[str], set[str]], tagger) -> tuple[list[str], list[str]]:
    table = pq.read_table(
        VOCAB_PARQUET, columns=["word", "freq_rank", "is_output", "is_common_noun", "pos"]
    )
    words = table["word"].to_pylist()
    freq = table["freq_rank"].to_pylist()
    is_output = table["is_output"].to_pylist()
    is_common = table["is_common_noun"].to_pylist()
    poses = table["pos"].to_pylist()

    nouns: list[str] = []
    # parquet は freq_rank 昇順なので、先頭から詰めれば頻度上位が取れる。
    for word, rank, out, common, _pos in zip(
        words, freq, is_output, is_common, poses, strict=True
    ):
        if not out or has_digit(word) or is_ng(word, ng):
            continue

        if (
            len(nouns) < NAME_NOUN_TARGET
            and common
            and NAME_NOUN_MIN_FREQ_RANK <= rank <= NAME_NOUN_MAX_FREQ_RANK
            and NAME_NOUN_MIN_LEN <= len(word) <= NAME_NOUN_MAX_LEN
            and (not NAME_NOUN_REQUIRE_CONTENT_CHAR or CONTENT_CHAR_RE.search(word))
            and is_concrete_noun(word, tagger)
        ):
            nouns.append(word)

        if len(nouns) >= NAME_NOUN_TARGET:
            break

    return CURATED_ADJECTIVES, nouns


def _tagger():
    import fugashi

    return fugashi.Tagger()


def main() -> None:
    ap = argparse.ArgumentParser(description="表示名のパーツを作る")
    ap.add_argument("--dry-run", action="store_true", help="DB に書かず先頭を出すだけ")
    args = ap.parse_args()

    ng = load_ng_words()
    adjectives, nouns = collect(ng, _tagger())
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

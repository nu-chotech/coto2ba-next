"""WikiEntVec の 200d テキストを二層語彙に刈り込み、parquet + npy に落とす。

出力:
  data/vocab.parquet  : word, freq_rank, is_input, is_output, is_common_noun, pos
  data/vectors.npy    : float32 (N, 200)  ※ parquet の行順と一致

規則は SPEC §4.2。ただし「単一トークン」条件は名詞複合語（潤滑油・銀河系・伝統芸能）
を落としてしまうため、以下に緩めている（docs/PROGRESS.md に記録）:
  - 単一トークン: 品詞 名詞/動詞/形容詞/形状詞。用言は 表層形 == 基本形（活用断片を除外）
  - 複数トークン: 全トークンが名詞（数詞・代名詞を除く）＝ 名詞複合語なら採用
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import Counter

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    DIM,
    VECTORS_NPY,
    VECTORS_TXT,
    VOCAB_PARQUET,
    has_digit,
    has_japanese,
    has_symbol,
    is_ng,
    load_ng_words,
    normalize_word,
)

INPUT_MAX_FREQ_RANK = 300_000
MAX_WORD_LEN = 24
CONTENT_POS = {"名詞", "動詞", "形容詞", "形状詞"}
EXCLUDED_NOUN_SUBPOS = {"数詞", "代名詞", "助動詞語幹"}


def build_tagger():
    import fugashi

    return fugashi.Tagger()


def classify_output(word: str, tagger) -> tuple[bool, str | None, bool]:
    """(is_output, pos, is_common_noun) を返す。"""
    toks = tagger(word)
    if not toks:
        return False, None, False
    # 表層の連結が元の語と一致しない（未知語分割の失敗）ものは落とす
    if "".join(t.surface for t in toks) != word:
        return False, None, False

    if len(toks) == 1:
        t = toks[0]
        f = t.feature
        pos1, pos2 = f.pos1, f.pos2
        if pos1 not in CONTENT_POS:
            return False, None, False
        if pos1 == "名詞" and pos2 in EXCLUDED_NOUN_SUBPOS:
            return False, None, False
        if pos1 in {"動詞", "形容詞", "形状詞"}:
            # 活用断片（斬ら / 美しく）を落とす: 基本形と表層形が一致すること
            lemma = f.lemma
            if not lemma or lemma != t.surface:
                return False, None, False
        pos = f"{pos1}-{pos2}" if pos2 and pos2 != "*" else pos1
        common = pos1 == "名詞" and pos2 == "普通名詞"
        return True, pos, common

    # 複合語: 全トークンが名詞なら名詞複合語として採用
    for t in toks:
        f = t.feature
        if f.pos1 != "名詞" or f.pos2 in EXCLUDED_NOUN_SUBPOS:
            return False, None, False
    common = all(t.feature.pos2 == "普通名詞" for t in toks)
    return True, "名詞-複合", common


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-rank", type=int, default=INPUT_MAX_FREQ_RANK)
    ap.add_argument("--limit", type=int, default=0, help="デバッグ用: 読む行数の上限")
    args = ap.parse_args()

    ng = load_ng_words()
    print(f"NG 語: {len(ng)} 件", file=sys.stderr)

    tagger = build_tagger()
    stats = Counter()
    t0 = time.time()

    words: list[str] = []
    ranks: list[int] = []
    vecs: list[np.ndarray] = []
    seen: set[str] = set()

    with open(VECTORS_TXT, encoding="utf-8") as fh:
        header = fh.readline().split()
        total, dim = int(header[0]), int(header[1])
        if dim != DIM:
            raise SystemExit(f"次元が想定外: {dim}")
        print(f"元データ: {total} 語 × {dim} 次元", file=sys.stderr)

        limit = args.limit or args.max_rank
        for rank, line in enumerate(fh, start=1):
            if rank > limit:
                break
            sp = line.find(" ")
            if sp <= 0:
                stats["malformed"] += 1
                continue
            raw = line[:sp]
            word = normalize_word(raw)
            stats["read"] += 1

            if not word or len(word) > MAX_WORD_LEN:
                stats["drop_len"] += 1
                continue
            if word in seen:
                stats["drop_dup"] += 1
                continue
            if not has_japanese(word):
                stats["drop_no_japanese"] += 1
                continue
            if has_symbol(word):
                stats["drop_symbol"] += 1
                continue
            if is_ng(word, ng):
                stats["drop_ng_input"] += 1
                continue

            body = np.fromstring(line[sp + 1 :], dtype=np.float32, sep=" ")  # noqa: NPY003
            if body.shape[0] != DIM:
                stats["malformed"] += 1
                continue

            seen.add(word)
            words.append(word)
            ranks.append(rank)
            vecs.append(body)
            stats["is_input"] += 1

            if stats["is_input"] % 25_000 == 0:
                print(
                    f"  {rank:>7} 行読了 / 入力語彙 {stats['is_input']:>6} "
                    f"({time.time() - t0:.0f}s)",
                    file=sys.stderr,
                )

    print(f"入力語彙確定: {len(words)} 語 ({time.time() - t0:.0f}s)", file=sys.stderr)

    # ── 出力語彙の判定 ──
    is_output: list[bool] = []
    is_common: list[bool] = []
    poses: list[str | None] = []
    t1 = time.time()
    for w in words:
        if len(w) < 2:
            is_output.append(False)
            is_common.append(False)
            poses.append(None)
            stats["drop_out_short"] += 1
            continue
        if has_digit(w):
            is_output.append(False)
            is_common.append(False)
            poses.append(None)
            stats["drop_out_digit"] += 1
            continue
        ok, pos, common = classify_output(w, tagger)
        is_output.append(ok)
        is_common.append(common)
        poses.append(pos)
        if ok:
            stats["is_output"] += 1
            if common:
                stats["is_common_noun"] += 1
        else:
            stats["drop_out_pos"] += 1

    print(f"出力語彙判定: {time.time() - t1:.0f}s", file=sys.stderr)

    mat = np.vstack(vecs).astype(np.float32)
    np.save(VECTORS_NPY, mat)
    table = pa.table(
        {
            "word": pa.array(words, pa.string()),
            "freq_rank": pa.array(ranks, pa.int32()),
            "is_input": pa.array([True] * len(words), pa.bool_()),
            "is_output": pa.array(is_output, pa.bool_()),
            "is_common_noun": pa.array(is_common, pa.bool_()),
            "pos": pa.array(poses, pa.string()),
        }
    )
    pq.write_table(table, VOCAB_PARQUET, compression="zstd")

    print("\n=== 統計 ===", file=sys.stderr)
    for k, v in sorted(stats.items()):
        print(f"  {k:<22} {v:>8}", file=sys.stderr)
    print(f"\n入力語彙 N_INPUT  = {len(words)}", file=sys.stderr)
    print(f"出力語彙 N_OUTPUT = {stats['is_output']}", file=sys.stderr)
    print(f"一般名詞          = {stats['is_common_noun']}", file=sys.stderr)
    print(f"\n→ {VOCAB_PARQUET}  /  {VECTORS_NPY} {mat.shape}", file=sys.stderr)
    print(
        f"\n※ packages/contracts/src/constants.ts の N_OUTPUT を "
        f"{stats['is_output']} に更新すること",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

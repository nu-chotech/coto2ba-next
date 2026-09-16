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
import re
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
# 出力語彙はここまで。これ以降は地名・人名の長い尾で、混合結果・ヒントとして質が落ちる。
OUTPUT_MAX_FREQ_RANK = 180_000
MAX_WORD_LEN = 24
CONTENT_POS = {"名詞", "動詞", "形容詞", "形状詞"}
EXCLUDED_NOUN_SUBPOS = {"数詞", "代名詞", "助動詞語幹"}
# 複合語（潤滑油 = 潤滑[名詞] + 油[接尾辞-名詞的]）を通すために許す品詞
COMPOUND_POS = {"名詞", "接頭辞", "接尾辞"}
# サ変可能などの抽象名詞。ゴール語・スタート語・表示名として弱い
# （促進 / 捜査 / 提唱 / 後悔 / 目指し）。unidic の pos3。
ABSTRACT_NOUN_SUBPOS = {"サ変可能", "副詞可能", "サ変形状詞可能", "形状詞可能", "助数詞可能"}
HIRAGANA_TAIL_RE = re.compile(r"[\u3041-\u309F]$")
# 出力語彙の最小文字数。ただし **漢字 1 文字は許す**。
# SPEC §4.2 は「2 文字以上」だが、それだと SPEC 自身がゴールの例に挙げている「蚕」や、
# 虹 / 鶴 / 亀 / 苔 / 琴 / 筆 のような目的地として最良の語が全部落ちる。
# ひらがな・カタカナ 1 文字（を / ん / ア）はノイズなので従来どおり落とす。
OUTPUT_MIN_LEN = 2
SINGLE_KANJI_RE = re.compile(r"^[\u4E00-\u9FFF\u3400-\u4DBF]$")


def build_tagger():
    import fugashi

    return fugashi.Tagger()


def is_concrete(word: str, toks) -> bool:
    """モノ・生き物・場所など、目的地や出発点として絵になる語か。

    Wikipedia の頻度上位はサ変名詞（促進・捜査・提唱）と連用形名詞（目指し・よれ）が
    非常に多く、そのままだとゴールプールが行政文書のようになる。これを落とすと
    温泉 / 宝石 / 琥珀 / 振り子 / 潤滑油 / 土偶 / 刀剣 / 巫女 が残る。
    """
    for t in toks:
        f = t.feature
        if f.pos1 == "名詞" and f.pos3 in ABSTRACT_NOUN_SUBPOS:
            return False
        if f.pos2 in ("固有名詞", "数詞", "代名詞"):
            return False
    # 「目指し」「よれ」のような連用形名詞（短くてひらがな終わり）
    return not (len(word) <= 3 and HIRAGANA_TAIL_RE.search(word))


def classify_output(word: str, tagger) -> tuple[bool, str | None, bool, bool]:
    """(is_output, pos, is_common_noun) を返す。

    - 未知語（is_unk）は品詞情報が信用できないので落とす
    - 用言は 表層形 == orthBase（書字形基本形）であること。lemma は語彙素（斬ら→切る）
      なので使わない
    - 複合語は 名詞/接頭辞/接尾辞 のみで構成され、名詞を 1 つ以上含み、
      末尾が 名詞 か 接尾辞-名詞的 であること
    """
    toks = tagger(word)
    if not toks:
        return False, None, False, False
    if any(t.is_unk for t in toks):
        return False, None, False, False
    if "".join(t.surface for t in toks) != word:
        return False, None, False, False

    if len(toks) == 1:
        t = toks[0]
        f = t.feature
        pos1, pos2 = f.pos1, f.pos2
        if pos1 not in CONTENT_POS:
            return False, None, False, False
        if pos1 == "名詞" and pos2 in EXCLUDED_NOUN_SUBPOS:
            return False, None, False, False
        if pos1 in {"動詞", "形容詞", "形状詞"}:
            # 活用断片（斬ら / 美しく / 走っ）を落とす: 書字形基本形と表層形が一致すること
            base = f.orthBase
            if not base or base != t.surface:
                return False, None, False, False
        pos = f"{pos1}-{pos2}" if pos2 and pos2 != "*" else pos1
        common = pos1 == "名詞" and pos2 == "普通名詞"
        return True, pos, common, is_concrete(word, toks)

    has_noun = False
    for t in toks:
        f = t.feature
        if f.pos1 not in COMPOUND_POS:
            return False, None, False, False
        if f.pos1 == "名詞":
            if f.pos2 in EXCLUDED_NOUN_SUBPOS:
                return False, None, False, False
            has_noun = True
    if not has_noun:
        return False, None, False, False
    last = toks[-1].feature
    if last.pos1 == "接頭辞":
        return False, None, False, False
    if last.pos1 == "接尾辞" and last.pos2 != "名詞的":
        return False, None, False, False
    common = all(
        t.feature.pos1 != "名詞" or t.feature.pos2 == "普通名詞" for t in toks
    )
    return True, "名詞-複合", common, is_concrete(word, toks)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-rank", type=int, default=INPUT_MAX_FREQ_RANK)
    ap.add_argument("--limit", type=int, default=0, help="デバッグ用: 読む行数の上限")
    args = ap.parse_args()

    ng = load_ng_words()
    print(f"NG 語: 完全一致 {len(ng[0])} / 部分一致 {len(ng[1])} 件", file=sys.stderr)

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
    is_conc: list[bool] = []
    poses: list[str | None] = []
    t1 = time.time()
    for w, rank in zip(words, ranks, strict=True):
        if rank > OUTPUT_MAX_FREQ_RANK:
            is_output.append(False)
            is_common.append(False)
            is_conc.append(False)
            poses.append(None)
            stats["drop_out_freq"] += 1
            continue
        if len(w) < OUTPUT_MIN_LEN and not SINGLE_KANJI_RE.match(w):
            is_output.append(False)
            is_common.append(False)
            is_conc.append(False)
            poses.append(None)
            stats["drop_out_short"] += 1
            continue
        if has_digit(w):
            is_output.append(False)
            is_common.append(False)
            is_conc.append(False)
            poses.append(None)
            stats["drop_out_digit"] += 1
            continue
        ok, pos, common, conc = classify_output(w, tagger)
        is_output.append(ok)
        is_common.append(common)
        is_conc.append(ok and conc)
        poses.append(pos)
        if ok:
            stats["is_output"] += 1
            if common:
                stats["is_common_noun"] += 1
            if conc:
                stats["is_concrete"] += 1
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
            "is_concrete": pa.array(is_conc, pa.bool_()),
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

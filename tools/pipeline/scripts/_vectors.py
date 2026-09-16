"""出力語彙のベクトル空間と、ゲームと同じ演算（mix / nearest / hint / rank）。

サーバー（apps/api/src/services/game.ts）と**同じ結果になること**が前提。
違うとゴールプールの難易度実測が意味を失う。SPEC §5.2〜5.4 / ARCHITECTURE §6。

行列は一度だけ単位長に正規化して `data/output_vectors.npy` にキャッシュし、
以後は mmap で読む（マルチプロセスでも OS のページキャッシュを共有できる）。
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from random import Random

import numpy as np
import pyarrow.parquet as pq

from _common import (
    DATA_DIR,
    VECTORS_NPY,
    VOCAB_PARQUET,
    has_digit,
    is_ng,
    normalize_rows,
    shares_kanji,
)
from _constants import (
    HINT_CANDIDATE_COUNT,
    HINT_COUNT,
    HINT_RATIO,
    NEAREST_CANDIDATES,
    START_MAX_FREQ_RANK,
    START_RANK_RANGE,
    VECTOR_DIM,
)

OUTPUT_VECTORS_NPY = DATA_DIR / "output_vectors.npy"


@dataclass(slots=True)
class OutputSpace:
    """出力語彙だけを詰めた空間。`mat` の各行は単位長。"""

    words: list[str]
    index: dict[str, int]
    freq_rank: np.ndarray  # int32 (N,)
    is_common_noun: np.ndarray  # bool (N,)
    mat: np.ndarray  # float32 (N, VECTOR_DIM) 単位長

    @property
    def size(self) -> int:
        return len(self.words)


def _read_output_columns() -> tuple[list[str], np.ndarray, np.ndarray, np.ndarray]:
    table = pq.read_table(
        VOCAB_PARQUET, columns=["word", "freq_rank", "is_output", "is_common_noun"]
    )
    mask = np.asarray(table["is_output"].to_numpy(zero_copy_only=False), dtype=bool)
    words = [w for w, m in zip(table["word"].to_pylist(), mask, strict=True) if m]
    freq = np.asarray(table["freq_rank"].to_numpy(zero_copy_only=False), dtype=np.int32)[mask]
    common = np.asarray(
        table["is_common_noun"].to_numpy(zero_copy_only=False), dtype=bool
    )[mask]
    return words, freq, common, mask


def build_output_cache(force: bool = False) -> Path:
    """`data/output_vectors.npy`（正規化済み・出力語彙のみ）を作る。"""
    words, _freq, _common, mask = _read_output_columns()
    if not force and OUTPUT_VECTORS_NPY.exists():
        cached = np.load(OUTPUT_VECTORS_NPY, mmap_mode="r")
        if cached.shape == (len(words), VECTOR_DIM):
            return OUTPUT_VECTORS_NPY
        print("キャッシュの形が合わないので作り直します", file=sys.stderr)

    full = np.load(VECTORS_NPY, mmap_mode="r")
    if full.shape[0] != mask.shape[0]:
        raise SystemExit(
            f"vectors.npy({full.shape[0]}) と vocab.parquet({mask.shape[0]}) の行数が違います"
        )
    mat = np.ascontiguousarray(full[mask], dtype=np.float32)
    mat = normalize_rows(mat).astype(np.float32, copy=False)
    np.save(OUTPUT_VECTORS_NPY, mat)
    print(
        f"出力語彙ベクトルのキャッシュ: {OUTPUT_VECTORS_NPY} {mat.shape}", file=sys.stderr
    )
    return OUTPUT_VECTORS_NPY


def load_output_space(mmap: bool = True) -> OutputSpace:
    """出力語彙の空間を読む。キャッシュが無ければ作る。"""
    build_output_cache()
    words, freq, common, _mask = _read_output_columns()
    mat = np.load(OUTPUT_VECTORS_NPY, mmap_mode="r" if mmap else None)
    if mat.shape != (len(words), VECTOR_DIM):
        raise SystemExit("output_vectors.npy が vocab.parquet と一致しません（作り直してください）")
    return OutputSpace(
        words=words,
        index={w: i for i, w in enumerate(words)},
        freq_rank=freq,
        is_common_noun=common,
        mat=mat,
    )


# ── 基本演算 ──────────────────────────────────────────────────
def top_indices(scores: np.ndarray, k: int) -> np.ndarray:
    """スコア降順の上位 k 件のインデックス（並び順つき）。argsort しない。"""
    k = min(k, scores.shape[0])
    part = np.argpartition(-scores, k - 1)[:k]
    return part[np.argsort(-scores[part], kind="stable")]


def top_indices_batch(scores: np.ndarray, k: int) -> np.ndarray:
    """列ごとの上位 k 件。`scores` は (N, m)。戻り値は (k, m)。"""
    k = min(k, scores.shape[0])
    part = np.argpartition(-scores, k - 1, axis=0)[:k]
    picked = np.take_along_axis(scores, part, axis=0)
    order = np.argsort(-picked, axis=0, kind="stable")
    return np.take_along_axis(part, order, axis=0)


def goal_sims(space: OutputSpace, goal_idx: int) -> np.ndarray:
    """ゴール語との cos 類似度（行は単位長なので内積そのもの）。"""
    return space.mat @ space.mat[goal_idx]


def rank_of(sorted_sims_asc: np.ndarray, sim: float) -> int:
    """SPEC §5.2 の rank。`1 + |{w != goal : cos(w,goal) > sim}|`。

    `sorted_sims_asc` は `np.sort(goal_sims(...))`。ゴール自身も含むので、
    「sim より大きい要素数」がそのまま rank になる（goal 自身が +1 を担う）。
    sim == 1.0（= goal そのもの）のとき 0 = 完全錬成。
    """
    return int(sorted_sims_asc.size - np.searchsorted(sorted_sims_asc, sim, side="right"))


def mix(space: OutputSpace, current_idx: int, input_idx: int, ratio: float) -> np.ndarray:
    """v_new = (1 - ratio) * v_current + ratio * v_input（生ベクトル）。"""
    return (1.0 - ratio) * space.mat[current_idx] + ratio * space.mat[input_idx]


def nearest_index(space: OutputSpace, vec: np.ndarray, exclude: set[int]) -> int | None:
    """出力語彙内の最近傍。`exclude` は {current, input} など。"""
    scores = space.mat @ vec.astype(np.float32)
    for i in top_indices(scores, NEAREST_CANDIDATES + len(exclude)):
        if int(i) not in exclude:
            return int(i)
    return None


def hint_indices(
    space: OutputSpace,
    current_idx: int,
    goal_idx: int,
    exclude: set[int],
    goal_vec: np.ndarray | None = None,
) -> list[int]:
    """SPEC §5.4 のヒント 6 語。`exclude` に {current, goal, 既出} を渡す。"""
    g = space.mat[goal_idx] if goal_vec is None else goal_vec
    v = (1.0 - HINT_RATIO) * space.mat[current_idx] + HINT_RATIO * g
    scores = space.mat @ v.astype(np.float32)
    out: list[int] = []
    for i in top_indices(scores, HINT_CANDIDATE_COUNT + len(exclude)):
        j = int(i)
        if j in exclude or j in (current_idx, goal_idx):
            continue
        out.append(j)
        if len(out) >= HINT_COUNT:
            break
    return out


# ── スタート語（SPEC §6.3）────────────────────────────────────
def start_candidates(
    space: OutputSpace,
    goal_idx: int,
    ng: tuple[set[str], set[str]],
    sims: np.ndarray | None = None,
) -> list[int]:
    """ゴールから見た rank が START_RANK_RANGE に入るスタート語候補。

    条件: 出力語彙 / freq_rank <= START_MAX_FREQ_RANK / 一般名詞 / 数字なし /
    NG 外 / ゴールと漢字を共有しない。
    """
    if sims is None:
        sims = goal_sims(space, goal_idx)
    lo, hi = START_RANK_RANGE
    ordered = top_indices(sims, hi + 1)
    band = ordered[lo : hi + 1]
    if band.size == 0:
        return []
    ok = (space.freq_rank[band] <= START_MAX_FREQ_RANK) & space.is_common_noun[band]
    band = band[ok]
    goal_word = space.words[goal_idx]
    out: list[int] = []
    for i in band.tolist():
        w = space.words[i]
        if has_digit(w) or shares_kanji(w, goal_word) or is_ng(w, ng):
            continue
        out.append(i)
    return out


def pick_starts(
    space: OutputSpace,
    goal_idx: int,
    count: int,
    rng: Random,
    ng: tuple[set[str], set[str]],
    sims: np.ndarray | None = None,
) -> list[int]:
    """スタート語を `count` 個、決定的に（`rng` のシード次第で）抽選する。"""
    cands = start_candidates(space, goal_idx, ng, sims=sims)
    if not cands:
        return []
    if len(cands) <= count:
        return cands
    return rng.sample(cands, count)

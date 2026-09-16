"""ヒント追従ボット（SPEC §6.2）と健全性チェック（SPEC §6.1）。

04_goal_pool.py の重い部分。ワーカープロセスからも import できるよう、
ファイル名を数字で始めずにここに分けてある（spawn したワーカーは
`04_goal_pool` を import できない）。

性能の要点:
- 行列は一度だけ正規化して mmap で共有（`_vectors.load_output_space`）。
- **5 本のスタートを同時に進める**。1 手あたり 5×6×3 = 最大 90 本の混合ベクトルを
  1 回の `M @ Q.T`（GEMM）に畳む。matvec を 90 回まわすより桁で速い。
- rank は argsort せず、ゴール類似度を一度だけ昇順ソートしておいて
  `searchsorted` で数える（O(log N)）。
"""

from __future__ import annotations

import hashlib
from random import Random
from typing import TypedDict

import numpy as np

from _common import has_digit, load_ng_words
from _constants import (
    BOT_MAX_MOVES,
    BOT_RATIOS,
    BOT_REJECT_MOVES,
    BOT_START_COUNT,
    CLEAR_RANK,
    DIFFICULTIES,
    DIFFICULTY_BOT_MOVES,
    GOAL_MAX_FREQ_RANK,
    GOAL_MIN_FREQ_RANK,
    GOAL_MIN_LEN,
    HEALTH_AFFIX_LEN,
    HEALTH_AFFIX_THRESHOLD,
    HEALTH_DIGIT_THRESHOLD,
    HEALTH_NEIGHBOR_COUNT,
    HINT_CANDIDATE_COUNT,
    HINT_COUNT,
    HINT_RATIO,
    NEAREST_CANDIDATES,
    VECTOR_DIM,
)
from _vectors import (
    OutputSpace,
    goal_sims,
    load_output_space,
    pick_starts,
    rank_of,
    top_indices,
    top_indices_batch,
)


class GoalRecord(TypedDict):
    """`data/goal_pool_progress.jsonl` の 1 行。"""

    word: str
    starts: list[str]
    runs: list[int | None]
    bot_moves: float | None
    difficulty: str | None
    review_needed: bool
    review_reasons: list[str]
    rejected: str | None


# ── 候補の抽出（SPEC §6.1）────────────────────────────────────
def goal_candidates(space: OutputSpace, ng: tuple[set[str], set[str]]) -> list[int]:
    """出力語彙・freq_rank 500〜30,000・一般名詞・2 文字以上・数字なし・NG 外。"""
    mask = (
        (space.freq_rank >= GOAL_MIN_FREQ_RANK)
        & (space.freq_rank <= GOAL_MAX_FREQ_RANK)
        & space.is_common_noun
    )
    out: list[int] = []
    for i in np.flatnonzero(mask).tolist():
        w = space.words[i]
        if len(w) < GOAL_MIN_LEN or has_digit(w):
            continue
        # 02_prune の時点で NG は除外済みだが、ng_words.txt は後から増やせるので再確認する。
        exact, substr = ng
        if w in exact or any(s in w for s in substr):
            continue
        out.append(i)
    return out


# ── 健全性チェック（SPEC §6.1）────────────────────────────────
def shares_affix(a: str, b: str, n: int = HEALTH_AFFIX_LEN) -> bool:
    """n 文字以上の接頭辞または接尾辞を共有するか。"""
    if a == b:
        return True
    if len(a) < n or len(b) < n:
        return False
    return a[:n] == b[:n] or a[-n:] == b[-n:]


def health_reasons(space: OutputSpace, goal_idx: int, sims: np.ndarray) -> list[str]:
    """`review_needed` を立てる理由。空なら問題なし。"""
    goal = space.words[goal_idx]
    top = top_indices(sims, HEALTH_NEIGHBOR_COUNT + 1).tolist()
    neighbors = [space.words[i] for i in top if i != goal_idx][:HEALTH_NEIGHBOR_COUNT]
    reasons: list[str] = []
    if sum(1 for w in neighbors if shares_affix(goal, w)) >= HEALTH_AFFIX_THRESHOLD:
        reasons.append("affix_cluster")
    if sum(1 for w in neighbors if has_digit(w)) >= HEALTH_DIGIT_THRESHOLD:
        reasons.append("digit_neighbors")
    return reasons


# ── ヒント追従ボット（SPEC §6.2）──────────────────────────────
def simulate_bot(
    space: OutputSpace,
    goal_idx: int,
    start_idxs: list[int],
    sims_goal: np.ndarray,
    sorted_goal: np.ndarray,
    avoid_revisit: bool = True,
) -> list[int | None]:
    """スタートごとのクリア手数。届かなければ None。

    ```
    state = start; moves = 0
    while moves < BOT_MAX_MOVES:
        hints = hint_words(state, goal)
        best  = argmin over (h, r) of rank(nearest(mix(state, h, r)), goal)
        state = best; moves += 1
        if rank(state, goal) <= CLEAR_RANK: return moves
    ```
    5 本のスタートを同時に進めて GEMM を 1 回に畳む。

    `avoid_revisit`（既定 True）は **SPEC の擬似コードからの意図的な逸脱**。
    素直に書くと 2 状態のループ（態度 ↔ 言動 のような）に落ちて 15 手を溶かす個体が
    多く、到達不能が水増しされる。一度通った語を result の候補から外すと解ける
    ゴールが増える（実測: 40 語中 1 → 3）。False で SPEC 通りの挙動になる。
    """
    mat = space.mat
    goal_vec = np.asarray(mat[goal_idx], dtype=np.float32)
    lanes = len(start_idxs)
    states = [int(s) for s in start_idxs]
    used: list[set[int]] = [{int(s), goal_idx} for s in start_idxs]
    visited: list[set[int]] = [{int(s)} for s in start_idxs]
    moves = [0] * lanes
    cleared: list[int | None] = [None] * lanes
    active = list(range(lanes))

    for _ in range(BOT_MAX_MOVES):
        if not active:
            break

        # 1) ヒント（SPEC §5.4）: v_hint = 0.8 * v_state + 0.2 * v_goal
        hint_vecs = np.empty((len(active), VECTOR_DIM), dtype=np.float32)
        for k, lane in enumerate(active):
            hint_vecs[k] = (1.0 - HINT_RATIO) * mat[states[lane]] + HINT_RATIO * goal_vec
        hint_scores = mat @ hint_vecs.T
        depth = HINT_CANDIDATE_COUNT + max(len(used[lane]) for lane in active) + 2
        hint_top = top_indices_batch(hint_scores, depth)

        lane_hints: list[list[int]] = []
        for k, lane in enumerate(active):
            picked: list[int] = []
            for i in hint_top[:, k].tolist():
                if i == states[lane] or i == goal_idx or i in used[lane]:
                    continue
                picked.append(i)
                if len(picked) >= HINT_COUNT:
                    break
            lane_hints.append(picked)

        # 2) 混合をまとめて 1 回の GEMM に畳む
        columns: list[np.ndarray] = []
        meta: list[tuple[int, int]] = []  # (lane, hint_idx)
        for k, lane in enumerate(active):
            v_state = mat[states[lane]]
            for h in lane_hints[k]:
                v_hint = mat[h]
                for ratio in BOT_RATIOS:
                    columns.append((1.0 - ratio) * v_state + ratio * v_hint)
                    meta.append((lane, h))
        if not columns:
            break
        mixed = np.asarray(columns, dtype=np.float32)
        scores = mat @ mixed.T
        depth_nearest = NEAREST_CANDIDATES + 2
        if avoid_revisit:
            depth_nearest += max(len(visited[lane]) for lane in active)
        nearest_top = top_indices_batch(scores, depth_nearest)

        # 3) レーンごとに rank 最小の手を選ぶ
        best: dict[int, tuple[int, float, int, int]] = {}
        for j, (lane, h) in enumerate(meta):
            result = -1
            for i in nearest_top[:, j].tolist():
                if i == states[lane] or i == h:
                    continue
                if avoid_revisit and i in visited[lane]:
                    continue
                result = i
                break
            if result < 0:
                continue
            sim = float(sims_goal[result])
            key = (rank_of(sorted_goal, sim), -sim)
            if lane not in best or key < best[lane][:2]:
                best[lane] = (key[0], key[1], result, h)

        still_active: list[int] = []
        for lane in active:
            if lane not in best:
                continue  # 打つ手がない = 到達不能（cleared は None のまま）
            rank, _neg_sim, result, hint = best[lane]
            states[lane] = result
            used[lane].add(hint)
            used[lane].add(result)
            visited[lane].add(result)
            moves[lane] += 1
            if rank <= CLEAR_RANK:
                cleared[lane] = moves[lane]
            else:
                still_active.append(lane)
        active = still_active

    return cleared


def classify(avg_moves: float) -> str | None:
    """平均手数 → 難易度。SPEC §6.2: Easy <= 4 / Normal 5〜7 / Hard 8〜12。"""
    for difficulty in DIFFICULTIES:
        if avg_moves <= DIFFICULTY_BOT_MOVES[difficulty][1]:
            return difficulty
    return None


def goal_seed(word: str) -> int:
    """語ごとに決定的な乱数シード（スタート語の抽選に使う）。"""
    return int.from_bytes(hashlib.sha256(word.encode("utf-8")).digest()[:8], "big")


def evaluate_goal(
    space: OutputSpace,
    goal_idx: int,
    ng: tuple[set[str], set[str]],
    avoid_revisit: bool = True,
) -> GoalRecord:
    word = space.words[goal_idx]
    sims = goal_sims(space, goal_idx)
    sorted_goal = np.sort(sims)
    reasons = health_reasons(space, goal_idx, sims)

    rng = Random(goal_seed(word))
    starts = pick_starts(space, goal_idx, BOT_START_COUNT, rng, ng, sims=sims)
    if len(starts) < BOT_START_COUNT:
        return GoalRecord(
            word=word,
            starts=[space.words[i] for i in starts],
            runs=[],
            bot_moves=None,
            difficulty=None,
            review_needed=bool(reasons),
            review_reasons=reasons,
            rejected="few_starts",
        )

    runs = simulate_bot(
        space, goal_idx, starts, sims, sorted_goal, avoid_revisit=avoid_revisit
    )
    record = GoalRecord(
        word=word,
        starts=[space.words[i] for i in starts],
        runs=runs,
        bot_moves=None,
        difficulty=None,
        review_needed=bool(reasons),
        review_reasons=reasons,
        rejected=None,
    )
    if any(r is None for r in runs):
        record["rejected"] = "unreachable"
        return record
    values = [r for r in runs if r is not None]
    if any(r >= BOT_REJECT_MOVES for r in values):
        record["rejected"] = "too_hard"
        return record
    avg = sum(values) / len(values)
    record["bot_moves"] = round(avg, 3)
    difficulty = classify(avg)
    if difficulty is None:
        record["rejected"] = "too_hard"
        return record
    record["difficulty"] = difficulty
    return record


# ── ワーカー（ProcessPoolExecutor）─────────────────────────────
_SPACE: OutputSpace | None = None
_NG: tuple[set[str], set[str]] | None = None
_AVOID_REVISIT = True


def init_worker(avoid_revisit: bool = True) -> None:
    """spawn されたワーカーの初期化。行列は mmap なので実メモリは共有される。"""
    global _SPACE, _NG, _AVOID_REVISIT
    _SPACE = load_output_space(mmap=True)
    _NG = load_ng_words()
    _AVOID_REVISIT = avoid_revisit


def worker_evaluate(goal_idx: int) -> GoalRecord:
    if _SPACE is None or _NG is None:
        init_worker()
    assert _SPACE is not None and _NG is not None
    return evaluate_goal(_SPACE, goal_idx, _NG, avoid_revisit=_AVOID_REVISIT)


__all__ = [
    "GoalRecord",
    "classify",
    "evaluate_goal",
    "goal_candidates",
    "health_reasons",
    "init_worker",
    "shares_affix",
    "simulate_bot",
    "worker_evaluate",
]

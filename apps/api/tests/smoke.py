#!/usr/bin/env python3
"""API のスモークテスト。ローカルの dev サーバーに対して 1 ゲーム通す。

使い方: uv run --no-project --with httpx python apps/api/tests/smoke.py [BASE_URL]
       もしくは python3 apps/api/tests/smoke.py（標準ライブラリのみ）
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787"
TOKEN: str | None = None


def call(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    # レート制限（5 req/s）に引っかからないよう間隔を空ける
    time.sleep(0.25)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{urllib.parse.quote(path, safe='/?=&')}", data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def timed(label: str, fn):
    t0 = time.time()
    status, body = fn()
    ms = (time.time() - t0) * 1000
    print(f"  {label:<28} {status}  {ms:>7.0f}ms")
    return status, body, ms


def main() -> int:
    global TOKEN
    failures: list[str] = []

    def check(cond: bool, msg: str) -> None:
        if not cond:
            failures.append(msg)
            print(f"    ✗ {msg}")

    print(f"=== coto2ba API smoke test @ {BASE} ===")

    status, body, _ = timed("GET  /api/health", lambda: call("GET", "/api/health"))
    check(status == 200 and body.get("ok"), "health が 200 を返さない")

    status, body, _ = timed("POST /api/devices", lambda: call("POST", "/api/devices"))
    check(status == 200 and "token" in body, "device token が発行されない")
    TOKEN = body.get("token")
    print(f"    display_name = {body.get('display_name')}")

    status, me, _ = timed("GET  /api/me", lambda: call("GET", "/api/me"))
    check(status == 200 and me.get("display_name"), "/api/me が名前を返さない")

    status, unauth, _ = timed(
        "GET  /api/me (認証なし)", lambda: _without_token("GET", "/api/me")
    )
    check(unauth.get("code") == "UNAUTHORIZED", "認証なしで 401 にならない")

    status, game, _ = timed(
        "POST /api/games free",
        lambda: call("POST", "/api/games", {"mode": "free", "difficulty": "normal"}),
    )
    check(status == 200 and "id" in game, f"ゲームを作れない: {game}")
    if "id" not in game:
        return report(failures)
    gid, goal, start = game["id"], game["goal"], game["start"]
    print(f"    goal={goal}  start={start}  rank={game['current_rank']}")
    check(3000 <= game["current_rank"] <= 30000, "start の rank が規定レンジ外")

    status, sh, _ = timed(
        "POST shuffle-start", lambda: call("POST", f"/api/games/{gid}/shuffle-start")
    )
    check(status == 200 and sh.get("start") != start, "start を引き直せない")

    status, hints, hint_ms = timed(
        "POST /hints", lambda: call("POST", f"/api/games/{gid}/hints")
    )
    check(status == 200 and len(hints.get("hints", [])) == 6, f"ヒントが 6 語でない: {hints}")
    check(hints.get("hint_count") == 1, "hint_count が増えない")
    print(f"    hints = {' / '.join(hints.get('hints', []))}")

    status, hints2, _ = timed(
        "POST /hints（2回目・同じ語）", lambda: call("POST", f"/api/games/{gid}/hints")
    )
    check(hints2.get("hints") == hints.get("hints"), "同じ current で違うヒントが出る")
    check(hints2.get("hint_count") == 2, "2 回目で hint_count が 2 にならない")

    # 禁止入力
    status, err, _ = timed(
        "POST /moves（goal 入力）",
        lambda: call("POST", f"/api/games/{gid}/moves", {"input_word": goal, "ratio": 0.5}),
    )
    check(err.get("code") == "GOAL_INPUT", f"goal 入力が弾かれない: {err}")

    cur = sh.get("current", start)
    status, err, _ = timed(
        "POST /moves（current と同じ）",
        lambda: call("POST", f"/api/games/{gid}/moves", {"input_word": cur, "ratio": 0.5}),
    )
    check(err.get("code") == "SAME_AS_CURRENT", f"current 入力が弾かれない: {err}")

    status, err, _ = timed(
        "POST /moves（不正な ratio）",
        lambda: call("POST", f"/api/games/{gid}/moves", {"input_word": "光", "ratio": 0.35}),
    )
    check(
        err.get("code") in ("INVALID_RATIO", "VALIDATION"),
        f"8 段階以外の ratio が通る: {err}",
    )

    status, err, _ = timed(
        "POST /moves（辞書に無い語）",
        lambda: call(
            "POST", f"/api/games/{gid}/moves", {"input_word": "ぎゃぴぴぴ", "ratio": 0.5}
        ),
    )
    check(err.get("code") == "OOV", f"OOV が弾かれない: {err}")

    # 実際に打つ
    move_times = []
    words = ["光", "海", "夜", "星", "船", "岬", "岩", "港"]
    prev_rank = sh.get("current_rank", game["current_rank"])
    for i, w in enumerate(words):
        status, mv, ms = timed(
            f"POST /moves #{i + 1}  {w} x0.5",
            lambda w=w: call(
                "POST", f"/api/games/{gid}/moves", {"input_word": w, "ratio": 0.5}
            ),
        )
        if status != 200:
            if mv.get("code") in ("SAME_AS_CURRENT", "GOAL_INPUT"):
                continue
            check(False, f"move が失敗: {mv}")
            break
        move_times.append(ms)
        print(
            f"    -> {mv['result']}  rank={mv['rank']} ({mv['tier']})  "
            f"prev={mv['prev_rank']}  status={mv['status']}"
        )
        check(mv["prev_rank"] == prev_rank, "prev_rank が前手の rank と一致しない")
        prev_rank = mv["rank"]
        if mv["status"] != "playing":
            break

    # キャッシュが効いているか（同じ盤面を別ゲームで再現）
    status, g2, _ = timed(
        "POST /api/games（2 ゲーム目）",
        lambda: call("POST", "/api/games", {"mode": "free", "difficulty": "normal"}),
    )

    status, detail, _ = timed("GET  /api/games/:id", lambda: call("GET", f"/api/games/{gid}"))
    check(status == 200 and "moves" in detail, "ゲーム詳細に moves が無い")
    check(len(detail.get("moves", [])) == len(move_times), "moves の件数が合わない")

    status, coll, _ = timed("GET  /api/collection", lambda: call("GET", "/api/collection"))
    check(status == 200 and len(coll.get("encounters", [])) > 0, "図鑑が空")

    status, ach, _ = timed("GET  /api/achievements", lambda: call("GET", "/api/achievements"))
    check(status == 200 and len(ach.get("achievements", [])) == 12, "実績が 12 個でない")
    unlocked = [a["id"] for a in ach.get("achievements", []) if a["unlocked_at"]]
    print(f"    解除済み: {unlocked}")

    status, lb, _ = timed(
        "GET  /api/leaderboard/daily", lambda: call("GET", "/api/leaderboard/daily")
    )
    check(status == 200, "ランキングが取れない")

    status, tr, _ = timed("POST /api/transfer", lambda: call("POST", "/api/transfer"))
    check(status == 200 and len(tr.get("token", "")) == 32, "引き継ぎトークンが 32 文字でない")

    status, wd, _ = timed(
        "GET  /api/words/:w/description", lambda: call("GET", f"/api/words/{goal}/description")
    )
    check(status == 200, "説明エンドポイントが落ちる")
    print(f"    {goal}: {str(wd.get('text'))[:60]}")

    status, gu, _ = timed("POST /give-up", lambda: call("POST", f"/api/games/{gid}/give-up"))
    check(
        status in (200, 409),
        "ギブアップが失敗（すでに終了しているなら 409 で正しい）",
    )

    if move_times:
        move_times.sort()
        p95 = move_times[int(len(move_times) * 0.95) - 1] if len(move_times) > 1 else move_times[0]
        print(f"\n  1 手の応答: 中央値 {move_times[len(move_times) // 2]:.0f}ms / p95 {p95:.0f}ms")
        check(p95 < 1000, f"1 手の p95 が 1 秒を超えている: {p95:.0f}ms")

    return report(failures)


def _without_token(method: str, path: str) -> tuple[int, dict]:
    global TOKEN
    saved, TOKEN = TOKEN, None
    try:
        return call(method, path)
    finally:
        TOKEN = saved


def report(failures: list[str]) -> int:
    print()
    if failures:
        print(f"❌ {len(failures)} 件の失敗:")
        for f in failures:
            print(f"   - {f}")
        return 1
    print("✅ すべて通過")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""負荷試験（SPEC §11.4）。POST /moves を 5 req/s × N 秒、p95 < 500ms を確認する。

レート制限がユーザーごと 5 req/s なので、仮想ユーザーを複数作って分散させる。

使い方:
    python3 apps/api/tests/load.py [BASE_URL] [--seconds 300] [--rps 5] [--users 10]
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

MIX_WORDS = [
    "光", "海", "夜", "星", "船", "岩", "港", "火", "風", "山",
    "川", "空", "土", "石", "森", "鳥", "花", "雪", "雲", "月",
]
RATIOS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7]


def call(base: str, path: str, token: str | None, body: dict | None = None) -> tuple[int, dict, float]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{base}{path}", data=data, method="POST" if data else "GET")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=40) as res:
            return res.status, json.loads(res.read().decode() or "{}"), (time.time() - t0) * 1000
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or "{}"), (time.time() - t0) * 1000
        except json.JSONDecodeError:
            return e.code, {"raw": raw[:120]}, (time.time() - t0) * 1000
    except Exception as e:  # noqa: BLE001
        return 0, {"error": str(e)[:120]}, (time.time() - t0) * 1000


class VirtualUser:
    def __init__(self, base: str, index: int) -> None:
        self.base = base
        self.index = index
        self.token: str | None = None
        self.game_id: str | None = None
        self.seq = 0

    def setup(self) -> bool:
        st, body, _ = call(self.base, "/api/devices", None, {})
        if st != 200:
            return False
        self.token = body["token"]
        return self.new_game()

    def new_game(self) -> bool:
        st, body, _ = call(
            self.base, "/api/games", self.token, {"mode": "free", "difficulty": "normal"}
        )
        if st != 200:
            return False
        self.game_id = body["id"]
        return True

    def move(self) -> tuple[int, float]:
        word = MIX_WORDS[(self.index * 7 + self.seq * 3) % len(MIX_WORDS)]
        ratio = RATIOS[(self.index + self.seq) % len(RATIOS)]
        self.seq += 1
        st, body, ms = call(
            self.base,
            f"/api/games/{self.game_id}/moves",
            self.token,
            {"input_word": word, "ratio": ratio},
        )
        # ゲームが終わったら新しいゲームを作る（計測には含めない）
        if st == 200 and body.get("status") != "playing":
            self.new_game()
        elif st == 409:
            self.new_game()
        return st, ms


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?", default="http://localhost:8787")
    ap.add_argument("--seconds", type=int, default=300)
    ap.add_argument("--rps", type=float, default=5.0)
    ap.add_argument("--users", type=int, default=10)
    ap.add_argument("--p95", type=float, default=500.0, help="p95 の許容上限(ms)")
    args = ap.parse_args()

    print(f"=== 負荷試験 {args.base} / {args.rps} req/s × {args.seconds}s / 仮想ユーザー {args.users} ===")
    print("セットアップ中…", flush=True)

    users: list[VirtualUser] = []
    with ThreadPoolExecutor(max_workers=args.users) as pool:
        made = list(pool.map(lambda i: VirtualUser(args.base, i), range(args.users)))
        oks = list(pool.map(lambda u: u.setup(), made))
    users = [u for u, ok in zip(made, oks, strict=True) if ok]
    if not users:
        print("❌ 仮想ユーザーを作れませんでした")
        return 1
    print(f"仮想ユーザー {len(users)} 人 準備完了\n")

    latencies: list[float] = []
    statuses: dict[int, int] = {}
    lock = threading.Lock()
    stop_at = time.time() + args.seconds
    interval = 1.0 / args.rps
    n = 0

    def fire(u: VirtualUser) -> None:
        st, ms = u.move()
        with lock:
            statuses[st] = statuses.get(st, 0) + 1
            if st == 200:
                latencies.append(ms)

    with ThreadPoolExecutor(max_workers=args.users * 2) as pool:
        next_at = time.time()
        while time.time() < stop_at:
            pool.submit(fire, users[n % len(users)])
            n += 1
            next_at += interval
            sleep = next_at - time.time()
            if sleep > 0:
                time.sleep(sleep)
            if n % 50 == 0:
                with lock:
                    done = len(latencies)
                    p50 = statistics.median(latencies) if latencies else 0
                print(f"  {n:>5} 投入 / {done:>5} 成功 / 中央値 {p50:>6.0f}ms", flush=True)

    time.sleep(3)

    print("\n=== 結果 ===")
    print(f"  投入        {n}")
    for st in sorted(statuses):
        label = "成功" if st == 200 else ("レート制限" if st == 429 else "エラー")
        print(f"  status {st or 'conn-fail':<9} {statuses[st]:>5}  ({label})")

    if not latencies:
        print("\n❌ 成功したリクエストがありません")
        return 1

    latencies.sort()

    def pct(p: float) -> float:
        return latencies[min(len(latencies) - 1, int(len(latencies) * p))]

    print(f"\n  中央値   {statistics.median(latencies):>7.0f}ms")
    print(f"  p95      {pct(0.95):>7.0f}ms")
    print(f"  p99      {pct(0.99):>7.0f}ms")
    print(f"  最大     {latencies[-1]:>7.0f}ms")

    errors = sum(c for st, c in statuses.items() if st not in (200, 429))
    ok = True
    if pct(0.95) > args.p95:
        print(f"\n❌ p95 が {args.p95:.0f}ms を超えている")
        ok = False
    if errors:
        print(f"\n❌ エラーが {errors} 件")
        ok = False
    if ok:
        print(f"\n✅ p95 < {args.p95:.0f}ms / エラー 0")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

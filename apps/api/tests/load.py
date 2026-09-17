#!/usr/bin/env python3
"""負荷試験（SPEC §11.4 / §9）。

--scenario moves（既定）
    POST /moves を 5 req/s × N 秒、p95 < 500ms を確認する。
    レート制限がユーザーごと 5 req/s なので、仮想ユーザーを複数作って分散させる。

--scenario room
    **ブースの最悪ケース**を模す。8 人が 1 部屋に入り、全員が 1 秒ポーリングしながら
    手を打つ。ここで見たいのは p95 だけではなく **429 が 1 件も出ないこと**。
    ポーリング（GET /api/rooms/:code）は専用バケツ、手（POST /moves）は汎用バケツで、
    2 つが分かれていなければここで必ず 429 が出る。

使い方:
    python3 apps/api/tests/load.py [BASE_URL] [--seconds 300] [--rps 5] [--users 10]
    python3 apps/api/tests/load.py --scenario room [--seconds 60] [--users 8]
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

# サーバーが正しく拒否した応答（障害ではない）。
# 409 GAME_FINISHED / 422 は禁止入力（TOO_CLOSE_TO_GOAL・SAME_AS_CURRENT・GOAL_INPUT）。
EXPECTED_GAME_STATUSES = (409, 422)

MIX_WORDS = [
    "光", "海", "夜", "星", "船", "岩", "港", "火", "風", "山",
    "川", "空", "土", "石", "森", "鳥", "花", "雪", "雲", "月",
]
RATIOS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7]

# --scenario room。**packages/contracts/src/constants.ts と揃えること**
# （ROOM_POLL_INTERVAL_MS / ROOM_MAX_PLAYERS）。
POLL_INTERVAL_S = 1.0
# 何回ポーリングするごとに 1 手打つか。人は毎秒は打たない。
MOVE_EVERY = 4


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
        elif st in EXPECTED_GAME_STATUSES:
            # 409 = 終了済みのゲームに打った / 422 = 禁止入力（ゴール近傍・現在語と同じ）。
            # どちらもサーバーの**正しい応答**であって障害ではない。
            # 負荷試験は同じゲームに並行して打つので構造的に起きる。
            self.new_game()
        return st, ms


# ── 対戦ルーム（--scenario room）────────────────────────────────────────────

class RoomPlayer:
    """部屋に入って、ポーリングしながら手を打つ 1 人。"""

    def __init__(self, base: str, index: int) -> None:
        self.base = base
        self.index = index
        self.token: str | None = None
        self.game_id: str | None = None
        self.seq = 0

    def sign_in(self) -> bool:
        st, body, _ = call(self.base, "/api/devices", None, {})
        if st != 200:
            return False
        self.token = body["token"]
        return True

    def create_room(self) -> str | None:
        st, body, _ = call(self.base, "/api/rooms", self.token, {"difficulty": "normal"})
        return body.get("code") if st == 200 else None

    def join(self, code: str) -> bool:
        st, _, _ = call(self.base, f"/api/rooms/{code}/join", self.token, {})
        return st == 200

    def start(self, code: str) -> bool:
        st, body, _ = call(self.base, f"/api/rooms/{code}/start", self.token, {})
        if st == 200:
            self.game_id = body.get("my_game_id")
        return st == 200

    def pull_game_id(self, code: str) -> None:
        st, body, _ = call(self.base, f"/api/rooms/{code}", self.token)
        if st == 200:
            self.game_id = body.get("my_game_id")

    def poll(self, code: str) -> tuple[int, float]:
        st, _, ms = call(self.base, f"/api/rooms/{code}", self.token)
        return st, ms

    def move(self) -> tuple[int, float]:
        if self.game_id is None:
            return 0, 0.0
        word = MIX_WORDS[(self.index * 7 + self.seq * 3) % len(MIX_WORDS)]
        ratio = RATIOS[(self.index + self.seq) % len(RATIOS)]
        self.seq += 1
        st, _, ms = call(
            self.base,
            f"/api/games/{self.game_id}/moves",
            self.token,
            {"input_word": word, "ratio": ratio},
        )
        return st, ms


def run_room(base: str, seconds: int, users: int, p95_limit: float) -> int:
    print(f"=== 対戦ルーム負荷試験 {base} / {users} 人 × {seconds}s ===")
    print("セットアップ中…", flush=True)

    players = [RoomPlayer(base, i) for i in range(users)]
    with ThreadPoolExecutor(max_workers=users) as pool:
        oks = list(pool.map(lambda p: p.sign_in(), players))
    players = [p for p, ok in zip(players, oks, strict=True) if ok]
    if len(players) < 2:
        print("❌ 仮想プレイヤーを作れませんでした")
        return 1

    host = players[0]
    code = host.create_room()
    if code is None:
        print("❌ 部屋を作れませんでした")
        return 1
    # 参加は汎用バケツを使うので、一斉に投げると自分たちで 429 を作ってしまう。
    # 会場でも QR を読む速さは人によってばらつくので、少しずらして投げる。
    for p in players[1:]:
        if not p.join(code):
            print(f"❌ 参加できませんでした（{p.index}）")
            return 1
        time.sleep(0.25)
    if not host.start(code):
        print("❌ 開始できませんでした")
        return 1
    for p in players[1:]:
        p.pull_game_id(code)
        time.sleep(0.15)
    print(f"部屋 {code} / {len(players)} 人 準備完了\n")

    poll_ms: list[float] = []
    move_ms: list[float] = []
    statuses: dict[str, dict[int, int]] = {"poll": {}, "move": {}}
    lock = threading.Lock()
    stop_at = time.time() + seconds

    def record(kind: str, st: int, ms: float) -> None:
        with lock:
            bucket = statuses[kind]
            bucket[st] = bucket.get(st, 0) + 1
            if st == 200:
                (poll_ms if kind == "poll" else move_ms).append(ms)

    def live(p: RoomPlayer) -> None:
        """1 人ぶんの振る舞い。毎秒ポーリングし、MOVE_EVERY 回に 1 度手を打つ。"""
        tick = 0
        # 全員が同じ瞬間に投げないよう、開始をずらす（会場でも揃わない）。
        time.sleep(p.index * (POLL_INTERVAL_S / max(len(players), 1)))
        while time.time() < stop_at:
            record("poll", *p.poll(code))
            tick += 1
            if tick % MOVE_EVERY == 0:
                st, ms = p.move()
                if st != 0:
                    record("move", st, ms)
            time.sleep(POLL_INTERVAL_S)

    with ThreadPoolExecutor(max_workers=len(players)) as pool:
        list(pool.map(live, players))

    print("\n=== 結果 ===")
    rate_limited = 0
    for kind, label in (("poll", "ポーリング GET /api/rooms/:code"), ("move", "手 POST /moves")):
        print(f"\n  {label}")
        for st in sorted(statuses[kind]):
            note = {
                200: "成功",
                429: "レート制限",
                409: "正しい拒否（障害ではない）",
                422: "正しい拒否（障害ではない）",
            }.get(st, "エラー")
            print(f"    status {st or 'conn-fail':<9} {statuses[kind][st]:>5}  ({note})")
            if st == 429:
                rate_limited += statuses[kind][st]

    ok = True
    for name, samples in (("ポーリング", poll_ms), ("手", move_ms)):
        if not samples:
            print(f"\n❌ {name}の成功が 1 件もありません")
            ok = False
            continue
        samples.sort()
        p95 = samples[min(len(samples) - 1, int(len(samples) * 0.95))]
        print(f"\n  {name}  中央値 {statistics.median(samples):.0f}ms / p95 {p95:.0f}ms")
        if p95 > p95_limit:
            print(f"❌ {name}の p95 が {p95_limit:.0f}ms を超えている")
            ok = False

    errors = sum(
        c
        for kind in statuses
        for st, c in statuses[kind].items()
        if st not in (200, 429, *EXPECTED_GAME_STATUSES)
    )
    if errors:
        print(f"\n❌ エラーが {errors} 件")
        ok = False
    if rate_limited:
        # ここが出たらバケツの分離が壊れている。展示中は「たまに手が打てない」形で出る。
        print(f"\n❌ 429 が {rate_limited} 件（ポーリングと手のバケツが分かれていない）")
        ok = False
    if ok:
        print(f"\n✅ 429 なし / エラー 0 / p95 < {p95_limit:.0f}ms")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?", default="http://localhost:8787")
    ap.add_argument("--seconds", type=int, default=300)
    ap.add_argument("--rps", type=float, default=5.0)
    ap.add_argument("--users", type=int, default=10)
    ap.add_argument("--p95", type=float, default=500.0, help="p95 の許容上限(ms)")
    ap.add_argument(
        "--scenario",
        choices=("moves", "room"),
        default="moves",
        help="moves = 1 人用の連打 / room = 8 人が 1 部屋でポーリングしながら打つ",
    )
    args = ap.parse_args()

    if args.scenario == "room":
        return run_room(args.base, args.seconds, args.users, args.p95)

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
        if st == 200:
            label = "成功"
        elif st == 429:
            label = "レート制限"
        elif st in EXPECTED_GAME_STATUSES:
            label = "正しい拒否（障害ではない）"
        else:
            label = "エラー"
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

    errors = sum(
        c for st, c in statuses.items() if st not in (200, 429, *EXPECTED_GAME_STATUSES)
    )
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

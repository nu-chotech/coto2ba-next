"""ローカル DB で計算済みの `vocab.pos3` を、別の DB（本番想定）にバックフィルする（SPEC §3.2）。

本番 Neon の `vocab.pos3` は 102,520 語すべて NULL（`06_umap_coords.py` は容量に
余裕のあるローカルでしか回していない）。図鑑（`GET /api/collection` /
`GET /api/words/ghosts`）は `pos3 IS NOT NULL` で絞るため、NULL のままだと
クリアしても「まだ語に出会っていません」から進まない（実際に起きた）。

Neon Free は 512MB 中 318MB 使用済みで、102,520 行の一括 UPDATE は死んだタプルで
容量を食い切る危険がある。**`--batch-size` ごとに UPDATE → VACUUM** を回し、
バッチの後に `pg_database_size` を確認して `--max-bytes` を超えたら中断する。

冪等: 常に `WHERE v.pos3 IS NULL` で絞るので、`--max-bytes` で中断しても
再実行すれば続きから進む。

**`--target` に既定値は無い（本番を既定にしない）。** 本番に流すときは呼び出し側が
明示的に本番の接続文字列（Neon の `DATABASE_URL_DIRECT`）を渡すこと。

**このスクリプトは vocab を新規作成しない。** `--target` が空の DB / 別プロジェクト /
`word` の正規化がずれた環境を誤って指していた場合に「対象 0 件 = 完了」と誤報告して
サイレントに成功したように見えてしまう事故（レビュー Round 1・2・3 指摘）を防ぐため、
書き込み・一時テーブル作成の前に必ず 2 段のチェックを通す:

1. `ensure_target_sane`: `vocab` テーブルが存在すること（`to_regclass`）。
2. `count_intersection` / `required_intersection_count`: ソースの語と target の
   `vocab.word` の交差が **`MIN_INTERSECTION_RATIO`（既定 50%）以上**あること。
   「1 語でも一致すれば OK」（Round 2）だと、たまたま 1 語だけ同名の語を含む
   全く無関係な DB を見逃してしまうため、割合のしきい値にした（Round 3 レビュー指摘）。
   下回るなら「別プロジェクト / 別環境を指している」「`word` の正規化がずれて
   いる」のどちらかが濃厚なので、`missing == 0` を「完了」と誤解する前に
   ここで非ゼロ終了する。

**行数のしきい値比較はしない**（Round 1 では `total < len(rows)` を見ていたが、
本番の行数と `len(rows)` がほぼ同じ値になる想定のため、ローカルの語彙が少し増えるだけで
正当な本番実行まで拒否してしまう。上記の交差チェックのほうが正確で、
かつローカルの語彙が増減しても揺らがない）。

**`--dry-run` は target に一切書き込まない。** 一時テーブルの作成・COPY も行わず、
渡されたソースの語リストを `word = ANY(...)` で直接読むだけにしてある
（上記 2 段のチェックも dry-run 経路で同じように効く）。

**`--batch-size` は 1 以上を argparse で強制する。** `0` を許すと 1 行も
更新しないまま「完了」と誤報告して exit 0 になる穴があった（Round 3 レビュー指摘）。
バッチループを抜けた後にも「1 行も更新していないのに未処理が残っている」状態を
検知したら非ゼロ終了する防御線を置いている。

**`VACUUM vocab` が無言でスキップされたら警告する。** target のロールが `vocab`
の所有者でないと、`VACUUM` はエラーにならず `WARNING: permission denied to vacuum
"vocab", skipping it` という NOTICE を出すだけで何もしない。psycopg の notice
ハンドラで検知し、バッチごと・完了時にまとめて警告を出す（Round 3 レビュー指摘。
`--max-bytes` のバックストップがあるので容量的には完走できるため、処理は止めない）。

**pooled 接続（ホスト名に `-pooler` を含む）は既定で拒否する。** 一時テーブルは
セッションに紐づくため、コネクションプーラ越しだと接続の使い回しで意図せず
消える恐れがある。本番で一度しか打たない操作なので機械的に弾く
（どうしても使うなら `--allow-pooled`）。**接続文字列から host が特定できない
場合（`urlparse` が拾えない libpq keyword=value 形式など）も同じフラグで
安全側に倒して拒否する**（Round 3 レビュー指摘: 旧実装は `urlparse().hostname`
が `None` になる形式を無条件に素通りしていた）。

**接続先を起動時に表示する（S-1・Round 4 レビュー指摘）。** `host=... db=...` の
形でホスト名とデータベース名を必ず出力する（パスワードは絶対に出さない）。
`--target` が「本番ではないが別のバックフィル済み DB」を指していると、
交差はほぼ 100% のまま対象だけ 0 件になる。**「対象 0 件」を「完了している」と
断定せず**、接続先を確認するよう促すメッセージで**非ゼロ終了**する
（dry-run・本実行のどちらでも）。「自分が書いた（完了）」と「自分は何もしていない
（対象が無い）」は別の状態なので、同じ成功として扱わない。

**ソース側にも下限を設ける（S-2・Round 4 レビュー指摘）。** ローカル DB の
pos3 あり語数が `MIN_SOURCE_WORD_COUNT` を下回ったら中断する。ローカル DB が
壊れている、またはパイプラインが中途半端な状態（`02_prune` や
`06_umap_coords` の再実行中など）だと、ごく少数の語だけを「対象」として
処理し尽くして「完了」と報告してしまう穴があった。

**未処理が残っているなら、何行書けていようと非ゼロで終了する（S-3・Round 4
レビュー指摘）。** Round 3 は `processed == 0` のときしか見ておらず、
「何行か書けたが全部は終わっていない」場合を見逃していた。正常終了は
`remaining == 0` のときだけとし、`--max-bytes` による意図的な中断（exit 1）とは
別の終了コード（`EXIT_INCOMPLETE` = 3）で区別する。

一時テーブル経由でまとめて読み込み、バッチの切り出しは DB 側の
`WHERE pos3 IS NULL LIMIT --batch-size` に任せる（1 行ずつの UPDATE は遅すぎる。
`06_umap_coords.py` と同様に一時テーブルは autocommit 前提で手動 DROP する）。

使い方:
    # 対象件数だけ確認する（target には一切書き込まない）
    uv run python scripts/12_backfill_pos3.py --target postgresql://... --dry-run

    # 本番に流す（呼び出し側が明示的に接続文字列を渡す。pooled は既定で拒否）
    uv run python scripts/12_backfill_pos3.py --target postgresql://...
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import database_url  # noqa: E402
from _constants import N_OUTPUT  # noqa: E402
from _db import connect  # noqa: E402

DEFAULT_BATCH_SIZE = 5_000
DEFAULT_MAX_BYTES = 480 * 1024 * 1024
# ソース（ローカル DB の pos3）を丸ごと読み込む一時テーブル名。
SOURCE_LOAD_TABLE = "pos3_backfill_source"

# ソースの語のうち、target で実際に見つかった語の割合がこの値未満なら、
# target が別プロジェクト / 別環境である疑いとして中断する（Round 3 レビュー指摘）。
# 本番の vocab はソースと同じ語彙セットを共有している前提なので、正当な target なら
# 交差はほぼ 100%（実測: 102,520/102,520）になるはずである。「1 語でも一致すれば OK」
# （Round 2 実装）だと、たまたま 1 語だけ同名の語を含む全く無関係な DB を見逃してしまう。
# 0.5（50%）は「ローカルの語彙が多少ズレていても正当な実行は通す」ために十分低く、
# かつ「別プロジェクトなど根本的に無関係な DB（一致率は 0 に近い）」を確実に弾ける
# 値として選んだ（実測の一致率 99% 超に対して十分な安全マージンがある）。
MIN_INTERSECTION_RATIO = 0.5

# ソース（ローカル DB）の pos3 あり語数がこれを下回ったら中断する（Round 4 レビュー指摘）。
# 「pos3 が 2 語しかないソース」のような、ローカル DB が壊れている／02_prune や
# 06_umap_coords がまだ完走していない中途半端な状態を検知するための下限。
# 本番の実測値は `N_OUTPUT`（102,520 語）なので、その半分を下限にした。
# 半分より多く欠けることは通常の運用では起きないはずで、かつ将来 02_prune の
# 閾値が多少変わっても誤検知しない程度の余裕を持たせている。
MIN_SOURCE_WORD_COUNT = N_OUTPUT // 2

# 「バッチが終わったのに未処理が残っている」という想定外の状態の終了コード（Round 4
# レビュー指摘）。--max-bytes による意図的な中断（exit 1）と混同されないよう、
# 明確に別の値にしてある。
EXIT_INCOMPLETE = 3


#  `host='...'` / `host="..."` / `host=...`（空白まで）のいずれにもマッチする。
# `key` を差し替えれば `dbname=...` など他の libpq キーワードにも使える。
def _extract_libpq_value(url: str, key: str) -> str | None:
    """libpq の keyword=value 形式接続文字列から特定のキーの値を取り出す（ベストエフォート）。"""
    pattern = re.compile(rf"(?:^|\s){re.escape(key)}=(?:'([^']*)'|\"([^\"]*)\"|(\S+))", re.IGNORECASE)
    match = pattern.search(url)
    if match:
        return next((g for g in match.groups() if g is not None), None)
    return None


def resolve_host(url: str) -> str | None:
    """接続文字列からホスト名を取り出す。特定できなければ `None`。

    `postgres://` / `postgresql://` の URI 形式は `urlparse().hostname` に任せる。
    **libpq の keyword=value 形式**（`host=... dbname=... user=...`）は
    `urlparse` がホストを拾えず（`.hostname` が `None` になる）、pooled ガードを
    無条件に素通りしてしまっていた（Round 3 レビュー指摘）。ここで両方に対応する。
    """
    parsed = urlparse(url)
    if parsed.hostname:
        return parsed.hostname
    return _extract_libpq_value(url, "host")


def describe_target(url: str) -> str:
    """接続先を `host=... db=...` の形で表示用に整形する。**パスワードは絶対に含めない**。

    Round 4 レビュー指摘（S-1）: このスクリプトは接続先を一切表示しておらず、
    `--target` が「本番ではないが別のバックフィル済み DB」を指していても
    気づく手段が無かった。起動時と「対象 0 件」のメッセージの両方で使う。
    """
    host = resolve_host(url)
    parsed = urlparse(url)
    # scheme + netloc が無い（= URI 形式ではない）ときに `.path` を使うと、
    # keyword=value 形式の文字列全体がそのまま迷い込むので使わない。
    dbname = parsed.path.lstrip("/") or None if parsed.scheme and parsed.netloc else None
    if dbname is None:
        dbname = _extract_libpq_value(url, "dbname")
    return f"host={host or '(不明)'} db={dbname or '(不明)'}"


def _zero_target_message(url: str) -> str:
    """S-1（Round 4 レビュー指摘）: 対象 0 件を「完了」と断定しないための文言。

    target が「別の完了済み DB」を誤って指していても、交差はほぼ 100% のまま
    対象だけ 0 件になり、これまでの実装は「すでに完了しています」と exit 0 で
    片付けていた。「自分が書いた（完了）」と「自分は何もしていない（対象が無い）」は
    別の状態なので、同じ成功として扱わず、必ず人間の確認を挟ませる。
    """
    return (
        "対象が 0 件です。「完了している」とは断定できません"
        "（接続先を取り違えている場合も同じ 0 件になります）。"
        f" 接続先が意図したものか確認してください（{describe_target(url)}）。"
    )


def is_pooled_host(url: str) -> bool:
    """Neon の pooled 接続（ホスト名に `-pooler` を含む）かどうか。

    pooled 接続はコネクションの使い回しがあるため、セッションに紐づく一時テーブルが
    意図せず失われる恐れがある。本番で一度しか打たない操作なので機械的に弾く
    （どうしても使うなら `--allow-pooled`）。

    **ホスト名だけを見る**（URL 文字列全体の部分一致にすると、パスワードや DB 名に
    たまたま `-pooler` が含まれる正当な unpooled URL まで誤検知するため。Round 2 レビュー指摘）。

    ホストが特定できない場合は `False` を返す（＝ pooled とは判定しない）。
    その代わり、呼び出し側（`main()`）が `resolve_host` の結果そのものを見て、
    「ホスト不明」を pooled とは別の理由として安全側に倒して拒否する。
    """
    host = resolve_host(url)
    if host is None:
        return False
    return "-pooler" in host.lower()


def fetch_source_rows(source_url: str) -> list[tuple[str, list[float]]]:
    """ローカル DB から (word, pos3) を `pos3 IS NOT NULL` に絞って読む。"""
    with connect(source_url) as conn:
        rows = conn.execute("SELECT word, pos3 FROM vocab WHERE pos3 IS NOT NULL").fetchall()
    return [(word, list(pos3)) for word, pos3 in rows]


def ensure_target_sane(conn: psycopg.Connection) -> None:
    """target に `vocab` テーブルが存在することを、書き込み・一時テーブル作成の前に確認する。

    以前の実装は `ensure_vocab()`（`CREATE EXTENSION` + `CREATE TABLE IF NOT EXISTS`）を
    dry-run 含む全経路で無条件に呼んでいたため、`--target` の入力ミスで空の DB /
    別プロジェクトを指した場合に **その場に空の vocab を新規作成した上で**
    「対象 0 件 = 完了」と誤報告する事故があり得た（Round 1 レビュー指摘）。
    ここでは vocab の存在だけを先に検証する。**行数のしきい値は見ない**
    （`word` の交差を見る `count_intersection` のほうが正確な安全網であり、
    行数比較はローカルの語彙が増減しただけで正当な実行を誤って拒否しかねない。
    Round 2 レビュー指摘）。おかしければ非ゼロ終了で止める。
    """
    exists = conn.execute("SELECT to_regclass('public.vocab')").fetchone()
    assert exists is not None
    if exists[0] is None:
        raise SystemExit(
            "target に vocab テーブルがありません。--target が正しいか確認してください"
            "（誤って空の DB や別プロジェクトを指していないか）。"
            " このスクリプトは vocab を新規作成しません。"
        )


def count_intersection(conn: psycopg.Connection, words: list[str]) -> int:
    """target の vocab のうち、渡した語（ソース）と word が一致する行数（pos3 の状態は問わない）。

    `vocab` の行数さえ足りていれば `word` が 1 件も一致しなくても素通りしてしまい、
    続く `missing == 0` 判定が「完了」と誤解してしまう穴があった（Round 2 レビュー指摘：
    実際に行数は十分だが word が 1 件も一致しない使い捨て DB で exit 0 を再現された）。
    ここで交差の件数を見る。閾値の判定は `required_intersection_count` を参照。
    """
    row = conn.execute(
        "SELECT count(*) FROM vocab WHERE word = ANY(%s)",
        (words,),
    ).fetchone()
    assert row is not None
    return int(row[0])


def required_intersection_count(source_word_count: int) -> int:
    """`MIN_INTERSECTION_RATIO` を満たすために必要な最小交差件数（切り上げ）。

    「1 語でも一致すれば OK」（Round 2 実装）だと、1 語だけ同名の語を含む
    全く無関係な DB を見逃してしまう（Round 3 レビュー指摘）。割合のしきい値に
    することで、本番のように高い一致率（実測 99% 超）を要求しつつ、
    ローカルの語彙が多少ズレていても正当な実行は通す。
    """
    return math.ceil(source_word_count * MIN_INTERSECTION_RATIO)


def count_missing_readonly(conn: psycopg.Connection, words: list[str]) -> int:
    """dry-run 用。target に一切書き込まず、渡した語のうち pos3 が NULL な数を数える。"""
    row = conn.execute(
        "SELECT count(*) FROM vocab WHERE pos3 IS NULL AND word = ANY(%s)",
        (words,),
    ).fetchone()
    assert row is not None
    return int(row[0])


def load_source_into_temp(conn: psycopg.Connection, rows: list[tuple[str, list[float]]]) -> None:
    """ソースの (word, pos3) を対象 DB の一時テーブルにまとめて COPY する。

    書き込み（実行）経路でのみ呼ぶこと。dry-run では呼ばない。
    """
    # pg_temp. で明示的に修飾する。無修飾だと search_path 次第で public の同名の
    # 恒久テーブルを DROP しかねない（本番に対する無修飾 DROP は避ける。Round 2 レビュー指摘）。
    conn.execute(f"DROP TABLE IF EXISTS pg_temp.{SOURCE_LOAD_TABLE}")
    conn.execute(f"CREATE TEMP TABLE {SOURCE_LOAD_TABLE} (word text PRIMARY KEY, pos3 real[])")
    with conn.cursor().copy(f"COPY {SOURCE_LOAD_TABLE} (word, pos3) FROM STDIN") as copy:
        for word, pos3 in rows:
            copy.write_row((word, pos3))


def count_missing(conn: psycopg.Connection) -> int:
    """対象 DB で pos3 が NULL、かつソースに値がある語の数（一時テーブル読み込み後専用）。"""
    row = conn.execute(
        f"""
        SELECT count(*)
        FROM vocab v
        JOIN {SOURCE_LOAD_TABLE} s ON s.word = v.word
        WHERE v.pos3 IS NULL
        """
    ).fetchone()
    assert row is not None
    return int(row[0])


def db_size_bytes(conn: psycopg.Connection) -> int:
    row = conn.execute("SELECT pg_database_size(current_database())").fetchone()
    assert row is not None
    return int(row[0])


def positive_int(value: str) -> int:
    """`--batch-size` の型検証。1 以上でなければ argparse の段階で拒否する。

    `--batch-size 0` を渡すと 1 行も更新しないまま `apply_batch` が毎回 0 件を
    返し（`LIMIT 0` は常に空集合）、ループがすぐ終わって「完了」と exit 0 で
    報告してしまう穴があった（Round 3 レビュー指摘）。argparse の段階で弾く。
    """
    n = int(value)
    if n < 1:
        raise argparse.ArgumentTypeError(f"1 以上の整数を指定してください（{value!r} は不可）")
    return n


def install_vacuum_watchdog(conn: psycopg.Connection) -> list[str]:
    """`VACUUM` がロール権限不足などで無言スキップされたことを検知する。

    ロールが `vocab` の所有者でないと `VACUUM` はエラーにならず、
    `WARNING: permission denied to vacuum "vocab", skipping it` という
    NOTICE を出すだけで何もしない（実測で確認済み）。psycopg はこれを
    既定では黙って読み捨てるため、容量が壊れるまで気づけない
    （Round 3 レビュー指摘: 実際に `last_vacuum=(never)` のまま完走するケースを
    レビュアーが観測）。ここで NOTICE を集めるハンドラを登録し、
    呼び出し側が `VACUUM` のたびに中身を検査できるようにする。
    戻り値のリストは呼び出し側が都度 `clear()` して使うこと。
    """
    messages: list[str] = []
    conn.add_notice_handler(lambda diag: messages.append(diag.message_primary or str(diag)))
    return messages


def apply_batch(conn: psycopg.Connection, batch_size: int) -> int:
    """`pos3 IS NULL` な語を最大 batch_size 件選び、ソースの値で UPDATE する。

    戻り値は実際に更新した行数（0 なら対象が尽きたということ）。
    """
    candidates = conn.execute(
        f"""
        SELECT v.word
        FROM vocab v
        JOIN {SOURCE_LOAD_TABLE} s ON s.word = v.word
        WHERE v.pos3 IS NULL
        LIMIT %s
        """,
        (batch_size,),
    ).fetchall()
    words = [r[0] for r in candidates]
    if not words:
        return 0
    cur = conn.execute(
        f"""
        UPDATE vocab v
        SET pos3 = s.pos3
        FROM {SOURCE_LOAD_TABLE} s
        WHERE v.word = s.word AND v.word = ANY(%s) AND v.pos3 IS NULL
        """,
        (words,),
    )
    return cur.rowcount


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(
        description="ローカル DB で計算済みの vocab.pos3 を対象 DB にバッチでバックフィルする"
    )
    ap.add_argument(
        "--target",
        required=True,
        help=(
            "書き込み先の接続文字列。既定値は無い（本番を既定にしない）。"
            "本番に流す場合は呼び出し側が Neon の DATABASE_URL_DIRECT を明示的に渡すこと。"
        ),
    )
    ap.add_argument(
        "--batch-size",
        type=positive_int,
        default=DEFAULT_BATCH_SIZE,
        help=f"1 バッチあたりの更新行数（既定 {DEFAULT_BATCH_SIZE}、1 以上必須）",
    )
    ap.add_argument(
        "--max-bytes",
        type=int,
        default=DEFAULT_MAX_BYTES,
        help=f"このバイト数を超えたら中断する（既定 {DEFAULT_MAX_BYTES}）",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="対象件数だけ出して終了する（target には一切書き込まない）",
    )
    ap.add_argument(
        "--allow-pooled",
        action="store_true",
        help=(
            "pooled 接続（ホスト名に -pooler を含む）、または接続文字列から"
            "ホストを特定できない場合でも実行する（既定ではどちらも拒否）"
        ),
    )
    args = ap.parse_args(argv)

    # S-1（Round 4 レビュー指摘）: 接続先を一切表示していなかったため、
    # 「別の完了済み DB を誤って指している」事故に気づく手段が無かった。
    # パスワードは describe_target が絶対に含めない。
    print(f"接続先: {describe_target(args.target)}", file=sys.stderr)

    host = resolve_host(args.target)
    if host is None and not args.allow_pooled:
        raise SystemExit(
            "--target からホスト名を特定できませんでした"
            "（URI 形式（postgres://...）でも libpq の keyword=value 形式（host=...）"
            "でもホストが見つかりません）。pooled 接続かどうか判定できないため、"
            " 安全側に倒して既定では拒否します。host= を含む接続文字列にするか、"
            " pooled でないと分かっているなら --allow-pooled を付けて再実行してください。"
        )
    if is_pooled_host(args.target) and not args.allow_pooled:
        raise SystemExit(
            "--target が pooled 接続（ホスト名に -pooler を含む）です。"
            " 一時テーブルが接続の使い回しで失われる恐れがあるため既定では拒否します。"
            " Neon の DATABASE_URL_DIRECT（unpooled）を使うか、"
            " 分かった上で --allow-pooled を付けて再実行してください。"
        )

    print("ソース: ローカル DB から pos3 を読み込み中…", file=sys.stderr)
    rows = fetch_source_rows(database_url())
    print(f"  ソース側 pos3 あり: {len(rows)} 語", file=sys.stderr)
    if not rows:
        raise SystemExit("ソースに pos3 が 1 件もありません。中断します。")
    if len(rows) < MIN_SOURCE_WORD_COUNT:
        # S-2（Round 4 レビュー指摘）: ソース側の語数を検証していなかったため、
        # pos3 が数語しかない壊れたローカル DB でも「対象 2 語」を全部処理して
        # 「完了」と報告してしまっていた。
        raise SystemExit(
            f"ソースの pos3 あり語数が {len(rows)} 語しかありません"
            f"（最低 {MIN_SOURCE_WORD_COUNT} 語を期待）。ローカル DB が壊れている、"
            " またはパイプライン（02_prune / 06_umap_coords 等）が中途半端な状態の"
            " 可能性があるため中断します。"
        )
    words = [word for word, _ in rows]

    with connect(args.target) as conn:
        ensure_target_sane(conn)

        intersection = count_intersection(conn, words)
        required = required_intersection_count(len(words))
        if intersection < required:
            raise SystemExit(
                f"target の vocab とソースの語の一致が {intersection}/{len(words)} 語"
                f"（{intersection / len(words):.0%}）しかありません。"
                f" 必要な最低割合（MIN_INTERSECTION_RATIO = {MIN_INTERSECTION_RATIO:.0%}、"
                f" {required} 語以上）を下回っているため、target が別プロジェクト /"
                " 別環境を指している、または word の正規化がソースとずれている"
                " 可能性があります。このまま進めると誤った完了報告につながるため"
                " 中断します。"
            )

        if args.dry_run:
            missing = count_missing_readonly(conn, words)
            print(f"対象（target の pos3 が NULL かつソースに値あり）: {missing} 語", file=sys.stderr)
            if missing == 0:
                raise SystemExit(_zero_target_message(args.target))
            print(
                "dry-run のため書き込みは行いません（一時テーブルも作成していません）。",
                file=sys.stderr,
            )
            return

        load_source_into_temp(conn, rows)
        try:
            missing = count_missing(conn)
            print(f"対象（target の pos3 が NULL かつソースに値あり）: {missing} 語", file=sys.stderr)

            if missing == 0:
                raise SystemExit(_zero_target_message(args.target))

            vacuum_notices = install_vacuum_watchdog(conn)
            vacuum_skipped_batches = 0

            processed = 0
            batch_no = 0
            while True:
                batch_no += 1
                updated = apply_batch(conn, args.batch_size)
                if updated == 0:
                    break
                processed += updated
                vacuum_notices.clear()
                conn.execute("VACUUM vocab")
                if vacuum_notices:
                    # 正常なら VACUUM は何の NOTICE も出さない。何か出た時点で
                    # 「効いていない」疑いが濃いので、止めずに警告だけ出す
                    # （--max-bytes のバックストップがあるので容量的には完走できる。
                    # Round 3 レビュー指摘: ロールが所有者でないと権限エラーが
                    # WARNING として握り潰され、VACUUM が無言でスキップされる）。
                    vacuum_skipped_batches += 1
                    for msg in vacuum_notices:
                        print(f"⚠ VACUUM vocab が効いていない可能性: {msg}", file=sys.stderr)
                size = db_size_bytes(conn)
                print(
                    f"バッチ {batch_no}: {updated} 行更新（累計 {processed}）"
                    f" / DB サイズ {size / (1024 * 1024):.1f}MB",
                    file=sys.stderr,
                )
                if size > args.max_bytes:
                    remaining = count_missing(conn)
                    print(
                        f"⚠ DB サイズが --max-bytes"
                        f"（{args.max_bytes / (1024 * 1024):.0f}MB）を超えたため中断します。"
                        f" 残り {remaining} 語は未処理です。"
                        " WHERE pos3 IS NULL で絞っているので、あとで再実行すれば続きから進みます。",
                        file=sys.stderr,
                    )
                    if vacuum_skipped_batches:
                        print(
                            f"⚠ さらに、VACUUM vocab が {vacuum_skipped_batches}/{batch_no}"
                            " バッチでスキップされていました。ロールが vocab の所有者で"
                            " ないと権限不足で無言スキップされます。所有権を確認してください。",
                            file=sys.stderr,
                        )
                    sys.exit(1)

            remaining = count_missing(conn)
            if remaining > 0:
                # S-3（Round 4 レビュー指摘）: Round 3 は `processed == 0` のときしか
                # 見ておらず、「何行か書けたが全部は終わっていない」
                # （processed > 0 and remaining > 0）を素通りして「完了」と
                # exit 0 で報告していた。**未処理が残っているなら、何行書けて
                # いようと非ゼロで終了する。** 正常終了は remaining == 0 のときだけ。
                # --max-bytes による意図的な中断（exit 1）とは区別できるよう、
                # 専用の終了コード（EXIT_INCOMPLETE = 3）を使う。
                print(
                    f"⚠ バッチ処理を終えましたが、まだ {remaining} 件の未処理が残っています"
                    f"（今回の実行で {processed} 行を更新済み）。"
                    " --max-bytes による意図的な中断（exit 1）とは異なり、想定外の状態です。"
                    " apply_batch が対象を検出できなくなったのに、まだ pos3 が NULL の"
                    " 語が残っています。コードにバグがある可能性があるため中断します"
                    f"（exit {EXIT_INCOMPLETE}）。",
                    file=sys.stderr,
                )
                if vacuum_skipped_batches:
                    print(
                        f"⚠ さらに、VACUUM vocab は {vacuum_skipped_batches}/{batch_no}"
                        " バッチでスキップされていました。",
                        file=sys.stderr,
                    )
                sys.exit(EXIT_INCOMPLETE)
            print(
                f"\n完了: {processed} 行更新しました。pos3 IS NULL の残り: {remaining} 件。",
                file=sys.stderr,
            )
            if vacuum_skipped_batches:
                print(
                    f"⚠ 完了しましたが、VACUUM vocab は {vacuum_skipped_batches}/{batch_no}"
                    " バッチでスキップされていました（ロールが vocab の所有者ではない"
                    " 可能性があります）。容量には収まりましたが、デッドタプルが解放"
                    " されていないかもしれません。所有権を確認してください。",
                    file=sys.stderr,
                )
        finally:
            conn.execute(f"DROP TABLE IF EXISTS pg_temp.{SOURCE_LOAD_TABLE}")


if __name__ == "__main__":
    main()

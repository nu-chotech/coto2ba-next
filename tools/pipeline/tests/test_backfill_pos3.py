"""12_backfill_pos3.py のテスト。

レビュー（critical-fixes-review.md）で指摘された「--target の入力ミスでサイレント
成功する」経路を中心に、壊れ方を再現してから塞いだことを確認する。

DB を触るテスト（`requires_local_pg` が付いたもの）はローカル Docker
（`docker start coto2ba-pg`、port 55432）が必要。無ければ自動でスキップする。
pooled 接続のガードはテスト用の DB を必要としないので、常に実行される。
"""

from __future__ import annotations

import importlib.util
import sys
import uuid
from pathlib import Path
from types import ModuleType

import psycopg
import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
SCRIPT_PATH = SCRIPTS_DIR / "12_backfill_pos3.py"

ADMIN_URL = "postgres://coto2ba:coto2ba@127.0.0.1:55432/postgres"


def _load_module() -> ModuleType:
    """ファイル名が数字始まりで `import` できないスクリプトを読み込む。"""
    scripts_dir = str(SCRIPTS_DIR)
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    spec = importlib.util.spec_from_file_location("backfill_pos3", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


module = _load_module()


def _pg_reachable() -> bool:
    try:
        with psycopg.connect(ADMIN_URL, connect_timeout=2) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


requires_local_pg = pytest.mark.skipif(
    not _pg_reachable(),
    reason="ローカル Postgres（docker start coto2ba-pg）が無いのでスキップします",
)


def _url_for(dbname: str) -> str:
    return ADMIN_URL.rsplit("/", 1)[0] + f"/{dbname}"


@pytest.fixture
def make_db():
    """一意な名前の使い捨て DB を作る。後始末は fixture が行う。"""
    created: list[str] = []

    def _make(prefix: str) -> str:
        name = f"{prefix}_{uuid.uuid4().hex[:8]}"
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute(f'CREATE DATABASE "{name}"')
        created.append(name)
        return _url_for(name)

    yield _make

    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        for name in created:
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def _seed_source(url: str, words: list[tuple[str, list[float]]]) -> None:
    """fetch_source_rows が読む最小限の vocab（word, pos3）を用意する。"""
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("CREATE TABLE vocab (word text PRIMARY KEY, pos3 real[])")
        for word, pos3 in words:
            conn.execute("INSERT INTO vocab (word, pos3) VALUES (%s, %s)", (word, pos3))


def _seed_target_all_null(url: str, words: list[str]) -> None:
    """バックフィル前の状態（pos3 が全部 NULL）を模した target を用意する。"""
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("CREATE TABLE vocab (word text PRIMARY KEY, pos3 real[])")
        for word in words:
            conn.execute("INSERT INTO vocab (word, pos3) VALUES (%s, NULL)", (word,))


def _table_names(url: str) -> set[str]:
    with psycopg.connect(url) as conn:
        rows = conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        ).fetchall()
    return {r[0] for r in rows}


def _null_count(url: str) -> int:
    with psycopg.connect(url) as conn:
        row = conn.execute("SELECT count(*) FROM vocab WHERE pos3 IS NULL").fetchone()
        assert row is not None
        return int(row[0])


def _total_count(url: str) -> int:
    with psycopg.connect(url) as conn:
        row = conn.execute("SELECT count(*) FROM vocab").fetchone()
        assert row is not None
        return int(row[0])


def _exit_status(code: object) -> int:
    """`SystemExit.code` を実際のプロセス終了コード相当に変換する。

    `SystemExit("文字列")` の `.code` は文字列そのものになるため、
    `code != 0` は文字列と int の比較で常に True になってしまい、ほぼ恒真な
    アサーションだった（Round 2 レビュー指摘）。Python の `sys.exit()` の実際の
    挙動（None→0 / int→その値 / それ以外→1）を再現して、意味のある比較にする。
    """
    if code is None:
        return 0
    if isinstance(code, int):
        return code
    return 1


@pytest.fixture(autouse=True)
def _relax_min_source_word_count(request, monkeypatch):
    """既存のテストは数十語規模のソースを使うため、本番想定の下限を無効化しておく。

    `MIN_SOURCE_WORD_COUNT`（Round 4 で追加）は本番想定で 50,000 語超だが、
    このテストスイートのほとんどは 10〜40 語程度の合成データを使う。
    この下限そのものを検証するテストは `@pytest.mark.no_relax_source_count`
    でこの緩和自体をオプトアウトする。
    """
    if "no_relax_source_count" in request.keywords:
        return
    # raising=False: このチェック自体が無い旧バージョンのスクリプトに対して
    # red を確認する際に、このフィクスチャ自体の AttributeError で他のテストの
    # red 理由が覆い隠されないようにする。
    monkeypatch.setattr(module, "MIN_SOURCE_WORD_COUNT", 1, raising=False)


# ── 1. 空 / 存在しない vocab、および word が 1 件も一致しない vocab は非ゼロ終了で弾く ──

@requires_local_pg
def test_missing_vocab_table_fails_loudly(make_db, monkeypatch):
    source_url = make_db("pos3_src")
    _seed_source(source_url, [("温泉", [0.1, 0.2, 0.3]), ("蚕", [0.4, 0.5, 0.6])])
    # target には vocab を一切作らない（空の DB / 別プロジェクトを誤って指した状態）。
    target_url = make_db("pos3_tgt_missing")

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    with pytest.raises(SystemExit) as exc:
        module.main(["--target", target_url, "--dry-run"])

    assert _exit_status(exc.value.code) != 0
    assert "vocab" in str(exc.value)
    # vocab を新規作成していないこと（以前の実装はここで空の vocab を作ってしまっていた）。
    assert "vocab" not in _table_names(target_url)


@requires_local_pg
def test_no_overlapping_words_fails_loudly_dry_run(make_db, monkeypatch):
    """行数は十分にあるが word が 1 件も一致しない target（Round 2 レビュー指摘の核心）。

    Round 1 の実装は vocab の総行数（ソースの語数以上か）しか見ておらず、この
    状態でも素通りして「対象 0 件 = 完了」と exit 0 で誤報告していた
    （レビュアーが使い捨て DB で実際に再現）。dry-run 経路で確認する。
    """
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [0.1, 0.2, 0.3]) for i in range(10)]
    _seed_source(source_url, words)

    target_url = make_db("pos3_tgt_no_overlap")
    # target の行数はソース（10 語）よりずっと多い（500 行）が、word が 1 つも重ならない。
    _seed_target_all_null(target_url, [f"other{i}" for i in range(500)])

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    null_before = _null_count(target_url)

    with pytest.raises(SystemExit) as exc:
        module.main(["--target", target_url, "--dry-run"])

    assert _exit_status(exc.value.code) != 0
    assert "一致" in str(exc.value)
    assert _null_count(target_url) == null_before  # 何も変更されていない


@requires_local_pg
def test_no_overlapping_words_fails_loudly_real_run(make_db, monkeypatch):
    """dry-run だけでなく本実行でも同じガードが効くこと。"""
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [0.1, 0.2, 0.3]) for i in range(10)]
    _seed_source(source_url, words)

    target_url = make_db("pos3_tgt_no_overlap2")
    _seed_target_all_null(target_url, [f"other{i}" for i in range(500)])

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    with pytest.raises(SystemExit) as exc:
        module.main(["--target", target_url])  # dry-run 無し

    assert _exit_status(exc.value.code) != 0
    assert _total_count(target_url) == 500  # 行数は変わらず
    assert _null_count(target_url) == 500  # pos3 も一切更新されていない


@requires_local_pg
def test_intersection_below_ratio_threshold_fails_loudly(make_db, monkeypatch):
    """交差が 0 ではないが MIN_INTERSECTION_RATIO 未満（Round 3 レビュー指摘の核心）。

    Round 2 の実装は「交差が 1 語でもあれば通す」だったため、たまたま 1 語だけ
    一致する全く無関係な target を見逃していた。ここでは 10 語中 1 語（10%）だけ
    一致させ、既定のしきい値（50%）を満たさないことを確認する。
    """
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [0.1, 0.2, 0.3]) for i in range(10)]
    _seed_source(source_url, words)

    target_url = make_db("pos3_tgt_low_overlap")
    # word0 だけ一致させ、残りは無関係な語で埋める（一致率 10%）。
    target_words = ["word0"] + [f"other{i}" for i in range(9)]
    _seed_target_all_null(target_url, target_words)

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    with pytest.raises(SystemExit) as exc:
        module.main(["--target", target_url, "--dry-run"])

    assert _exit_status(exc.value.code) != 0
    assert "一致" in str(exc.value)
    assert _null_count(target_url) == len(target_words)  # 書き込みなし


@requires_local_pg
def test_intersection_at_ratio_threshold_passes(make_db, monkeypatch, capsys):
    """交差がちょうど MIN_INTERSECTION_RATIO を満たせば通ること（過剰検知しない）。"""
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [0.1, 0.2, 0.3]) for i in range(10)]
    _seed_source(source_url, words)

    target_url = make_db("pos3_tgt_half_overlap")
    # ちょうど 50%（5/10）だけ一致させる。
    target_words = [f"word{i}" for i in range(5)] + [f"other{i}" for i in range(5)]
    _seed_target_all_null(target_url, target_words)

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    module.main(["--target", target_url, "--dry-run"])  # 例外が飛ばないこと自体を確認

    err = capsys.readouterr().err
    assert "対象（target の pos3 が NULL かつソースに値あり）: 5 語" in err


# ── 2. --dry-run は target に一切書き込まない ───────────────────

@requires_local_pg
def test_dry_run_does_not_write(make_db, monkeypatch):
    """dry-run が一時テーブル・COPY に一切触れないことを直接検証する。

    `pg_tables WHERE schemaname = 'public'` の前後比較だけでは、一時テーブルは
    `pg_temp_N` スキーマに作られてセッション終了で消えるため**構造的に検出できず**、
    `load_source_into_temp()` が dry-run で呼ばれる回帰があってもこのテストは
    green のままだった（Round 2 レビュー指摘）。`load_source_into_temp` を
    「呼ばれたら失敗させる」フェイクに差し替えて直接検証する。
    """
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [0.1 * i, 0.2 * i, 0.3 * i]) for i in range(20)]
    _seed_source(source_url, words)

    target_url = make_db("pos3_tgt")
    _seed_target_all_null(target_url, [w for w, _ in words] + ["extra_word_not_in_source"])

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    def _forbidden(*_args, **_kwargs):
        raise AssertionError(
            "load_source_into_temp は dry-run で呼ばれてはいけない"
            "（一時テーブル作成・COPY が発生してしまう）"
        )

    monkeypatch.setattr(module, "load_source_into_temp", _forbidden)

    tables_before = _table_names(target_url)
    null_before = _null_count(target_url)

    module.main(["--target", target_url, "--dry-run"])  # 例外が飛ばないこと自体も確認

    tables_after = _table_names(target_url)
    null_after = _null_count(target_url)

    # 一時テーブルも含めて何も作られていない（dry-run は読み取り専用）。
    assert tables_after == tables_before == {"vocab"}
    # pos3 は 1 件も更新されていない。
    assert null_after == null_before == len(words) + 1


@requires_local_pg
def test_dry_run_reports_correct_intersection_count(make_db, monkeypatch, capsys):
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [0.1, 0.2, 0.3]) for i in range(15)]
    _seed_source(source_url, words)

    target_url = make_db("pos3_tgt")
    # target にはソースの語のうち 15 語 + ソースに無い語 3 語。
    target_words = [w for w, _ in words] + ["not_in_source_a", "not_in_source_b", "not_in_source_c"]
    _seed_target_all_null(target_url, target_words)

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    module.main(["--target", target_url, "--dry-run"])

    err = capsys.readouterr().err
    assert "対象（target の pos3 が NULL かつソースに値あり）: 15 語" in err


# ── 3. pooled 接続は既定で拒否する ──────────────────────────────

def test_is_pooled_host_detects_pooler_hostname():
    assert module.is_pooled_host(
        "postgresql://u:p@ep-restless-frog-azaph0s6-pooler.c-3.aws.neon.tech/db"
    )
    assert not module.is_pooled_host(
        "postgresql://u:p@ep-restless-frog-azaph0s6.c-3.aws.neon.tech/db"
    )
    assert not module.is_pooled_host("postgres://coto2ba:coto2ba@127.0.0.1:55432/coto2ba")
    # ホスト名だけを見る。パスワードや DB 名に -pooler が含まれても誤検知しない
    # （Round 2 レビュー指摘: 以前は URL 文字列全体の部分一致だったので誤検知していた）。
    assert not module.is_pooled_host(
        "postgresql://user:my-pooler-secret@ep-plain-host.c-3.aws.neon.tech/mydb"
    )
    assert not module.is_pooled_host(
        "postgresql://user:pw@ep-plain-host.c-3.aws.neon.tech/my-pooler-db"
    )


def test_main_rejects_pooled_target_without_connecting(monkeypatch):
    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("pooled 接続は connect() に到達する前に拒否されるべき")

    monkeypatch.setattr(module, "connect", fail_if_called)
    monkeypatch.setattr(module, "fetch_source_rows", fail_if_called)
    monkeypatch.setattr(module, "database_url", fail_if_called)

    pooled_url = "postgresql://u:p@ep-restless-frog-azaph0s6-pooler.c-3.aws.neon.tech/db"
    with pytest.raises(SystemExit) as exc:
        module.main(["--target", pooled_url, "--dry-run"])

    assert _exit_status(exc.value.code) != 0
    assert "pooled" in str(exc.value) or "pooler" in str(exc.value)


def test_main_allow_pooled_flag_bypasses_the_guard(monkeypatch):
    monkeypatch.setattr(module, "database_url", lambda: "unused")
    monkeypatch.setattr(
        module, "fetch_source_rows", lambda _url: [("word", [0.0, 0.0, 0.0])]
    )
    sentinel = RuntimeError("reached connect() past the pooled guard")

    def fake_connect(_url):
        raise sentinel

    monkeypatch.setattr(module, "connect", fake_connect)

    pooled_url = "postgresql://u:p@ep-restless-frog-azaph0s6-pooler.c-3.aws.neon.tech/db"
    with pytest.raises(RuntimeError) as exc:
        module.main(["--target", pooled_url, "--dry-run", "--allow-pooled"])

    assert exc.value is sentinel


def test_resolve_host_handles_libpq_keyword_format():
    """libpq の keyword=value 形式（host=... dbname=...）からもホストを取り出せること。

    Round 2 までの実装は `urlparse(url).hostname` だけに頼っており、
    keyword=value 形式では `.hostname` が `None` になるため pooled ガードを
    無条件に素通りしていた（Round 3 レビュー指摘）。
    """
    assert (
        module.resolve_host("host=ep-xxx-pooler.aws.neon.tech dbname=neondb")
        == "ep-xxx-pooler.aws.neon.tech"
    )
    assert (
        module.resolve_host("host='ep-xxx.aws.neon.tech' dbname=neondb")
        == "ep-xxx.aws.neon.tech"
    )
    assert module.resolve_host("dbname=coto2ba user=coto2ba") is None
    # URI 形式は従来どおり urlparse に任せる。
    assert (
        module.resolve_host("postgres://coto2ba:coto2ba@127.0.0.1:55432/coto2ba")
        == "127.0.0.1"
    )


def test_is_pooled_host_detects_libpq_keyword_format():
    assert module.is_pooled_host("host=ep-xxx-pooler.aws.neon.tech dbname=neondb")
    assert not module.is_pooled_host("host=ep-xxx.aws.neon.tech dbname=neondb")


def test_main_rejects_unresolvable_host_without_connecting(monkeypatch):
    """host を特定できない接続文字列は、pooled かどうか判定できないので安全側に倒して拒否する。"""

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("host 不明なら connect() に到達する前に拒否されるべき")

    monkeypatch.setattr(module, "connect", fail_if_called)
    monkeypatch.setattr(module, "fetch_source_rows", fail_if_called)
    monkeypatch.setattr(module, "database_url", fail_if_called)

    # host= も無く、スキームも無い、host を特定する手段が無い接続文字列。
    weird_target = "dbname=coto2ba user=coto2ba"
    with pytest.raises(SystemExit) as exc:
        module.main(["--target", weird_target, "--dry-run"])

    assert _exit_status(exc.value.code) != 0
    assert "ホスト" in str(exc.value)


def test_main_allow_pooled_flag_bypasses_unresolvable_host_guard(monkeypatch):
    monkeypatch.setattr(module, "database_url", lambda: "unused")
    monkeypatch.setattr(module, "fetch_source_rows", lambda _url: [("word", [0.0, 0.0, 0.0])])
    sentinel = RuntimeError("reached connect() past the unresolvable-host guard")

    def fake_connect(_url):
        raise sentinel

    monkeypatch.setattr(module, "connect", fake_connect)

    weird_target = "dbname=coto2ba user=coto2ba"
    with pytest.raises(RuntimeError) as exc:
        module.main(["--target", weird_target, "--dry-run", "--allow-pooled"])

    assert exc.value is sentinel


# ── 4. 通し実行 / 冪等性 / --max-bytes 中断と再開（回帰） ────────

@requires_local_pg
def test_full_backfill_updates_all_and_is_idempotent(make_db, monkeypatch):
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [float(i), float(i) / 2, float(i) / 3]) for i in range(37)]
    _seed_source(source_url, words)

    target_url = make_db("pos3_tgt")
    _seed_target_all_null(target_url, [w for w, _ in words])

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    # バッチサイズを語数より小さくして複数バッチを踏ませる。
    module.main(["--target", target_url, "--batch-size", "10"])
    assert _null_count(target_url) == 0

    with psycopg.connect(target_url) as conn:
        row = conn.execute("SELECT pos3 FROM vocab WHERE word = 'word5'").fetchone()
        assert row is not None
        assert list(row[0]) == pytest.approx([5.0, 2.5, 5 / 3])

    # 再実行すると「対象 0 件」になるが、これは S-1（Round 4）以降
    # 「すでに完了している」と断定せず、確認を促して非ゼロ終了する
    # （接続先の取り違えと見分けが付かないため）。何も壊れていないことだけ確認する。
    with pytest.raises(SystemExit) as exc:
        module.main(["--target", target_url, "--batch-size", "10", "--dry-run"])
    assert _exit_status(exc.value.code) != 0
    assert _null_count(target_url) == 0


@requires_local_pg
def test_max_bytes_interrupts_and_resume_completes(make_db, monkeypatch):
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [0.1, 0.2, 0.3]) for i in range(23)]
    _seed_source(source_url, words)

    target_url = make_db("pos3_tgt")
    _seed_target_all_null(target_url, [w for w, _ in words])

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    # --max-bytes をほぼ 0 にして、実データがあれば必ず 1 バッチ目で超過させる。
    with pytest.raises(SystemExit) as exc:
        module.main(["--target", target_url, "--batch-size", "10", "--max-bytes", "1"])
    assert exc.value.code == 1  # 意図的な中断（--max-bytes）は exit 1
    assert exc.value.code != module.EXIT_INCOMPLETE  # S-3 の想定外終了（exit 3）とは別物

    remaining_after_interrupt = _null_count(target_url)
    assert 0 < remaining_after_interrupt < len(words)

    # 上限を戻して再実行すれば、残りが完走する（WHERE pos3 IS NULL による再開）。
    module.main(["--target", target_url, "--batch-size", "10"])
    assert _null_count(target_url) == 0


# ── 5. --batch-size 0 で何もせず成功したことにする経路を塞ぐ ─────

def test_batch_size_zero_rejected_by_argparse():
    """`--batch-size 0` は argparse の段階で拒否する（Round 3 レビュー指摘の核心）。

    0 を許すと `apply_batch` の `LIMIT 0` が常に空集合を返し、ループが
    即座に終わって「完了」と exit 0 で誤報告してしまっていた。DB にすら
    到達しない段階の話なので `--target` はダミーでよい。
    """
    with pytest.raises(SystemExit) as exc:
        module.main(["--target", "postgres://example/db", "--batch-size", "0"])
    assert _exit_status(exc.value.code) != 0


def test_batch_size_negative_rejected_by_argparse():
    with pytest.raises(SystemExit) as exc:
        module.main(["--target", "postgres://example/db", "--batch-size", "-5"])
    assert _exit_status(exc.value.code) != 0


@requires_local_pg
def test_zero_progress_with_remaining_work_fails_loudly(make_db, monkeypatch, capsys):
    """`apply_batch` が万一 0 のまま返し続けても、残件がある限り exit 0 にしない防御線。

    `processed == 0` のケース。`--batch-size` を argparse で 1 以上に
    強制していれば通常は起きないはずだが、その防御線自体が壊れていないかを
    確認する（Round 3 / Round 4 レビュー指摘）。
    """
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [0.1, 0.2, 0.3]) for i in range(10)]
    _seed_source(source_url, words)

    target_url = make_db("pos3_tgt")
    _seed_target_all_null(target_url, [w for w, _ in words])

    monkeypatch.setattr(module, "database_url", lambda: source_url)
    # apply_batch を「常に 0 行更新」に差し替えて、進捗ゼロのまま残件がある状況を作る。
    monkeypatch.setattr(module, "apply_batch", lambda _conn, _batch_size: 0)

    with pytest.raises(SystemExit) as exc:
        module.main(["--target", target_url, "--batch-size", "5"])

    assert exc.value.code == module.EXIT_INCOMPLETE
    err = capsys.readouterr().err
    assert "残" in err
    assert _null_count(target_url) == len(words)  # 実際には何も更新されていない


@requires_local_pg
def test_partial_progress_with_remaining_work_fails_loudly(make_db, monkeypatch, capsys):
    """S-3（Round 4 レビュー指摘の核心）: `processed > 0` でも `remaining > 0` なら非ゼロ終了する。

    Round 3 の実装は `processed == 0 and remaining > 0` だけを見ており、
    「何行か書けたが全部は終わっていない」（`processed > 0 and remaining > 0`）は
    素通りして「完了」と exit 0 で報告してしまっていた。ここでは `apply_batch` を
    「最初の 1 回だけ本物の 3 語を更新し、以降はずっと 0 を返す」フェイクに
    差し替え、10 語中 3 語だけ処理できて止まった状況（進捗はあるが未完了）を作る。
    """
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [0.1, 0.2, 0.3]) for i in range(10)]
    _seed_source(source_url, words)

    target_url = make_db("pos3_tgt")
    _seed_target_all_null(target_url, [w for w, _ in words])

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    real_apply_batch = module.apply_batch
    call_count = {"n": 0}

    def flaky_apply_batch(conn, batch_size):
        call_count["n"] += 1
        if call_count["n"] == 1:
            # 最初の 1 回だけ本物の処理を 3 語ぶんだけ行う（進捗はある）。
            return real_apply_batch(conn, 3)
        # 2 回目以降は「対象を見つけられなくなった」体で常に 0 を返す
        # （本当はまだ 7 語残っているのに、これ以上進まなくなった状況を模す）。
        return 0

    monkeypatch.setattr(module, "apply_batch", flaky_apply_batch)

    with pytest.raises(SystemExit) as exc:
        module.main(["--target", target_url, "--batch-size", "3"])

    # --max-bytes の意図的な中断（exit 1）とは異なる、専用の終了コードであること。
    assert exc.value.code == module.EXIT_INCOMPLETE
    assert exc.value.code != 1

    err = capsys.readouterr().err
    assert "残" in err
    assert "3 行を更新済み" in err or "3" in err

    # 実際に 3 語だけ更新されて止まっていること（進捗はあったことの確認）。
    assert _null_count(target_url) == 7


# ── 6. VACUUM が無言でスキップされたら警告する ────────────────────

@pytest.fixture
def make_nonowner_role():
    """`vocab` の所有者ではないログインロールを作る。後始末は fixture が行う。"""
    role = f"pos3_nonowner_{uuid.uuid4().hex[:8]}"
    password = "testpass"  # テスト用の使い捨てロールなので固定値でよい
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(f"CREATE ROLE {role} LOGIN PASSWORD '{password}'")

    yield role, password

    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(f'DROP ROLE IF EXISTS "{role}"')


@requires_local_pg
def test_vacuum_skip_is_detected_and_warned(make_nonowner_role, make_db, monkeypatch, capsys):
    """ロールが vocab の所有者でないと VACUUM が無言スキップされる。それを検知して警告する。

    権限エラーはエラーにならず WARNING の NOTICE として握り潰されるため、
    実測（本レポート参照）どおり `last_vacuum=(never)` のまま完走してしまう。
    処理は止めなくてよいが、標準エラーに気づける形で警告を出すことを確認する
    （Round 3 レビュー指摘）。
    """
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [0.1, 0.2, 0.3]) for i in range(20)]
    _seed_source(source_url, words)

    target_url = make_db("pos3_tgt")
    _seed_target_all_null(target_url, [w for w, _ in words])

    role, password = make_nonowner_role
    target_dbname = target_url.rsplit("/", 1)[-1]

    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(f'GRANT CONNECT ON DATABASE "{target_dbname}" TO "{role}"')
    with psycopg.connect(target_url, autocommit=True) as owner_conn:
        # 所有権は渡さず、SELECT/UPDATE だけ許可する（VACUUM には所有権が要る）。
        owner_conn.execute(f'GRANT SELECT, UPDATE ON vocab TO "{role}"')

    nonowner_target_url = f"postgres://{role}:{password}@127.0.0.1:55432/{target_dbname}"

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    module.main(["--target", nonowner_target_url, "--batch-size", "5"])  # 例外は飛ばない

    err = capsys.readouterr().err
    assert "VACUUM" in err
    assert "効いていない" in err
    # 容量的には完走しているはず（--max-bytes のバックストップ内）。
    assert _null_count(target_url) == 0


# ── 7. S-1: 接続先の取り違え（対象 0 件）を「完了」と断定しない ─────

@requires_local_pg
def test_missing_zero_before_any_work_requires_confirmation_dry_run(make_db, monkeypatch, capsys):
    """target が「別の完了済み DB」だと交差 100% で「対象 0 件」になる（S-1 の核心）。

    Round 3 までの実装は、この「対象 0 件」を「すでに完了しています」と
    断定して exit 0 にしていた。これは「別の DB を取り違えている」ケースと
    見分けが付かないため、判断を促す文言にして非ゼロ終了する
    （Round 4 レビュー指摘）。
    """
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [0.1, 0.2, 0.3]) for i in range(10)]
    _seed_source(source_url, words)

    # target は「別の完了済み DB」を模す: ソースと同じ語彙だが、
    # すでに pos3 が埋まっている（NULL が 1 件も無い）。
    target_url = make_db("pos3_tgt_already_full")
    with psycopg.connect(target_url, autocommit=True) as conn:
        conn.execute("CREATE TABLE vocab (word text PRIMARY KEY, pos3 real[])")
        for word, pos3 in words:
            conn.execute("INSERT INTO vocab (word, pos3) VALUES (%s, %s)", (word, pos3))

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    with pytest.raises(SystemExit) as exc:
        module.main(["--target", target_url, "--dry-run"])

    assert _exit_status(exc.value.code) != 0
    # 「対象が0件です...確認してください」というメッセージ自体は
    # raise SystemExit(message) の中身（str(exc.value)）に入っている。
    message = str(exc.value)
    assert "確認してください" in message
    assert "host=" in message
    assert "db=" in message
    # さらに、起動時にも接続先が標準エラーに表示されていること。
    err = capsys.readouterr().err
    assert "接続先" in err
    assert "host=" in err


@requires_local_pg
def test_missing_zero_before_any_work_requires_confirmation_real_run(make_db, monkeypatch):
    """dry-run だけでなく本実行でも同じガードが効くこと。データも壊さないこと。"""
    source_url = make_db("pos3_src")
    words = [(f"word{i}", [0.1, 0.2, 0.3]) for i in range(10)]
    _seed_source(source_url, words)

    target_url = make_db("pos3_tgt_already_full2")
    with psycopg.connect(target_url, autocommit=True) as conn:
        conn.execute("CREATE TABLE vocab (word text PRIMARY KEY, pos3 real[])")
        for word, pos3 in words:
            conn.execute("INSERT INTO vocab (word, pos3) VALUES (%s, %s)", (word, pos3))

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    with pytest.raises(SystemExit) as exc:
        module.main(["--target", target_url])  # dry-run 無し

    assert _exit_status(exc.value.code) != 0
    # 何も壊れていない（既存の値がそのまま残っている）。
    with psycopg.connect(target_url) as conn:
        row = conn.execute("SELECT pos3 FROM vocab WHERE word = 'word0'").fetchone()
        assert row is not None
        assert list(row[0]) == pytest.approx([0.1, 0.2, 0.3])


def test_connection_target_is_always_printed(monkeypatch, capsys):
    """S-1: 接続先（host / db）を起動時に必ず表示する。パスワードは出さない。

    pooled ガードで弾かれる場合も含め、何が試みられたか分かるように
    最初に出力する。
    """
    with pytest.raises(SystemExit):
        module.main(
            [
                "--target",
                "postgresql://secretuser:supersecretpassword@ep-xxx-pooler.aws.neon.tech/mydb",
                "--dry-run",
            ]
        )

    err = capsys.readouterr().err
    assert "接続先" in err
    assert "host=ep-xxx-pooler.aws.neon.tech" in err
    assert "db=mydb" in err
    assert "supersecretpassword" not in err
    assert "secretuser" not in err


# ── 8. S-2: ソース側の語数が極端に少ない場合も中断する ─────────────

@requires_local_pg
def test_source_word_count_below_threshold_fails_loudly(make_db, monkeypatch):
    """ソースの pos3 あり語数が極端に少ない（DB 破損・パイプライン未完了の疑い）。

    Round 3 までの実装はソース側の語数を一切検証しておらず、
    pos3 が 2 語しかないソース × 無関係な target でも「完了」と exit 0 で
    報告してしまっていた（Round 4 レビュー指摘）。
    """
    # このテストが検証したい下限そのものなので、autouse フィクスチャの
    # 緩和（1）を明示的に上書きする。
    monkeypatch.setattr(module, "MIN_SOURCE_WORD_COUNT", 50)

    source_url = make_db("pos3_src_tiny")
    _seed_source(source_url, [("word0", [0.1, 0.2, 0.3]), ("word1", [0.4, 0.5, 0.6])])  # 2 語のみ

    target_url = make_db("pos3_tgt")
    _seed_target_all_null(target_url, [f"other{i}" for i in range(5000)])

    monkeypatch.setattr(module, "database_url", lambda: source_url)

    with pytest.raises(SystemExit) as exc:
        module.main(["--target", target_url, "--dry-run"])

    assert _exit_status(exc.value.code) != 0
    assert "ソース" in str(exc.value)
    # target には一切触れていない（この時点で中断しているので接続すらしない）。
    assert _null_count(target_url) == 5000


@pytest.mark.no_relax_source_count
def test_min_source_word_count_is_half_of_n_output():
    """しきい値が N_OUTPUT（本番の実測語数）から機械的に導出されていること。"""
    assert module.MIN_SOURCE_WORD_COUNT == module.N_OUTPUT // 2


# ── describe_target: 接続先の表示（パスワードを漏らさない） ────────

def test_describe_target_uri_format():
    assert (
        module.describe_target(
            "postgresql://neondb_owner:supersecret@ep-xxx.aws.neon.tech/neondb?sslmode=require"
        )
        == "host=ep-xxx.aws.neon.tech db=neondb"
    )


def test_describe_target_never_leaks_password():
    rendered = module.describe_target(
        "postgresql://neondb_owner:supersecret@ep-xxx.aws.neon.tech/neondb"
    )
    assert "supersecret" not in rendered
    assert "neondb_owner" not in rendered


def test_describe_target_libpq_keyword_format():
    rendered = module.describe_target(
        "host=ep-xxx.aws.neon.tech dbname=neondb user=me password=secret"
    )
    assert rendered == "host=ep-xxx.aws.neon.tech db=neondb"
    assert "secret" not in rendered


def test_describe_target_unknown_format_shows_placeholder():
    assert module.describe_target("totally not a connection string") == "host=(不明) db=(不明)"

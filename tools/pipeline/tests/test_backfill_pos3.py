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

    # 再実行しても対象 0 件（冪等）。
    module.main(["--target", target_url, "--batch-size", "10", "--dry-run"])
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
    assert _exit_status(exc.value.code) != 0

    remaining_after_interrupt = _null_count(target_url)
    assert 0 < remaining_after_interrupt < len(words)

    # 上限を戻して再実行すれば、残りが完走する（WHERE pos3 IS NULL による再開）。
    module.main(["--target", target_url, "--batch-size", "10"])
    assert _null_count(target_url) == 0

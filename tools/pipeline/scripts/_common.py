"""パイプライン共通ユーティリティ。"""

from __future__ import annotations

import os
import re
import unicodedata
from pathlib import Path

import numpy as np

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PIPELINE_ROOT / "data"
NG_WORDS_PATH = PIPELINE_ROOT / "ng_words.txt"

VECTORS_TXT = DATA_DIR / "jawiki.200d.txt"
VOCAB_PARQUET = DATA_DIR / "vocab.parquet"
VECTORS_NPY = DATA_DIR / "vectors.npy"

DIM = 200

# ── 文字種判定 ────────────────────────────────────────────────
HIRAGANA = r"ぁ-ゟ"
KATAKANA = r"゠-ヿ"
KANJI = r"一-鿿㐀-䶿"
JAPANESE_RE = re.compile(f"[{HIRAGANA}{KATAKANA}{KANJI}々〆]")
DIGIT_RE = re.compile(r"[0-9]")
KANJI_RE = re.compile(f"[{KANJI}]")
# 記号・約物・絵文字など、語として不適なもの
SYMBOLISH_RE = re.compile(
    r"[　-〄〇-〿！-／：-＠［-｀｛-･"
    r" -⁯←-⇿∀-⋿─-╿■-◿☀-➿"
    r"\U0001F000-\U0001FAFF!-/:-@\[-`{-~]"
)


def normalize_word(raw: str) -> str:
    """TypeScript 側 normalizeWord と同じ結果になること（NFKC + 空白除去）。"""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", raw)).strip()


def has_japanese(word: str) -> bool:
    return bool(JAPANESE_RE.search(word))


def has_digit(word: str) -> bool:
    return bool(DIGIT_RE.search(word))


def has_symbol(word: str) -> bool:
    return bool(SYMBOLISH_RE.search(word))


def shares_kanji(a: str, b: str) -> bool:
    sa = set(KANJI_RE.findall(a))
    return bool(sa and sa & set(KANJI_RE.findall(b)))


VENDOR_DIR = PIPELINE_ROOT / "vendor"
VENDOR_NG_FILES = ("Sexual.txt", "Offensive.txt", "ldnoobw-ja.txt")
# 部分一致で弾く最小長。短い語を部分一致にすると巻き込みが大きすぎる。
NG_SUBSTRING_MIN_LEN = 3


def _read_ng_file(path) -> set[str]:
    out: set[str] = set()
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        w = normalize_word(line)
        if w:
            out.add(w)
    return out


def load_ng_words() -> tuple[set[str], set[str]]:
    """(完全一致セット, 部分一致セット) を返す。

    手書きの ng_words.txt と vendor/ の公開リスト（MIT / CC BY 4.0、出典は
    vendor/NOTICE.md）をマージする。
    """
    exact = _read_ng_file(NG_WORDS_PATH)
    for name in VENDOR_NG_FILES:
        exact |= _read_ng_file(VENDOR_DIR / name)
    substr = {w for w in exact if len(w) >= NG_SUBSTRING_MIN_LEN}
    return exact, substr


def is_ng(word: str, ng: tuple[set[str], set[str]]) -> bool:
    exact, substr = ng
    if word in exact:
        return True
    return any(n in word for n in substr)


# ── ベクトル ──────────────────────────────────────────────────
def normalize_rows(mat: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return mat / norms


def halfvec_literal(vec: np.ndarray) -> str:
    """pgvector の halfvec リテラル文字列。"""
    return "[" + ",".join(f"{v:.5f}" for v in vec) + "]"


# ── 環境 ──────────────────────────────────────────────────────
def database_url() -> str:
    from dotenv import load_dotenv

    for candidate in (
        PIPELINE_ROOT.parent.parent / ".env.local",
        PIPELINE_ROOT.parent.parent / ".env",
        PIPELINE_ROOT / ".env",
    ):
        if candidate.exists():
            load_dotenv(candidate, override=False)
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit(
            "DATABASE_URL が未設定です。.env.local に DATABASE_URL=postgres://... を書いてください。"
        )
    return url

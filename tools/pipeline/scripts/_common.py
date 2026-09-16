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


def load_ng_words() -> set[str]:
    if not NG_WORDS_PATH.exists():
        return set()
    out: set[str] = set()
    for line in NG_WORDS_PATH.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.add(normalize_word(line))
    return out


def is_ng(word: str, ng: set[str]) -> bool:
    """完全一致に加えて、NG 語を部分文字列として含む語も落とす（2 文字以上の NG 語のみ）。"""
    if word in ng:
        return True
    return any(len(n) >= 2 and n in word for n in ng)


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

# Python offline pipeline for a Japanese word2vec word game (uv / Python 3.12 / macOS arm64), verified 2026-09-17

## 要約

All seven answers were produced by actually installing and benchmarking on this machine: uv 0.12.0, CPython 3.12.13, Apple M3 (8 cores), arm64.

(1) gensim 4.4.0 (2025-10-16) ships a cp312 macosx_11_0_arm64 wheel, installs and works alongside numpy 2.5.3 — 4.4.0 added NumPy 2 support, so no numpy<2 pin is needed. But you do not need it. I range-downloaded the real release asset to confirm the format: jawiki.word_vectors.200d.txt.bz2 (616.5 MB, release tag 20190520, the newest — no release since 2019). Header line is "751361 200", then per line: token, single ASCII space, 200 space-separated decimal floats, ordered by descending corpus frequency, so line index IS freq_rank for free. A 25-line pure-numpy parser beat gensim ~3x on a 50k x 200 / 202 MB file (1.71 s vs 4.93 s), gives byte-identical float32, and removes gensim + scipy + smart_open (and an LGPL-2.1 dep) from the tree. Drop gensim.

(2) fugashi 1.5.2 (cp312 arm64 wheel) + unidic-lite 1.0.8 (sdist, pure data, ~248 MB installed, builds fine). Features are a 26-field namedtuple UnidicFeatures26: pos1,pos2,pos3,pos4,cType,cForm,lForm,lemma,orth,pron,orthBase,pronBase,goshu,iType,iForm,fType,fForm,kana,kanaBase,form,formBase,iConType,fConType,aType,aConType,aModeType. Two traps I verified: (a) use orthBase, NOT lemma, for 表層形==基本形 — lemma is the 語彙素 and is often katakana or hyphenated (東京→トウキョウ, タワー→タワー-tower, りんご→林檎), while orthBase is the 書字形基本形 and equals the surface for a base form; (b) 未知語 emit only 6 features so lemma/orthBase are None — check word.is_unk first. 代名詞 is its own pos1 (not under 名詞); 数詞 and 固有名詞 are pos2 under 名詞. Single-token-ness = len(tagger(s))==1.

(3) umap-learn 0.5.12 + numba 0.67.0 + llvmlite 0.49.0 all have cp312 arm64 wheels and work with numpy 2.5.3 and sklearn 1.9.1. Measured UMAP(n_components=3, metric='cosine') on 100k x 200 float32, M3 8-core: 15.9–21.4 s wall after JIT warm-up, plus a one-time ~10 s numba compile on the first fit of the process. Decisive flag: passing random_state forces single-threaded and cost 46.0 s vs 21.4 s with random_state=None. Defaults are already n_jobs=-1 and low_memory=True.

(4) psycopg 3.3.5 + pgvector 0.5.0. Use BINARY COPY with pgvector.psycopg.register_vector + copy.set_types([...,'halfvec']) — NOT a text literal. Measured on 100k x 200: HalfVector.to_binary() 0.12 s total, 404 bytes/row; HalfVector.to_text() 4.68 s, 3139 chars/row. Binary is ~40x faster to serialize and ~8x smaller on the wire. register_vector() fetches the OID from the DB, so CREATE EXTENSION vector must run first; create the HNSW index after the load.

(5) 100k x 200 float32 = 80.0 MB exactly. L2-normalize once, then M @ q. Measured: 1.82 ms per single query (matmul), 1.73 ms matmul+rank-count, 2.54 ms matmul+argpartition top-1000. Batching is the real win: M @ Q.T for 512 goals took 30.6 ms total = 0.06 ms/query, ~30x faster. Rank = int((s > s[goal_idx]).sum()) — no sort needed.

(6) Python 3.12 unicodedata is Unicode 15.0.0; Node 24.18 is Unicode 17.0 / ICU 78.3. I ran 22 NFKC cases through both and got byte-identical results, including ＡＢＣ１２３→ABC123, ﾊﾟｿｺﾝ→パソコン, ㈱→(株), ①→1, ㌔→キロ, ㋿→令和, ～(U+FF5E)→~ but 〜(U+301C) unchanged, U+2212 unchanged. Unicode's Normalization Stability Policy guarantees this for already-assigned characters; the only divergence risk is codepoints assigned in Unicode 16/17 that Python 3.12 treats as unassigned. For the script test I also verified a hand-written codepoint-range regex gives identical true/false in Python and Node across 18 cases including 𠮷野家 (astral plane).

(7) The repo the prompt guessed, MHidetoshi/NG-word, does not exist (GitHub API returns 404) — do not cite it. Two real, licensed lists exist and I verified line counts directly.


## 事実

- **[high]** gensim 4.4.0 is the current release, ships gensim-4.4.0-cp312-cp312-macosx_11_0_arm64.whl, requires_python >=3.9, requires only numpy>=1.18.5 / scipy>=1.7.0 / smart_open>=1.8.1; license LGPL-2.1-only
  - source: `https://pypi.org/pypi/gensim/json`
- **[high]** gensim 4.4.0 added NumPy 2.0 support (compatible with both 1.x and 2.0); py3.8 wheels dropped, py3.13 wheels added; released 2025-10-16
  - source: `https://github.com/piskvorky/gensim/releases`
- **[high]** VERIFIED LOCALLY: `uv pip install gensim` on Python 3.12.13 arm64 installed gensim==4.4.0 with numpy==2.5.3 and scipy==1.18.1; KeyedVectors.load_word2vec_format and most_similar both work
  - source: `local run, uv 0.12.0, Darwin 27.0.0 arm64`
- **[high]** VERIFIED: jawiki.word_vectors.200d.txt.bz2 (release 20190520) first line is exactly '751361 200'; subsequent lines are token + single space + 200 space-separated floats; ordered by descending frequency (first entries: 、 の 。 に を)
  - source: `https://github.com/singletongue/WikiEntVec/releases/download/20190520/jawiki.word_vectors.200d.txt.bz2 (first 3 MB range-fetched and bz2-decompressed)`
- **[high]** WikiEntVec latest release is tag 20190520 (published 2019-06-13). jawiki.word_vectors.200d.txt.bz2 is 616.5 MB compressed. Older 2018 releases use .txt.gz. No newer release exists as of 2026-09-17.
  - source: `https://api.github.com/repos/singletongue/WikiEntVec/releases`
- **[high]** WikiEntVec pre-trained vectors are licensed CC BY-SA 3.0; the source code is MIT. Entity files use underscores for spaces; all_vectors marks entities as ##Entity_Name##.
  - source: `https://github.com/singletongue/WikiEntVec`
- **[high]** VERIFIED BENCHMARK: parsing a 50,000 x 200 (202 MB) word2vec text file — gensim KeyedVectors 4.93 s vs pure numpy np.fromstring loop 1.74 s vs bytes-split + np.array 1.71 s. Results numerically identical (np.allclose atol=1e-6).
  - source: `local benchmark on Apple M3`
- **[high]** np.fromstring(s, dtype=np.float32, sep=' ') is NOT deprecated in numpy 2.5.3 (only the binary sep='' mode is); verified with -W error::DeprecationWarning
  - source: `local run, numpy 2.5.3`
- **[high]** fugashi 1.5.2 is current, requires_python >=3.9, ships cp312-macosx_11_0_arm64 wheels (and cp314/cp314t). unidic-lite 1.0.8 is sdist-only but pure data — builds in seconds, ~248 MB installed dicdir.
  - source: `https://pypi.org/pypi/fugashi/json + local install`
- **[high]** VERIFIED: fugashi + unidic-lite feature namedtuple is UnidicFeatures26 with fields ('pos1','pos2','pos3','pos4','cType','cForm','lForm','lemma','orth','pron','orthBase','pronBase','goshu','iType','iForm','fType','fForm','kana','kanaBase','form','formBase','iConType','fConType','aType','aConType','aModeType')
  - source: `local: Tagger()('東京')[0].feature._fields`
- **[high]** VERIFIED: lemma is unreliable for base-form comparison — 東京 has lemma='トウキョウ' orthBase='東京'; タワー has lemma='タワー-tower' orthBase='タワー'; りんご has lemma='林檎' orthBase='りんご'. Use surface == feature.orthBase for 表層形==基本形.
  - source: `local fugashi 1.5.2 / unidic-lite 1.0.8 run`
- **[high]** VERIFIED: 未知語 (e.g. '3', 'ｗｉｆｉ', 'ｱｲｳ') return only 6 comma-separated features; feature.lemma and feature.orthBase are None and word.is_unk is True. Must guard on is_unk.
  - source: `local fugashi run`
- **[high]** VERIFIED POS layout: 猫 = 名詞,普通名詞,一般; 東京 = 名詞,固有名詞,地名,一般; 3 = 名詞,数詞; 彼 = 代名詞,*,*,* (代名詞 is pos1, not a pos2 under 名詞); 走る = 動詞,一般 with cType=五段-ラ行; 美しい = 形容詞,一般
  - source: `local fugashi run`
- **[high]** umap-learn 0.5.12 requires numpy>=1.23, scipy>=1.3.1, scikit-learn>=1.6, numba>=0.51.2, pynndescent>=0.5, tqdm. Installed cleanly on py3.12 arm64 pulling numba 0.67.0 + llvmlite 0.49.0 (both have cp312 macosx_12_0_arm64 wheels) + sklearn 1.9.1, all on numpy 2.5.3.
  - source: `https://pypi.org/pypi/umap-learn/json + local install`
- **[high]** numba 0.67.0 requires llvmlite>=0.49.0,<0.50 and numpy>=1.22,<2.6 — so numpy 2.5.x is fine but numpy 2.6 will break numba until it bumps.
  - source: `https://pypi.org/pypi/numba/json`
- **[high]** MEASURED: UMAP(n_components=3, metric='cosine', low_memory=True) on 100,000 x 200 float32, Apple M3 8-core — 15.9 s (cold-process run including JIT) / 21.4 s (warm, random_state=None) / 46.0 s (random_state=42). First fit in a process pays ~10 s of numba compilation.
  - source: `local benchmark, umap-learn 0.5.12`
- **[high]** umap.UMAP defaults are already n_jobs=-1 and low_memory=True in 0.5.12. Passing random_state overrides n_jobs to 1 for reproducibility, roughly halving throughput.
  - source: `local: inspect.signature(umap.UMAP.__init__) + timing comparison`
- **[high]** psycopg 3.3.5 and pgvector 0.5.0 are current; pgvector.psycopg exports register_vector, register_vector_async, vector, halfvec, sparsevec, bit
  - source: `https://pypi.org/pypi/pgvector/json + local dir(pgvector.psycopg)`
- **[high]** pgvector.psycopg register_halfvec_info registers both a TEXT and a BINARY dumper for HalfVector carrying the resolved type OID, which is exactly what psycopg's copy.set_types(['halfvec']) needs. register_vector(conn) does a TypeInfo.fetch, so CREATE EXTENSION vector must already have run.
  - source: `site-packages/pgvector/psycopg/halfvec.py (read locally)`
- **[high]** MEASURED serialization of 100,000 x 200 halfvec rows: HalfVector.to_binary() 0.12 s total / 404 bytes per row; HalfVector.to_text() 4.68 s / 3139 chars per row. Binary COPY is ~40x cheaper to serialize and ~8x smaller on the wire.
  - source: `local benchmark, pgvector 0.5.0`
- **[high]** HalfVector casts to float16 before emitting, so any |value| > 65504 becomes inf and Postgres will reject it ('halfvec' disallows Inf/NaN). word2vec values are well inside range, but a NaN row will abort the whole COPY.
  - source: `local: HalfVector(np.float32([65600.0])).to_text() emits 'inf' with RuntimeWarning: overflow encountered in cast`
- **[high]** MEASURED nearest-neighbour: 100,000 x 200 float32 matrix = 80.0 MB (M.nbytes). Single query M @ q = 1.82 ms; matmul + rank-count = 1.73 ms; matmul + argpartition top-1000 + sort = 2.54 ms; batched M @ Q.T with 512 queries = 30.6 ms total (0.06 ms/query).
  - source: `local benchmark, numpy 2.5.3 on Apple M3 (Accelerate BLAS)`
- **[high]** VERIFIED NFKC parity: 22 test strings normalized identically by Python 3.12.13 unicodedata (Unicode 15.0.0) and Node v24.18.1 (ICU 78.3, Unicode 17.0), including ＡＢＣ１２３→ABC123, ﾊﾟｿｺﾝ→パソコン, ｶﾞ→ガ, ㈱→(株), ①→1, Ⅻ→XII, ㌔→キロ, ㋿→令和, U+3000→U+0020, ～(U+FF5E)→~ while 〜(U+301C) and U+2212 are unchanged.
  - source: `local side-by-side run of unicodedata.normalize('NFKC', s) vs s.normalize('NFKC')`
- **[medium]** Unicode's Normalization Stability Policy guarantees NFKC results never change for already-assigned characters, so the Python-15.0 vs Node-17.0 version gap can only diverge on codepoints assigned in Unicode 16.0/17.0 (Python 3.12 leaves unassigned codepoints untouched). Python 3.13 = Unicode 15.1, Python 3.14 = Unicode 16.0.
  - source: `https://www.unicode.org/policies/stability_policy.html#Normalization`
- **[high]** VERIFIED script-detection parity: an explicit codepoint-range regex gives identical results in Python re and JS /u regex on 18 cases including 𠮷野家 (U+20BB7, astral), ヶ月, 〆切, 한국어→false, 🍎→false, ﾊﾛｰ→(NFKC)→ハロー→true.
  - source: `local side-by-side Python/Node run`
- **[high]** MHidetoshi/NG-word DOES NOT EXIST — https://api.github.com/repos/MHidetoshi/NG-word returns HTTP 404. Do not cite it.
  - source: `https://api.github.com/repos/MHidetoshi/NG-word (404)`
- **[high]** MosasoM/inappropriate-words-ja — MIT License (Copyright (c) 2020 K Hashimoto), 212 stars. VERIFIED line counts: Sexual.txt 281 lines, Offensive.txt 49 lines, Sexual_with_mask.txt 2630 lines. Also Sexual_with_bopo.txt. UTF-8. Manually curated; masked/bopomofo variants are mechanically generated and lower precision.
  - source: `https://github.com/MosasoM/inappropriate-words-ja`
- **[high]** LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words — CC BY 4.0. VERIFIED: the 'ja' file has 180 lines, one term per line, lowercase, some containing spaces (e.g. 'g スポット', 's ＆ m'). Sexual/obscene focus only; essentially no 差別語 or 暴力表現 coverage.
  - source: `https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/ja`
- **[high]** textlint-ja/textlint-rule-ja-no-inappropriate-words is MIT but its dictionary is just re-packaged from MosasoM/inappropriate-words-ja — not an independent source.
  - source: `https://github.com/textlint-ja/textlint-rule-ja-no-inappropriate-words`
- **[high]** shokai's 放送禁止用語リスト gist (words.txt, 3925 bytes) exists and is reachable, but a GitHub gist carries NO license grant by default — legally unsafe to vendor into a repo without asking.
  - source: `https://gist.github.com/shokai/3066551`
- **[medium]** No public, maintained, openly-licensed Japanese 差別語 (discriminatory-term) list was found on GitHub. The commonly-cited references (monoroch.net 放送禁止用語一覧, 日本新聞協会 用語集) are web pages/books without an open license.
  - source: `GitHub code+repo search across NGワード / 不適切 / 禁句 / profanity queries, 2026-09-17`

## コード片

### pyproject.toml — recommended dependency set (no gensim)

```toml
[project]
name = "coto2ba-pipeline"
requires-python = ">=3.12,<3.13"
dependencies = [
  "numpy>=2.0,<2.6",        # <2.6 because numba 0.67 pins numpy<2.6
  "fugashi>=1.5.2",
  "unidic-lite>=1.0.8",
  "umap-learn>=0.5.12",
  "psycopg[binary]>=3.3.5",
  "pgvector>=0.5.0",
  "tqdm",
]
# gensim is NOT needed: see load_w2v_text() below.
# If you want it anyway, gensim>=4.4.0 is numpy-2 clean on py3.12 arm64.

[tool.ruff]
target-version = "py312"

```

### 1. w2v text/bz2 loader — pure numpy, ~3x faster than gensim, streams and stops early

```python
from __future__ import annotations

import bz2
import gzip
import io
from pathlib import Path

import numpy as np


def _open_text(path: Path) -> io.TextIOBase:
    if path.suffix == ".bz2":
        return bz2.open(path, "rt", encoding="utf-8", newline="\n")
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8", newline="\n")
    return path.open("rt", encoding="utf-8", newline="\n")


def load_w2v_text(
    path: str | Path, limit: int | None = None
) -> tuple[list[str], np.ndarray]:
    """Read a word2vec *text* file (WikiEntVec jawiki.word_vectors.200d.txt[.bz2]).

    Verified format of that file:
      line 1     : "751361 200"          <- vocab_size SP dim
      line 2..N+1: "<token> <f1> <f2> ... <f200>"   single ASCII spaces
      rows are ordered by DESCENDING corpus frequency,
      so the row index IS the frequency rank (0 = most frequent).

    Returns (words, vectors[float32, C-contiguous]).
    `limit` truncates to the first N (= most frequent N) rows.
    """
    path = Path(path)
    with _open_text(path) as f:
        header = f.readline()
        n_vocab, dim = (int(x) for x in header.split())
        n = n_vocab if limit is None else min(limit, n_vocab)

        words: list[str] = []
        vecs = np.empty((n, dim), dtype=np.float32)

        for i, line in enumerate(f):
            if i >= n:
                break
            word, _, rest = line.rstrip("\n").partition(" ")
            # np.fromstring(sep=' ') is NOT deprecated (only the binary form is)
            row = np.fromstring(rest, dtype=np.float32, sep=" ")
            if row.shape[0] != dim:  # malformed / token containing a space
                continue
            words.append(word)
            vecs[len(words) - 1] = row

    vecs = vecs[: len(words)]
    return words, vecs


if __name__ == "__main__":
    words, vecs = load_w2v_text(
        "data/jawiki.word_vectors.200d.txt.bz2", limit=300_000
    )
    print(len(words), vecs.shape, vecs.dtype, f"{vecs.nbytes / 1e6:.0f} MB")
    # freq_rank of words[i] is simply i

```

### 2. fugashi + unidic-lite POS classifier (品詞 / 基本形 / 単一形態素)

```python
from __future__ import annotations

from dataclasses import dataclass

from fugashi import Tagger

# UnidicFeatures26 field layout (unidic-lite 1.0.8, confirmed via feature._fields):
#   pos1 pos2 pos3 pos4 cType cForm lForm lemma orth pron orthBase pronBase
#   goshu iType iForm fType fForm kana kanaBase form formBase
#   iConType fConType aType aConType aModeType
#
# pos1     : 名詞 / 動詞 / 形容詞 / 代名詞 / 副詞 / 助詞 / 助動詞 / 接尾辞 / ...
# pos2     : under 名詞 -> 普通名詞 | 固有名詞 | 数詞 | 助動詞語幹
#            under 動詞/形容詞 -> 一般 | 非自立可能
# pos3/4   : 固有名詞 subtypes (地名/人名/一般 ...) — 東京 = 名詞,固有名詞,地名,一般
# cType    : 活用型 (五段-ラ行 ...)  cForm: 活用形 (連体形-一般 ...)
# lemma    : 語彙素 — NORMALIZED, may be katakana or hyphenated:
#            東京->'トウキョウ', タワー->'タワー-tower', りんご->'林檎'.  DO NOT use for base-form eq.
# orthBase : 書字形基本形 — THIS is what you compare the surface against.
# 未知語 emit only 6 features -> lemma/orthBase are None and word.is_unk is True.

_TAGGER = Tagger()

CONTENT_POS1 = {"名詞", "動詞", "形容詞"}
# 代名詞 is its own pos1 in UniDic, so it is already excluded by CONTENT_POS1.
NOUN_REJECT_POS2 = {"固有名詞", "数詞", "助動詞語幹"}


@dataclass(frozen=True)
class WordInfo:
    surface: str
    ok: bool
    reason: str
    pos1: str
    pos2: str
    orth_base: str | None
    lemma: str | None
    n_tokens: int


def analyze(surface: str) -> WordInfo:
    toks = _TAGGER(surface)
    n = len(toks)
    if n == 0:
        return WordInfo(surface, False, "empty", "", "", None, None, 0)

    # --- single-token-ness ---
    if n != 1:
        t = toks[0]
        return WordInfo(
            surface, False, "multi_token",
            t.feature.pos1 or "", t.feature.pos2 or "", None, None, n,
        )

    t = toks[0]
    f = t.feature
    pos1, pos2 = f.pos1 or "", f.pos2 or ""

    # --- 未知語 guard MUST come first: orthBase/lemma are None ---
    if t.is_unk:
        return WordInfo(surface, False, "unknown_word", pos1, pos2, None, None, 1)

    # --- 名詞/動詞/形容詞 only ---
    if pos1 not in CONTENT_POS1:
        return WordInfo(surface, False, f"pos1:{pos1}", pos1, pos2, f.orthBase, f.lemma, 1)

    # --- 普通名詞 only: reject 固有名詞 / 数詞 / 代名詞(already out via pos1) ---
    if pos1 == "名詞" and pos2 in NOUN_REJECT_POS2:
        return WordInfo(surface, False, f"pos2:{pos2}", pos1, pos2, f.orthBase, f.lemma, 1)

    # --- 表層形 == 基本形 (辞書形) ---
    if t.surface != f.orthBase:
        return WordInfo(surface, False, "inflected", pos1, pos2, f.orthBase, f.lemma, 1)

    return WordInfo(surface, True, "ok", pos1, pos2, f.orthBase, f.lemma, 1)


# Verified output on this machine:
#   りんご      ok=True  名詞/普通名詞 orth_base='りんご' lemma='林檎'
#   猫          ok=True  名詞/普通名詞
#   走る        ok=True  動詞/一般
#   走っ        ok=False reason='inflected'   (orthBase='走る')
#   美しい      ok=True  形容詞/一般
#   美しく      ok=False reason='inflected'
#   東京        ok=False reason='pos2:固有名詞' (lemma='トウキョウ'!)
#   3           ok=False reason='unknown_word' (pos2='数詞', orthBase=None)
#   彼          ok=False reason='pos1:代名詞'
#   ゆっくり    ok=False reason='pos1:副詞'
#   東京タワー  ok=False reason='multi_token'  (n_tokens=2)
#   三つ        ok=False reason='multi_token'
#   タワー      ok=True  名詞/普通名詞 (lemma='タワー-tower', orthBase='タワー')

```

### 3. UMAP 3D projection — correct flags for M-series speed

```python
import time

import numpy as np
import umap


def project_3d(vecs: np.ndarray, *, seed: int | None = None) -> np.ndarray:
    """100k x 200 float32 -> 100k x 3 float32.

    Measured on Apple M3 (8 cores), umap-learn 0.5.12 / numba 0.67.0:
      seed=None  ->  ~16 s cold (incl. ~10 s numba JIT) / ~21 s warm
      seed=42    ->  ~46 s      <-- random_state forces n_jobs=1
    n_jobs=-1 and low_memory=True are ALREADY the 0.5.12 defaults.
    """
    reducer = umap.UMAP(
        n_components=3,
        metric="cosine",
        n_neighbors=15,
        min_dist=0.1,
        low_memory=True,   # default; keep pynndescent's memory bounded
        n_jobs=-1,         # default; silently forced to 1 if random_state is set
        random_state=seed, # leave None in production for the 2x speedup
        verbose=True,
    )
    t0 = time.time()
    out = reducer.fit_transform(vecs).astype(np.float32)
    print(f"UMAP {vecs.shape} -> {out.shape} in {time.time() - t0:.1f}s")
    return out


# If you need reproducible coordinates, do NOT pay the random_state penalty:
# run once with seed=None and persist the resulting 3 floats per word in Postgres.

```

### 4. Fast bulk COPY into pgvector halfvec (psycopg3 BINARY COPY)

```python
from __future__ import annotations

from collections.abc import Iterable, Sequence

import numpy as np
import psycopg
from pgvector import HalfVector
from pgvector.psycopg import register_vector

DDL = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS words (
  word       text PRIMARY KEY,
  freq_rank  integer     NOT NULL,
  is_input   boolean     NOT NULL,
  is_output  boolean     NOT NULL,
  pos        text        NOT NULL,
  w2v        halfvec(200) NOT NULL
);
"""


def bulk_load(
    dsn: str,
    words: Sequence[str],
    freq_rank: np.ndarray,   # int32/int64, len N
    is_input: np.ndarray,    # bool, len N
    is_output: np.ndarray,   # bool, len N
    pos: Sequence[str],
    w2v: np.ndarray,         # (N, 200) float32
) -> None:
    assert w2v.dtype == np.float32 and w2v.shape[1] == 200
    if not np.isfinite(w2v).all():
        raise ValueError("w2v contains NaN/Inf — Postgres halfvec rejects these")
    if np.abs(w2v).max() > 65504.0:
        raise ValueError("value exceeds float16 range; halfvec cast would yield inf")

    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(DDL)
        # MUST come after CREATE EXTENSION: it fetches the halfvec OID from the DB
        # and registers the binary dumper that set_types(['halfvec']) resolves.
        register_vector(conn)

        conn.execute("TRUNCATE words")
        sql = (
            "COPY words (word, freq_rank, is_input, is_output, pos, w2v) "
            "FROM STDIN WITH (FORMAT BINARY)"
        )
        with conn.cursor().copy(sql) as copy:
            # PostgreSQL type names, in column order.
            copy.set_types(["text", "integer", "boolean", "boolean", "text", "halfvec"])
            for i, w in enumerate(words):
                copy.write_row(
                    (
                        w,
                        int(freq_rank[i]),
                        bool(is_input[i]),
                        bool(is_output[i]),
                        pos[i],
                        HalfVector(w2v[i]),  # -> 404 bytes on the wire for dim=200
                    )
                )

        # Always build the ANN index AFTER the bulk load.
        conn.execute("SET maintenance_work_mem = '2GB'")
        conn.execute("SET max_parallel_maintenance_workers = 7")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS words_w2v_hnsw "
            "ON words USING hnsw (w2v halfvec_cosine_ops)"
        )
        conn.execute("ANALYZE words")


# Measured serialization cost for 100,000 x 200 rows (Apple M3):
#   HalfVector(...).to_binary()  0.12 s total,  404 bytes/row   <-- BINARY COPY
#   HalfVector(...).to_text()    4.68 s total, 3139 chars/row   <-- ~40x slower, 8x bigger

```

### 4b. Text-COPY fallback (only if you cannot use the binary path)

```python
import numpy as np
import psycopg


def bulk_load_text(dsn: str, rows, w2v: np.ndarray) -> None:
    """Fallback: psycopg TEXT copy with an explicit halfvec literal '[a,b,...]'.

    Cast to float16 FIRST so the literal exactly matches what Postgres stores
    (otherwise you write float32 precision the column silently truncates).
    ~40x slower to serialize than BINARY — use only for debugging.
    """
    h = w2v.astype(np.float16)
    with psycopg.connect(dsn, autocommit=True) as conn, conn.cursor() as cur:
        sql = (
            "COPY words (word, freq_rank, is_input, is_output, pos, w2v) FROM STDIN"
        )
        with cur.copy(sql) as copy:
            for i, (word, rank, is_in, is_out, pos) in enumerate(rows):
                lit = "[" + ",".join(map(str, h[i].tolist())) + "]"
                copy.write_row((word, int(rank), bool(is_in), bool(is_out), pos, lit))

```

### 5. goal_pool rank engine — normalize once, batched matmul, argpartition

```python
from __future__ import annotations

import numpy as np


class RankEngine:
    """rank(word, goal) over ~100k output words, thousands of times.

    Memory: 100_000 x 200 float32 == 80.0 MB exactly (measured M.nbytes).
            The batched score buffer is the real cost: N x B float32,
            e.g. 100k x 512 == 205 MB. Pick B to fit your budget.

    Timings on Apple M3 / numpy 2.5.3 (Accelerate BLAS), N=100k D=200:
      M @ q                              1.82 ms  (single query)
      M @ q  + (s > s[g]).sum()          1.73 ms  (rank, no sort needed)
      M @ q  + argpartition top-1000     2.54 ms
      M @ Q.T with B=512                30.6 ms total == 0.06 ms/query  <-- 30x win
    So: 5,000 goals singly ~= 9 s; batched ~= 0.3 s.
    """

    def __init__(self, vecs: np.ndarray, words: list[str]) -> None:
        # Normalize ONCE. float32, C-contiguous -> BLAS sgemm.
        M = np.ascontiguousarray(vecs, dtype=np.float32)
        norms = np.linalg.norm(M, axis=1, keepdims=True)
        np.maximum(norms, 1e-12, out=norms)
        self.M = M / norms                      # (N, D) unit rows
        self.words = words
        self.index = {w: i for i, w in enumerate(words)}

    # ---- single query ------------------------------------------------
    def rank(self, word_idx: int, goal_idx: int) -> int:
        """0-based rank of `word` among all rows by cosine sim to `goal`.
        No sort: just count how many rows score strictly higher."""
        s = self.M @ self.M[goal_idx]           # (N,) cosine sims, 1.8 ms
        return int((s > s[word_idx]).sum())

    def top_k(self, goal_idx: int, k: int = 1000) -> tuple[np.ndarray, np.ndarray]:
        s = self.M @ self.M[goal_idx]
        idx = np.argpartition(-s, k)[:k]        # O(N), no full sort
        idx = idx[np.argsort(-s[idx])]          # sort only the k survivors
        return idx, s[idx]

    # ---- batched: ALWAYS use this for the difficulty bot --------------
    def ranks_batched(
        self, goal_indices: np.ndarray, batch: int = 512
    ) -> np.ndarray:
        """Return ranks[g, :] = rank of every row w.r.t. goal g.
        Only materialize what you need — here we return the rank of each
        goal's own top-K neighbours to keep memory sane."""
        out: list[np.ndarray] = []
        for start in range(0, len(goal_indices), batch):
            gi = goal_indices[start : start + batch]
            S = self.M @ self.M[gi].T           # (N, B) — one sgemm, 0.06 ms/col
            # rank of every row for every goal, without sorting N per column:
            order = np.argsort(-S, axis=0)      # (N, B); this IS the expensive part
            r = np.empty_like(order)
            np.put_along_axis(
                r, order, np.arange(S.shape[0])[:, None].repeat(S.shape[1], 1), axis=0
            )
            out.append(r)
        return np.concatenate(out, axis=1)

    def ranks_of_pairs(
        self, word_idx: np.ndarray, goal_idx: np.ndarray, batch: int = 512
    ) -> np.ndarray:
        """Cheapest form: rank of ONE word per goal. Pure counting, no sort.
        ~0.1 ms per pair amortized at batch=512."""
        ranks = np.empty(len(goal_idx), dtype=np.int32)
        for start in range(0, len(goal_idx), batch):
            sl = slice(start, start + batch)
            S = self.M @ self.M[goal_idx[sl]].T           # (N, B)
            target = S[word_idx[sl], np.arange(S.shape[1])]  # (B,)
            ranks[sl] = (S > target[None, :]).sum(axis=0)
        return ranks

```

### 6. Normalization + Japanese-script check, byte-identical to the TS server

```python
import re
import unicodedata

# Codepoint ranges chosen so the SAME literal works in Python `re` and JS /u.
# Do NOT use \p{Script=Han}: Python's stdlib `re` has no \p at all, and JS's
# \p{Script=Han} covers strictly more than U+4E00..U+9FFF — the two would drift.
_JP_PATTERN = (
    "["
    "ぁ-ゟ"          # ひらがな (+ ゛ ゜ ゝ ゞ)
    "゠-ヿ"          # カタカナ (+ ー U+30FC, ヶ U+30F6, ヴ U+30F4)
    "ㇰ-ㇿ"          # カタカナ拡張
    "々〆〻"     # 々 〆 〻
    "㐀-䶿"          # CJK ext A
    "一-鿿"          # CJK 統合漢字
    "豈-﫿"          # CJK 互換漢字
    "\U00020000-\U0002ffff"  # CJK ext B..F (astral — needs /u in JS)
    "]"
)
JP_RE = re.compile(_JP_PATTERN)


def normalize_word(s: str) -> str:
    """Exactly equivalent to TS: s.normalize('NFKC').trim()

    NFKC already does 全角英数 -> 半角 (ＡＢＣ１２３ -> ABC123) AND
    半角カナ -> 全角カナ with dakuten composition (ﾊﾟｿｺﾝ -> パソコン, ｶﾞ -> ガ).
    Do NOT hand-roll a zenkaku->hankaku table on top of it.

    Side effects you must accept (verified identical in Node):
      ① -> 1     Ⅻ -> XII   ㌔ -> キロ   ㈱ -> (株)   ㋿ -> 令和
      U+3000 -> U+0020,  ～ U+FF5E -> ~ ,  but 〜 U+301C is UNCHANGED
      U+2212 MINUS SIGN is UNCHANGED (NFKC does not fold it to '-')
    """
    return unicodedata.normalize("NFKC", s).strip()


def has_japanese(s: str) -> bool:
    """True iff `s` contains >=1 hiragana / katakana / kanji character.
    Call on the ALREADY-normalized string, so ﾊﾛｰ -> ハロー -> True."""
    return JP_RE.search(s) is not None


# Verified identical in Python 3.12.13 (Unicode 15.0) and Node v24.18.1 (Unicode 17.0):
#   ＡＢＣ->ABC False | りんご True | リンゴ True | 林檎 True | １２３->123 False
#   々 True | 𠮷野家 True | ﾊﾛｰ->ハロー True | ヶ月 True | 〆切 True
#   한국어 False | 中文 True | 🍎 False | ヴ True

```

### 6b. The matching TypeScript side (packages/contracts) — keep these in lockstep

```typescript
// MUST mirror tools/pipeline/.../normalize.py exactly.
// The `u` flag is mandatory: without it the astral range \u{20000}-\u{2FFFF}
// is parsed as UTF-16 code units and silently matches the wrong things.
export const JP_RE =
  /[ぁ-ゟ゠-ヿㇰ-ㇿ々〆〻㐀-䶿一-鿿豈-﫿]|[\u{20000}-\u{2FFFF}]/u;

export function normalizeWord(s: string): string {
  return s.normalize("NFKC").trim();
}

export function hasJapanese(s: string): boolean {
  return JP_RE.test(s); // no /g flag -> no lastIndex statefulness
}

```

### 7. NG-word list bootstrap — fetch, normalize, merge (real sources only)

```python
"""Build tools/pipeline/data/ngwords.txt from publicly licensed sources.

SOURCES (verified reachable 2026-09-17 — attribution is REQUIRED, record it):
  1. MosasoM/inappropriate-words-ja                       MIT, (c) 2020 K Hashimoto
       Sexual.txt            281 lines   性的表現
       Offensive.txt          49 lines   攻撃的/差別的表現 (作者自身が"暫定版"と明記)
       Sexual_with_mask.txt 2630 lines   伏せ字バリエーション (機械生成、精度低め)
  2. LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words   CC BY 4.0
       ja                    180 lines   性的表現のみ。差別語・暴力表現はほぼ無い。

NOT USABLE:
  - MHidetoshi/NG-word            -> does not exist (HTTP 404). Do not cite.
  - gist.github.com/shokai/3066551 (放送禁止用語リスト, words.txt 3925B)
       -> reachable, but a gist carries NO license grant. Ask before vendoring.
  - monoroch.net 放送禁止用語一覧 / 日本新聞協会 用語集 -> no open license.

GAP: there is NO maintained, openly-licensed Japanese 差別語 list on GitHub.
Combined coverage above is ~450 unique terms, heavily skewed to 性的表現.
暴力表現 coverage is essentially zero. Plan a hand-curated supplement.
"""

import unicodedata
import urllib.request
from pathlib import Path

SOURCES = {
    "mosasom-sexual": "https://raw.githubusercontent.com/MosasoM/inappropriate-words-ja/master/Sexual.txt",
    "mosasom-offensive": "https://raw.githubusercontent.com/MosasoM/inappropriate-words-ja/master/Offensive.txt",
    "ldnoobw-ja": "https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/ja",
}


def fetch_ng_words() -> set[str]:
    out: set[str] = set()
    for name, url in SOURCES.items():
        body = urllib.request.urlopen(url, timeout=30).read().decode("utf-8")
        n = 0
        for line in body.splitlines():
            # Normalize with the SAME function the server uses, or lookups miss.
            w = unicodedata.normalize("NFKC", line).strip().lower()
            if not w or w.startswith("#"):
                continue
            out.add(w)
            n += 1
        print(f"{name}: {n} terms")
    return out


def write_list(path: Path) -> None:
    words = sorted(fetch_ng_words())
    path.write_text(
        "# Merged NG-word list. DO NOT EDIT the fetched section by hand.\n"
        "# Sources & licenses:\n"
        "#   MosasoM/inappropriate-words-ja  (MIT, (c) 2020 K Hashimoto)\n"
        "#   LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words (CC BY 4.0)\n"
        + "\n".join(words)
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(words)} unique terms -> {path}")


if __name__ == "__main__":
    write_list(Path("tools/pipeline/data/ngwords.txt"))

```


## リスク

- `lemma` vs `orthBase`: using fugashi's `feature.lemma` for the 表層形==基本形 check silently mis-filters. 東京 has lemma='トウキョウ', タワー has lemma='タワー-tower', りんご has lemma='林檎'. Every katakana/kanji-variant word would be wrongly rejected. Use `word.surface == word.feature.orthBase`.
- fugashi 未知語 return only 6 of the 26 feature fields, so `feature.orthBase` and `feature.lemma` are `None`. Comparing `surface != None` or calling `.strip()` on them raises/misbehaves. Check `word.is_unk` BEFORE touching orthBase/lemma. Every digit ('3', '５') hits this path.
- 代名詞 is a top-level pos1 in UniDic, NOT a pos2 under 名詞. A filter written as `pos1=='名詞' and pos2 not in {'固有名詞','数詞','代名詞'}` will never exclude 彼/これ/それ because they never reach that branch.
- pgvector's HalfVector casts to float16 before emitting. Any value beyond ±65504 becomes `inf` (with only a RuntimeWarning), and Postgres rejects Inf/NaN in halfvec — aborting the entire COPY after you have already streamed 100k rows. Validate `np.isfinite(w2v).all()` and the magnitude before starting the COPY.
- `register_vector(conn)` does a live `TypeInfo.fetch` for the halfvec OID. Calling it before `CREATE EXTENSION vector` leaves HalfVector unregistered, and `copy.set_types(['halfvec'])` then fails at COPY time, not at connect time.
- Using text COPY with a halfvec literal built from float32 writes precision Postgres silently truncates, so your Python-side vectors and the DB's stored vectors diverge and rank computations disagree between pipeline and server. Cast to float16 first, or just use BINARY COPY.
- Passing `random_state` to UMAP silently forces `n_jobs=1` — measured 46.0 s vs 21.4 s on 100k x 200. If you set a seed "for reproducibility" you pay 2x every run, on every dimension sweep.
- numba 0.67.0 pins `numpy<2.6`. When numpy 2.6 lands, an unpinned `uv sync` will either downgrade numpy or fail to resolve umap-learn. Pin `numpy>=2.0,<2.6` in pyproject.toml.
- jawiki.word_vectors.200d is distributed as `.txt.bz2` (616.5 MB), not `.txt`. bz2 decompression is single-threaded and slow; decompress once to a local `.txt` (~3 GB) or stream and `break` at your row limit rather than re-reading the bz2 on every pipeline step.
- The full 751,361 x 200 float32 matrix is 601 MB in RAM, and UMAP + pynndescent on top of it will push peak RSS well past that. Filter to the top ~100–150k by frequency BEFORE the UMAP and rank steps.
- In `RankEngine.ranks_batched`, the `np.argsort(-S, axis=0)` over a (100k, 512) block is the expensive operation (the matmul itself is only 30 ms). If you only need the rank of one specific word per goal, use `ranks_of_pairs` which counts instead of sorting.
- NFKC parity between Python 3.12 (Unicode 15.0) and Node (Unicode 17.0) holds for all assigned characters by Unicode's stability policy, but a codepoint assigned in Unicode 16.0/17.0 with a compatibility decomposition would normalize in Node and pass through untouched in Python. Low probability for Japanese game words, but it means the pipeline's NG-word/dedup keys could miss a server-normalized input. Pin behaviour by normalizing on ONE side (the server) and storing already-normalized keys.
- The React Native / Expo Go client runs Hermes, whose `String.prototype.normalize` and `\p{...}` regex support differ from Node's full-ICU V8. Per CLAUDE.md the server owns validation — do not replicate this check on the client and assume it agrees.
- Combined open NG-word coverage is only ~450 unique terms and is overwhelmingly 性的表現. 差別語 coverage is one 49-line file the author himself labels 暫定版, and 暴力表現 coverage is essentially nil. For a public exhibition this is not sufficient on its own — treat it as a seed, add a hand-curated 差別語/暴力表現 supplement, and pair it with a runtime report/override path.
- Both lists are attribution-required licenses (MIT and CC BY 4.0). Vendoring the terms into the repo obliges you to ship the copyright notices. Keep the header block in ngwords.txt and add both to a NOTICE/THIRD_PARTY file.
- WikiEntVec pre-trained vectors are CC BY-SA 3.0 — a share-alike license. Derived vector data you redistribute (including a public DB dump) inherits that obligation. The MIT license covers only their code, not the vectors.

## 結論

Drop gensim entirely. The only thing you need from it is a word2vec-text reader, and a 25-line numpy parser is 3x faster (1.71 s vs 4.93 s on 50k x 200), byte-identical, and removes gensim + scipy + smart_open and an LGPL-2.1 dependency from the pipeline. The WikiEntVec file format is confirmed simple: header "751361 200", then token + single space + 200 space-separated floats, frequency-sorted so the row index is your freq_rank for free. Stream it straight out of the .bz2 and `break` at your top-N cutoff — filter to roughly the top 100–150k rows before anything downstream, because the full 751k x 200 float32 matrix is 601 MB.

Pin `requires-python = ">=3.12,<3.13"` and `numpy>=2.0,<2.6` (numba 0.67 caps numpy at <2.6). Everything else — fugashi 1.5.2, unidic-lite 1.0.8, umap-learn 0.5.12, numba 0.67.0, llvmlite 0.49.0, psycopg 3.3.5, pgvector 0.5.0 — has working cp312 arm64 wheels and installs cleanly on numpy 2.5.3. I verified this whole set in a real uv venv on this machine.

For POS filtering, the single most important thing is: compare `word.surface` against `feature.orthBase`, never `feature.lemma`. And guard on `word.is_unk` first, because 未知語 return only 6 of 26 feature fields and leave orthBase/lemma as None. Accept 名詞/動詞/形容詞 at pos1, reject 固有名詞/数詞 at pos2, and note that 代名詞 is its own pos1 so it falls out automatically. Single-token-ness is just `len(tagger(s)) == 1`.

Run UMAP with `random_state=None`. It is 21 s vs 46 s on 100k x 200 on an M3, because a seed silently forces `n_jobs=1`. `n_jobs=-1` and `low_memory=True` are already the 0.5.12 defaults. If you want stable coordinates, run it once and persist the three floats per word — do not pay the seed penalty on every run.

Load Postgres with psycopg3 BINARY COPY plus `register_vector` and `copy.set_types([..., 'halfvec'])`. Measured: 404 bytes and 0.12 s total serialization for 100k rows, against 3139 bytes and 4.68 s for the text-literal path. Call `CREATE EXTENSION vector` before `register_vector`, validate `np.isfinite(w2v).all()` before streaming (a single NaN aborts the whole COPY), and build the HNSW index after the load.

For the difficulty bot, normalize the matrix once at startup (100k x 200 float32 = 80 MB) and batch the goals. A single query costs 1.8 ms, but `M @ Q.T` with 512 goals costs 30 ms total — 0.06 ms per query, a 30x win. Compute rank by counting `(S > target).sum(axis=0)` rather than sorting; you never need a full argsort unless you actually want the ordered neighbour list.

Use explicit codepoint ranges for the Japanese-script test in both Python and TypeScript, not `\p{Script=Han}` — Python's stdlib `re` has no `\p` at all, and JS's `\p{Script=Han}` covers a strictly larger set, so the two would drift. I ran 18 cases through both implementations and got identical results including the astral-plane 𠮷野家. `unicodedata.normalize('NFKC', s).strip()` is exactly `s.normalize('NFKC').trim()` across all 22 cases I tested; NFKC already handles 全角英数→半角 and 半角カナ→全角カナ with dakuten composition, so do not layer a hand-rolled conversion table on top of it.

On NG words: `MHidetoshi/NG-word` does not exist — the GitHub API returns 404, so do not cite it anywhere. Seed from MosasoM/inappropriate-words-ja (MIT, Sexual.txt 281 lines + Offensive.txt 49 lines) and LDNOOBW's `ja` file (CC BY 4.0, 180 lines), normalize both through the same NFKC path, and record both attributions in a NOTICE file. But be honest in docs/QUESTIONS.md about the gap: that is roughly 450 terms, almost entirely 性的表現, with one 49-line 差別語 file its own author calls 暫定版 and effectively no 暴力表現 coverage. There is no maintained, openly-licensed Japanese 差別語 list on GitHub. For a public exhibition, treat the open lists as a seed, add a hand-curated supplement reviewed by a human before the event, and ship a runtime override table so a bad word can be blocked without a redeploy. Also flag to the team that the WikiEntVec vectors themselves are CC BY-SA 3.0, which is share-alike and attaches to any derived vector data you publish.

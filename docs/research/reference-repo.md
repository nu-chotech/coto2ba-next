# coto2-ba (コトコトバ) hackathon reference implementation — full teardown of vector algorithms, game state machine, UI components and visual tiers

## 要約

The reference is three repos: the umbrella `nu-chotech/coto2-ba` (README + docs only; `frontend/` and `backend/` are git submodules that a plain `--depth 1` clone leaves empty), `coto2-ba-backend` (FastAPI + gensim), and `coto2-ba-frontend` (Next.js 16 / React 19 / Tailwind v4 / shadcn / motion). I cloned all three: /tmp/coto2-ba-ref, /tmp/coto2-ba-backend, /tmp/coto2-ba-frontend.

Backend is tiny and entirely in /tmp/coto2-ba-backend/app/services/vector_engine.py. Model: WikiEntVec `jawiki.word_vectors.200d.txt` (588MB, text format), loaded once at module import in the router. Two endpoints: POST /vector/init and POST /vector/calc, goal word is the client-supplied string "100億" (hardcoded in the frontend, NOT server-enforced).

Core semantics, exactly: mixing is `v_new = (1 - mix_ratio) * vec[current] + mix_ratio * vec[input]` on RAW (unnormalized) vectors. `_nearest_word` takes `similar_by_vector(v, topn=10)` (gensim cosine over unit-normed vectors) and returns the first candidate not in `{current_word, input_word}`, falling back to candidates[0]. `_rank` is `gensim KeyedVectors.rank(goal, word)` = `1 + len(closer_than(goal, word))`, where closer_than counts vocabulary entries with strictly smaller cosine distance to goal, excluding goal itself — so it is 1-based and the goal's nearest neighbour also scores rank 1. Returns 0 when either word is OOV; the client treats 0 as "unmeasured", displayed as "—", never a clear. Hints: `v_hint = 0.8*vec[base] + 0.2*vec[goal]` (hint_ratio=0.2), `similar_by_vector(topn=100)`, filter out a forbidden set, take first 6. On init the forbidden set is `{start_word, goal_word}`; on calc it is `{current, input, new_word, goal}`. Description comes from a live Wikipedia (ja) search+summary(sentences=1) call per request, with three canned fallbacks. OOV input → ValueError → HTTP 422 with a Japanese message.

Frontend game loop lives in src/hooks/useGameState.ts — a single `GameState` object, not a discriminated state machine. CLEAR_RANK = 10, clear iff `rank > 0 && rank <= 10`. History keeps only the last 5, newest-first. Shuffle re-calls init and is allowed only while moveCount === 0.

Visual tiers are computed purely from `currentRank` in two functions in src/app/game/page.tsx and RankDisplay.tsx: rank 0 → gray-50/gray-400; 1–10 → amber/yellow gradient + amber-500 numerals (黄金); 11–999 → slate-900 + violet-400 (宇宙, `isDark` true); 1000–9999 → indigo-50→white + indigo-500; ≥10000 → gray-50 + gray-400 (白黒). Background transitions with `transition-colors duration-700`. The signature interaction is not a slider at all: MixSlider is a 224px iPod-style circular wheel with a draggable handle on a ring (r=82, stroke 30) and a 96px central "混ぜる" button showing a SlidingNumber percentage.

There are NO NG-word lists, no start-word list beyond 16 fixed candidates, no rate limiting, no server-side goal enforcement, and no per-session state at all — the server is stateless and trusts every client field.


## 事実

- **[high]** The umbrella repo github.com/nu-chotech/coto2-ba contains only README.md, docs/ and assets/; frontend/ and backend/ are git submodules pointing at coto2-ba-frontend.git and coto2-ba-backend.git — a `git clone --depth 1` without --recursive yields empty dirs.
  - source: `/tmp/coto2-ba-ref/.gitmodules`
- **[high]** Backend stack: FastAPI (fastapi[standard]>=0.134.0), gensim>=4.4.0, wikipedia>=1.4.0, Python 3.11+, uv + taskipy + ruff. Deployed to Render (render.yaml, healthCheckPath '/').
  - source: `/tmp/coto2-ba-backend/pyproject.toml, /tmp/coto2-ba-backend/render.yaml`
- **[high]** word2vec model is WikiEntVec jawiki.word_vectors.200d.txt (200 dimensions), downloaded from https://github.com/singletongue/WikiEntVec/releases/download/20190520/jawiki.word_vectors.200d.txt.bz2, ~588MB uncompressed, loaded with KeyedVectors.load_word2vec_format(MODEL_PATH, binary=False).
  - source: `/tmp/coto2-ba-backend/scripts/download_model.sh, /tmp/coto2-ba-backend/app/services/vector_engine.py, /tmp/coto2-ba-ref/README.md`
- **[high]** Mixing formula is linear interpolation on raw, non-normalized vectors: v_new = (1.0 - mix_ratio) * model[current_word] + mix_ratio * model[input_word].
  - source: `/tmp/coto2-ba-backend/app/services/vector_engine.py (VectorEngine.calc)`
- **[high]** _nearest_word calls model.similar_by_vector(vector, topn=10) and returns the first candidate whose surface form is not in exclude={current_word, input_word}; if all 10 are excluded it returns candidates[0] anyway (exclusion is best-effort, not guaranteed).
  - source: `/tmp/coto2-ba-backend/app/services/vector_engine.py (_nearest_word)`
- **[high]** gensim similar_by_vector == most_similar(positive=[vector]) which unit-normalizes the query vector and compares against normed vocabulary vectors, i.e. plain cosine similarity over the whole vocabulary.
  - source: `gensim KeyedVectors source (most_similar / similar_by_vector)`
- **[high]** Rank is gensim KeyedVectors.rank(goal_word, word) = 1 + len(closer_than(goal_word, word)); closer_than counts vocab entries with cosine distance to goal strictly less than that of `word`, explicitly skipping goal_word itself. So rank is 1-based, rank(goal,goal)==1, and the goal's single nearest neighbour also gets rank 1.
  - source: `/tmp/coto2-ba-backend/app/services/vector_engine.py (_rank) + gensim KeyedVectors.rank/closer_than`
- **[high]** _rank returns 0 (a sentinel, not a real rank) when goal_word or word is missing from model.key_to_index. The frontend renders rank 0 as '—' and never treats it as a clear.
  - source: `/tmp/coto2-ba-backend/app/services/vector_engine.py, /tmp/coto2-ba-frontend/src/components/game/RankDisplay.tsx`
- **[high]** Hint generation: v_hint = (1 - hint_ratio) * vec[base_word] + hint_ratio * vec[goal_word] with hint_ratio default 0.2; similar_by_vector(v_hint, topn=100); first 6 results not in `forbidden` are returned (hint_count=6).
  - source: `/tmp/coto2-ba-backend/app/services/vector_engine.py (_hint_words_for)`
- **[high]** Hint forbidden sets differ by endpoint: /init uses {start_word, goal_word}; /calc uses {current_word, input_word, new_word, goal_word}. Hint base word is the newly produced word, not the previous one.
  - source: `/tmp/coto2-ba-backend/app/services/vector_engine.py (get_start_word, _build_hint_words)`
- **[high]** There are exactly 16 fixed start-word candidates and random.choice picks one per /init call: 投資, 学校, 宇宙, 魔法, 侍, コンピュータ, 恋愛, 筋肉, インターネット, 時間, 料理, 人工知能, 地球, 歴史, 音楽, スポーツ.
  - source: `/tmp/coto2-ba-backend/app/services/vector_engine.py (START_WORD_CANDIDATES)`
- **[high]** There is NO NG/banned word list, no profanity filter, and no vocabulary allow-list anywhere in the reference (grep for NGワード/禁止/ブラックリスト over all three repos returns nothing).
  - source: `grep -rn over /tmp/coto2-ba-backend, /tmp/coto2-ba-frontend, /tmp/coto2-ba-ref`
- **[high]** goal_word is sent by the client on every request (hardcoded GOAL_WORD = '100億' in src/lib/api.ts) and is never validated or pinned server-side; the server holds no session state at all.
  - source: `/tmp/coto2-ba-frontend/src/lib/api.ts, /tmp/coto2-ba-backend/app/schemas/vector.py`
- **[high]** Validation: current_word, input_word and goal_word must all be in model.key_to_index, else ValueError → HTTP 422 with detail '「<word>」は辞書にありません。'. mix_ratio is pydantic Field(ge=0.0, le=1.0).
  - source: `/tmp/coto2-ba-backend/app/services/vector_engine.py (_validate_words), /tmp/coto2-ba-backend/app/routers/vector.py, app/schemas/vector.py`
- **[high]** description is fetched live per request from the Japanese Wikipedia API: wikipedia.search(word) then wikipedia.summary(results[0], sentences=1). Fallbacks: '未知の概念です。' (no search hit), '複数の意味があります（例: A, B, C など）' (DisambiguationError, first 3 options), '辞書に載っていませんでした。' (any other exception).
  - source: `/tmp/coto2-ba-backend/app/services/vector_engine.py (get_wikipedia_summary)`
- **[high]** Clear condition is rank > 0 && rank <= 10 (CLEAR_RANK = 10 in useGameState.ts). Score is moveCount (number of mixes).
  - source: `/tmp/coto2-ba-frontend/src/hooks/useGameState.ts`
- **[high]** The 4 visual tiers are driven by getBgClass(rank) in src/app/game/page.tsx: rank===0 → bg-gray-50; rank<=10 → bg-gradient-to-b from-amber-100 via-yellow-50 to-amber-50 (黄金); rank<=999 → bg-slate-900 (宇宙); rank<=9999 → bg-gradient-to-b from-indigo-50 to-white (カラー); else bg-gray-50 (白黒). Container has transition-colors duration-700.
  - source: `/tmp/coto2-ba-frontend/src/app/game/page.tsx`
- **[high]** Rank numeral colors (RankDisplay.getRankColorClass): 0 → text-gray-400; <=10 → text-amber-500; <=999 → text-violet-400; <=9999 → text-indigo-500; else text-gray-400.
  - source: `/tmp/coto2-ba-frontend/src/components/game/RankDisplay.tsx`
- **[high]** isDark (light-on-dark text mode) is computed as currentRank > 0 && currentRank <= 999 && currentRank > 10 — i.e. exactly the 宇宙 tier (11–999) — and is threaded as a prop into WordDisplay, RankDisplay, HintWords and MixSlider.
  - source: `/tmp/coto2-ba-frontend/src/app/game/page.tsx`
- **[high]** The spec promises star particles for the 宇宙 tier, confetti on clear, and sound effects (use-sound sprite: tap/mix/ng/rankUp/clear); NONE of these are implemented in the shipped code — the 宇宙 tier is a flat slate-900 background and there is no audio or confetti anywhere.
  - source: `/tmp/coto2-ba-frontend/docs/frontend.md §5/§2.2 vs actual src/ tree (no sounds/, no confetti dep in package.json)`
- **[high]** Fonts: Noto Sans JP (weights 400/700) for Japanese body text via --font-noto-sans-jp, Roboto (400/700) for numerals via --font-roboto, both from next/font/google. Rank numerals use font-mono + tabular-nums.
  - source: `/tmp/coto2-ba-frontend/src/app/layout.tsx, src/app/globals.css`
- **[high]** MixSlider geometry: WHEEL_SIZE=224, CENTER=112, RING_RADIUS=82, RING_WIDTH=30, RING_CIRCUMFERENCE=2π*82, HANDLE_HIT_RADIUS=24, central button size-24 (96px). Value 0 is at 12 o'clock, increasing clockwise; gauge is a stroke-dasharray arc rotated -90deg; ring fill transitions stroke-dashoffset 300ms ease-out only when not dragging.
  - source: `/tmp/coto2-ba-frontend/src/components/game/MixSlider.tsx`
- **[high]** Animation timings: word change 0.3s easeOut (scale 0.8→1, y 10→0), description fade delay 0.2s, rank change 0.4s easeOut from scale 1.3, history item fade 0.2s with index*0.05 stagger, clear modal spring damping 20, MixingOverlay fade 0.3s with 1.5s-loop pulses and 2s particle loops at i*0.15 delay, input error shake x:[0,-8,8,-8,8,0] over 0.4s, whileTap scale 0.93 (wheel) / 0.95 (buttons) / 0.9 (hint badges).
  - source: `/tmp/coto2-ba-frontend/src/components/game/*.tsx`
- **[high]** MixingOverlay renders 12 particles at 30° increments travelling 120px, two 96px circles (indigo-500/30 and violet-500/30) converging from ±40%, a 64px central indigo-500/50 disc with a lucide Blend icon, and pulsing text 錬成中… on a bg-slate-900/90 backdrop-blur-sm full-screen layer at z-40.
  - source: `/tmp/coto2-ba-frontend/src/components/game/MixingOverlay.tsx`
- **[high]** HistoryList is actually a modal dialog (exported as HistoryDialog, not a list panel) opened from a header button that shows a count badge; the header swaps between a シャッフル button (moveCount===0) and the 履歴 button (moveCount>0) with an AnimatePresence crossfade.
  - source: `/tmp/coto2-ba-frontend/src/components/game/HistoryList.tsx, src/app/game/page.tsx`
- **[high]** PWA gate: the app is iOS-PWA only — usePWA checks navigator.standalone === true and an /iphone|ipad|ipod/i UA test, bypassing entirely when NODE_ENV === 'development'; everything else gets FallbackPage. manifest theme_color #6366f1, background_color #f8fafc.
  - source: `/tmp/coto2-ba-frontend/src/hooks/usePWA.ts, src/app/manifest.ts`
- **[high]** MixButton.tsx and the shadcn slider.tsx exist but are dead code — the game page only uses the circular MixSlider whose centre button performs the mix.
  - source: `/tmp/coto2-ba-frontend/src/app/game/page.tsx imports vs src/components/game/`
- **[medium]** Tailwind v4 default palette is used exclusively (no custom hex). Key equivalents: indigo-500 #6366f1, indigo-600 #4f46e5, indigo-400 #818cf8, indigo-50 #eef2ff, violet-400 #a78bfa, violet-500 #8b5cf6, amber-500 #f59e0b, amber-100 #fef3c7, amber-50 #fffbeb, yellow-50 #fefce8, slate-900 #0f172a, gray-50 #f9fafb, gray-400 #9ca3af, gray-500 #6b7280, gray-900 #111827, emerald-500 #10b981, red-500 #ef4444.
  - source: `Tailwind default palette (v4 ships oklch equivalents of these v3 hexes); classes read from /tmp/coto2-ba-frontend/src`

## コード片

### backend/app/services/vector_engine.py — START_WORD_CANDIDATES (the 16 fixed start words, verbatim)

```python
# スタート候補ワード
START_WORD_CANDIDATES: list[str] = [
    "投資",
    "学校",
    "宇宙",
    "魔法",
    "侍",
    "コンピュータ",
    "恋愛",
    "筋肉",
    "インターネット",
    "時間",
    "料理",
    "人工知能",
    "地球",
    "歴史",
    "音楽",
    "スポーツ",
]

MODEL_PATH = "app/models/jawiki.word_vectors.200d.txt"
# loaded as: KeyedVectors.load_word2vec_format(MODEL_PATH, binary=False)
```

### backend — _rank and the gensim semantics it inherits (1-based, goal excluded, 0 = OOV sentinel)

```python
def _rank(self, goal_word: str, word: str) -> int:
    """goal_word から見た word の順位を返す。算出不能なら 0。"""
    if goal_word in self.model.key_to_index and word in self.model.key_to_index:
        rank: int = self.model.rank(goal_word, word)
        return rank
    return 0

# gensim KeyedVectors (what rank() actually does):
#   def closer_than(self, key1, key2):
#       all_distances = self.distances(key1)          # cosine distance = 1 - cos_sim
#       e1_index = self.get_index(key1); e2_index = self.get_index(key2)
#       closer = np.where(all_distances < all_distances[e2_index])[0]
#       return [self.index_to_key[i] for i in closer if i != e1_index]   # goal itself skipped
#   def rank(self, key1, key2):
#       return len(self.closer_than(key1, key2)) + 1
#
# => rank is 1-based; rank(goal, goal) == 1; the goal's nearest neighbour also == 1.
# SQL equivalent (pgvector, cosine):
#   SELECT 1 + count(*) FROM words w
#   WHERE w.word <> :goal
#     AND (w.vec <=> :goal_vec) < (SELECT vec <=> :goal_vec FROM words WHERE word = :word);
```

### backend — calc(): mixing + nearest + rank + hints (verbatim core)

```python
def calc(self, req: CalcRequest) -> CalcResponse:
    self._validate_words(req)

    # ベクトル合成
    v_new: np.ndarray = (1.0 - req.mix_ratio) * self.model[
        req.current_word
    ] + req.mix_ratio * self.model[req.input_word]

    # 近傍単語の抽出（current / input 自身は除外）
    new_word = self._nearest_word(v_new, exclude={req.current_word, req.input_word})

    # ランク判定
    rank = self._rank(req.goal_word, new_word)

    # ヒントの取得
    hint_words = self._build_hint_words(req, new_word)

    description = self.get_wikipedia_summary(new_word)

    return CalcResponse(
        new_word=new_word,
        rank=rank,
        hint_words=hint_words,
        description=description,
    )

def _validate_words(self, req: CalcRequest) -> None:
    if req.current_word not in self.model.key_to_index:
        raise ValueError(f"「{req.current_word}」は辞書にありません。")
    if req.input_word not in self.model.key_to_index:
        raise ValueError(f"「{req.input_word}」は辞書にありません。")
    if req.goal_word not in self.model.key_to_index:
        raise ValueError(f"ゴール「{req.goal_word}」が辞書にありません。")
```

### backend — _nearest_word (verbatim)

```python
def _nearest_word(
    self,
    vector: np.ndarray,
    *,
    exclude: set[str],
    topn: int = 10,
) -> str:
    """vector に最も近い単語を返す。exclude に含まれる単語はスキップする。"""
    candidates: list[tuple[str, float]] = self.model.similar_by_vector(
        vector, topn=topn
    )
    for word, _sim in candidates:
        if word not in exclude:
            return str(word)

    return str(candidates[0][0]) if candidates else ""
```

### backend — _hint_words_for and _build_hint_words (verbatim; hint_ratio=0.2, topn=100, 6 results)

```python
def _hint_words_for(
    self,
    goal_word: str,
    base_word: str,
    forbidden: set[str],
    *,
    hint_count: int = 6,
    hint_ratio: float = 0.2,
) -> list[str]:
    """
    base_word をベースに goal_word 方向へ少し寄せたベクトルから
    ヒントワードを最大 hint_count 個返す。
    hint_ratio でヒントの露骨さ（難易度）を調整できる。
    """
    if (
        base_word not in self.model.key_to_index
        or goal_word not in self.model.key_to_index
    ):
        return []

    v_hint: np.ndarray = (1.0 - hint_ratio) * self.model[
        base_word
    ] + hint_ratio * self.model[goal_word]
    raw_hints: list[tuple[str, float]] = self.model.similar_by_vector(
        v_hint, topn=100
    )

    hint_words: list[str] = []
    for w, _sim in raw_hints:
        if w not in forbidden:
            hint_words.append(str(w))
            if len(hint_words) >= hint_count:
                break
    return hint_words

def _build_hint_words(
    self,
    req: CalcRequest,
    new_word: str,
    *,
    hint_count: int = 6,
    hint_ratio: float = 0.2,
) -> list[str]:
    return self._hint_words_for(
        goal_word=req.goal_word,
        base_word=new_word,
        forbidden={req.current_word, req.input_word, new_word, req.goal_word},
        hint_count=hint_count,
        hint_ratio=hint_ratio,
    )
```

### backend — get_start_word (/init) and get_wikipedia_summary (verbatim)

```python
def get_start_word(self, req: InitRequest) -> InitResponse:
    word = random.choice(START_WORD_CANDIDATES)
    description = self.get_wikipedia_summary(word)
    rank = self._rank(req.goal_word, word)
    hint_words = self._hint_words_for(
        goal_word=req.goal_word,
        base_word=word,
        forbidden={word, req.goal_word},
    )
    return InitResponse(
        start_word=word, rank=rank, hint_words=hint_words, description=description
    )

wikipedia.set_lang("ja")

def get_wikipedia_summary(self, word: str) -> str:
    try:
        search_results: list[str] = wikipedia.search(word)
        if not search_results:
            return "未知の概念です。"
        summary: str = wikipedia.summary(search_results[0], sentences=1)
        return summary
    except wikipedia.exceptions.DisambiguationError as e:
        options: list[str] = e.options[:3]
        return f"複数の意味があります（例: {', '.join(options)} など）"
    except Exception:
        return "辞書に載っていませんでした。"
```

### backend — Pydantic schemas (wire contract for /vector/init and /vector/calc)

```python
class InitRequest(BaseModel):
    goal_word: str

class InitResponse(BaseModel):
    start_word: str
    rank: int          # 0以上、小さいほど近い（0 = 算出不能）
    hint_words: list[str]   # 6件
    description: str

class CalcRequest(BaseModel):
    goal_word: str
    current_word: str
    input_word: str
    mix_ratio: float = Field(ge=0.0, le=1.0)

class CalcResponse(BaseModel):
    new_word: str
    rank: int
    hint_words: list[str]
    description: str

# router: ValueError -> HTTPException(status_code=422, detail=str(e))
```

### frontend — useGameState.ts state shape, CLEAR_RANK and executeMix transition (verbatim core)

```typescript
const INITIAL_STATE: GameState = {
  currentWord: "", currentRank: 0, description: "", hintWords: [],
  moveCount: 0, history: [], inputWord: "", mixRatio: 0.5,
  isLoading: false, isCleared: false, goalWord: GOAL_WORD, error: null,
};

/** クリア条件: ランク10位以内 */
const CLEAR_RANK = 10;

// startNewGame(): isLoading=true -> initGame() -> reset to INITIAL_STATE with
//   currentWord/currentRank/description/hintWords from the response
//   (note: isLoading stays false because INITIAL_STATE resets it); on throw:
//   error = "ゲームの初期化に失敗しました。再読み込みしてください。"
// useEffect(() => { startNewGame(); }, [startNewGame])   // runs once on mount
// shuffleStartWord(): if (state.moveCount > 0) return; else startNewGame()

const executeMix = useCallback(async () => {
  const { inputWord, currentWord, mixRatio, isLoading } = state;
  if (!inputWord.trim() || isLoading) return;
  setState((prev) => ({ ...prev, isLoading: true, error: null }));
  try {
    const res = await calcVector(currentWord, inputWord.trim(), mixRatio);
    const historyItem: HistoryItem = {
      inputWord: inputWord.trim(), mixRatio,
      resultWord: res.new_word, rank: res.rank,
    };
    const isCleared = res.rank > 0 && res.rank <= CLEAR_RANK;
    setState((prev) => ({
      ...prev,
      currentWord: res.new_word,
      currentRank: res.rank,
      description: res.description,
      hintWords: res.hint_words,
      moveCount: prev.moveCount + 1,
      history: [historyItem, ...prev.history].slice(0, 5),
      inputWord: "",
      isLoading: false,
      isCleared,
      error: null,
    }));
  } catch (e) {
    if (e instanceof DictionaryError) {
      setState((prev) => ({ ...prev, isLoading: false, error: e.message }));
    } else {
      setState((prev) => ({ ...prev, isLoading: false,
        error: "通信エラーが発生しました。もう一度お試しください。" }));
    }
  }
}, [state]);
```

### frontend — the 4 visual tiers: getBgClass (game/page.tsx) + getRankColorClass (RankDisplay.tsx), verbatim

```typescript
/**
 * ランクに応じた背景クラス
 * - 10,000位以下: gray-50 / white（シンプル・白黒）
 * - 1,000〜9,999位: indigo-50 淡いグラデーション
 * - 11〜999位: slate-900（宇宙空間）
 * - 1〜10位: amber-400 → yellow-300 グラデーション（黄金）
 * - 0（未計測）: gray-50
 */
function getBgClass(rank: number): string {
  if (rank === 0) return "bg-gray-50";
  if (rank <= 10)
    return "bg-gradient-to-b from-amber-100 via-yellow-50 to-amber-50";
  if (rank <= 999) return "bg-slate-900";
  if (rank <= 9999) return "bg-gradient-to-b from-indigo-50 to-white";
  return "bg-gray-50";
}

function getRankColorClass(rank: number): string {
  if (rank === 0) return "text-gray-400";
  if (rank <= 10) return "text-amber-500";
  if (rank <= 999) return "text-violet-400";
  if (rank <= 9999) return "text-indigo-500";
  return "text-gray-400";
}

// container: "flex h-svh flex-col overflow-hidden transition-colors duration-700"
// dark-text mode for the 宇宙 tier only:
const isDark =
  state.currentRank > 0 && state.currentRank <= 999 && state.currentRank > 10;
```

### frontend — MixSlider circular-wheel geometry and pointer math (verbatim; the key interaction to port to RN)

```typescript
const WHEEL_SIZE = 224;
const CENTER = WHEEL_SIZE / 2;              // 112
const RING_RADIUS = 82;
const RING_WIDTH = 30;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const HANDLE_HIT_RADIUS = 24;

function angleToValue(angle: number): number {
  const normalized = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return normalized / (2 * Math.PI);
}

function valueToPos(v: number) {
  const angle = v * 2 * Math.PI - Math.PI / 2;   // 0 = 12 o'clock, clockwise
  return {
    x: CENTER + RING_RADIUS * Math.cos(angle),
    y: CENTER + RING_RADIUS * Math.sin(angle),
  };
}

const pointerToValue = useCallback((clientX: number, clientY: number) => {
  const rect = svgRef.current.getBoundingClientRect();
  const svgX = ((clientX - rect.left) / rect.width) * WHEEL_SIZE;
  const svgY = ((clientY - rect.top) / rect.height) * WHEEL_SIZE;
  const angle = Math.atan2(svgX - CENTER, -(svgY - CENTER));
  let newValue = angleToValue(angle);
  // 境界（12時位置）を跨ぐジャンプを防止
  const delta = newValue - prevValue.current;
  if (Math.abs(delta) > 0.5) {
    newValue = delta > 0 ? 0 : 1;
  }
  newValue = Math.max(0, Math.min(1, newValue));
  prevValue.current = newValue;
  onChange(newValue);
}, [onChange]);

// SVG layers, in order:
// 1. track   circle r=82 stroke=isDark?rgba(255,255,255,0.06):rgba(0,0,0,0.06) width=30 linecap=round
// 2. gauge   circle same geometry, stroke=isDark?rgba(129,140,248,0.35):rgba(99,102,241,0.22),
//            strokeDasharray=RING_CIRCUMFERENCE, strokeDashoffset=RING_CIRCUMFERENCE*(1-value),
//            transform=rotate(-90 112 112), transition stroke-dashoffset 300ms ease-out when !isDragging
// 3. handle  transparent circle r=24 at valueToPos(value), pointer capture on pointerdown,
//            rAF-throttled pointermove
// centre: size-24 (96px) round button, bg-indigo-500 text-white, whileTap scale 0.93,
//         contents = <ArrowBigRightDash size=22 fill=currentColor> over <SlidingNumber pct/>%
// wrapper: size-56 rounded-full, bg = isDark ? "bg-white/[0.03]" : "bg-muted/30", touch-none select-none
```

### frontend — MixingOverlay (錬成中) animation parameters, verbatim core

```typescript
// wrapper: fixed inset-0 z-40 flex-col center, bg-slate-900/90 backdrop-blur-sm,
//          fade in/out 0.3s

// 12 particles, size-2 rounded-full bg-indigo-400/60, absolutely positioned at centre:
{Array.from({ length: 12 }).map((_, i) => (
  <motion.div
    className="absolute size-2 rounded-full bg-indigo-400/60"
    initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
    animate={{
      x: [0, Math.cos((i * 30 * Math.PI) / 180) * 120],
      y: [0, Math.sin((i * 30 * Math.PI) / 180) * 120],
      scale: [0, 1.5, 0],
      opacity: [0, 0.8, 0],
    }}
    transition={{ duration: 2, repeat: Infinity, delay: i * 0.15, ease: "easeOut" }}
  />
))}

// two converging discs (size-24 = 96px), 1.5s infinite easeInOut:
//   indigo-500/30 : x: ["-40%", "0%"],  scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5]
//   violet-500/30 : x: ["40%",  "0%"],  same scale/opacity
// central fusion disc size-16 (64px) bg-indigo-500/50 with <Blend className="size-8 text-white"/>:
//   scale: [0.8, 1.3, 0.8], opacity: [0.6, 1, 0.6], 1.5s infinite easeInOut
// text: "錬成中…" mt-12 text-lg font-bold text-gray-200, opacity [0.4, 1, 0.4] 1.5s infinite
```

### frontend — WordDisplay, RankDisplay, HintWords, HistoryDialog: props + layout (condensed from source)

```typescript
// ── WordDisplay ──────────────────────────────────────────────
type WordDisplayProps = { word: string; description?: string; isDark?: boolean };
// <div class="flex min-h-32 flex-col items-center justify-center gap-2">
//   AnimatePresence mode="wait", child keyed by `word`:
//     initial {opacity:0, scale:0.8, y:10} / animate {1,1,0} / exit {0, 0.9, -10}, 0.3s easeOut
//     <p class="text-4xl font-bold" + (isDark ? text-gray-100 : text-gray-900)>{word || "…"}</p>
//     description: <motion.p delay 0.2, "mt-2 max-w-xs text-sm leading-relaxed",
//                   isDark ? text-gray-400 : text-gray-500>

// ── RankDisplay ──────────────────────────────────────────────
type RankDisplayProps = { rank: number; isDark?: boolean };
// column, gap-1:
//   label "ランク"  text-xs font-bold  (isDark ? gray-400 : gray-500)
//   AnimatePresence mode="wait" keyed by rank:
//     initial {scale:1.3, opacity:0} -> {scale:1, opacity:1}, 0.4s easeOut, flex items-baseline gap-1
//     numeral: "font-mono text-4xl font-bold tabular-nums" + getRankColorClass(rank)
//              rank===0 ? "—" : <SlidingNumber number={rank} thousandSeparator="," />
//     suffix "位" text-lg font-bold, same color, only when rank > 0
//   if improved: <motion.span class="text-xs font-bold text-emerald-500">↑ ランクアップ！</motion.span>
//   improvement detected via a useRef mutated DURING RENDER (see risks):
//     const isImproved = prevRank.current > rank && rank > 0; prevRank.current = rank;

// ── HintWords ────────────────────────────────────────────────
type HintWordsProps = { words: string[]; onSelect: (w: string) => void; isDark?: boolean };
// returns null when words.length === 0
// header: <p class="flex items-center justify-center gap-1 text-xs font-bold"> <Lightbulb size-3.5/> ヒント
// body:   <div class="flex flex-wrap justify-center gap-2"> of motion.button
//         whileTap {scale:0.9} whileHover {scale:1.05}, onClick={() => onSelect(word)}
//         Badge variant="outline": rounded-full border-indigo-200 bg-indigo-50 px-2.5 py-1
//                                  text-xs font-medium text-indigo-600 hover:bg-indigo-100
// NOTE: hint badge colors are NOT isDark-aware (always light indigo chips, even on slate-900)

// ── HistoryDialog (file is HistoryList.tsx) ──────────────────
type HistoryDialogProps = { items: HistoryItem[]; children: ReactNode };  // children = trigger
// Dialog + DialogContent "max-h-[80svh] overflow-y-auto rounded-3xl bg-gray-50 p-0"
// title: <History size-5/> 操作履歴
// empty: "まだ操作履歴がありません" py-8 text-center text-sm text-gray-400
// each row (rounded-xl bg-white px-3 py-2.5 text-sm shadow-sm, fade-in y10, delay index*0.05):
//   #<n>  ＋(indigo-500)  「{inputWord}」  ×{Math.round(mixRatio*100)}%  →  {resultWord}
//   ... right-aligned: {rank > 0 ? `${rank.toLocaleString()}位` : "—"}
//   n = items.length - index   <-- wrong once history is capped at 5 (see risks)
// footer: DialogClose button h-12 w-full rounded-2xl bg-indigo-500 "閉じる"
```

### frontend — src/lib/api.ts (client contract, GOAL_WORD, 422 handling), verbatim

```typescript
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://coto2-ba-api.sz-lab.jp";

/** 目標ワード（固定） */
export const GOAL_WORD = "100億";

export class DictionaryError extends Error {
  constructor(message: string) { super(message); this.name = "DictionaryError"; }
}

export async function initGame(): Promise<InitResponse> {
  const res = await fetch(`${API_BASE}/vector/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal_word: GOAL_WORD }),
  });
  if (!res.ok) throw new Error("ゲームの初期化に失敗しました");
  return res.json();
}

export async function calcVector(
  currentWord: string, inputWord: string, mixRatio: number,
): Promise<CalcResponse> {
  const res = await fetch(`${API_BASE}/vector/calc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal_word: GOAL_WORD, current_word: currentWord,
      input_word: inputWord, mix_ratio: mixRatio,
    }),
  });
  if (res.status === 422) {
    const error = await res.json();
    throw new DictionaryError(error.detail ?? "この単語は辞書に登録されていません");
  }
  if (!res.ok) throw new Error("演算に失敗しました");
  return res.json();
}
```

### frontend — game screen layout skeleton (order of elements, for the RN rebuild)

```typescript
// <div class={cn("flex h-svh flex-col overflow-hidden transition-colors duration-700", bgClass)}>
//   <header class="shrink-0 px-4 py-3">
//     row 1: [← 戻る]                          [手数: {moveCount}]  [？ ルール (RulesDialog)]
//     row 2 (mt-2, justify-end, AnimatePresence mode="wait" 0.2s crossfade):
//            moveCount===0 ? <RefreshCw/> シャッフル  :  <History/> 履歴 + count badge
//   </header>
//   <div class="flex min-h-0 flex-1 flex-col items-center px-4 pb-4">
//     <RankDisplay rank isDark />            (mb-2 shrink-0)
//     <WordDisplay word description isDark /> (shrink-0)
//     <div class="shrink-0 h-4" />
//     <div class="w-full max-w-sm shrink-0 space-y-4">
//       <WordInput value onChange onSubmit disabled={isLoading} error />
//       <HintWords words={hintWords} onSelect={setInputWord} isDark />
//     </div>
//     <div class="flex min-h-0 flex-1 items-center justify-center">
//       <MixSlider value={mixRatio} onChange={setMixRatio} onMix={handleSubmit}
//                  disabled={isLoading} isDark />
//     </div>
//   </div>
//   <MixingOverlay isVisible={isLoading} />      // z-40
//   {isCleared && <ClearModal/>}                 // z-50, bg-black/50 p-6
// </div>
//
// ClearModal: w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl,
//   spring damping 20, scale 0.8 -> 1
//   <PartyPopper size-12/>  "クリア！" text-2xl font-bold
//   「{currentWord}」に到達！ / ランク {currentRank} 位 — 10位以内達成！
//   two stats side by side: 手数 (indigo-500) and ランク (amber-500), both SlidingNumber, text-3xl font-mono
//   buttons: "もう一度挑戦" (h-12 rounded-2xl bg-indigo-500) / "タイトルへ戻る" (ghost h-10)
//
// WordInput: h-12 rounded-2xl border-2 px-4 text-center text-base font-medium,
//   placeholder "単語を入力…", Enter submits guarded by !e.nativeEvent.isComposing (IME-safe!),
//   error -> border-red-400 bg-red-50 text-red-700 + shake x:[0,-8,8,-8,8,0] 0.4s + red-500 message
```


## リスク

- INSTANT-WIN EXPLOIT: nothing stops the player typing the goal word itself. input_word="100億" with mix_ratio=1.0 makes v_new exactly the goal vector; the goal is only excluded from _nearest_word if it happens to equal current/input, and its nearest neighbour scores rank 1 anyway → immediate clear. Our server must reject the goal word (and its near-synonyms / a radius around it) as input, and reject mix_ratio extremes that trivially teleport. This is the single most important thing NOT to copy.
- goal_word is a client-supplied field on every request with zero server validation and no session; a player can send any goal (e.g. goal_word == current_word → rank 1). Our rules must live server-side with a session row holding the goal, per CLAUDE.md's 'クライアントの値を信用しない'.
- Rank semantics are subtle and easy to get wrong: gensim's rank() is 1-based, counts strictly-closer vocabulary entries, and EXCLUDES the goal word itself — so the goal's nearest neighbour is rank 1, not rank 2. A naive `ORDER BY vec <=> goal LIMIT n` / row_number() reimplementation in pgvector will be off by one and shift the whole clear threshold. Also ties: numpy `<` gives strict inequality, so equidistant words share a rank.
- Mixing happens on RAW un-normalized word2vec vectors, while the nearest-neighbour search is cosine over normalized vectors. If we store only L2-normalized embeddings in pgvector (the usual pgvector practice), the interpolation result differs from the reference for any pair with unequal norms — mix_ratio 0.5 no longer means the same point. Decide deliberately: store raw vectors (and a separate normalized column / use vector_cosine_ops) if we want identical game feel.
- rank == 0 is an overloaded sentinel meaning 'not computable / OOV', not 'best rank'. Every consumer must special-case it (the reference does: renders '—', never clears). Prefer null in our contracts.
- _nearest_word's exclusion is best-effort only: if all 10 candidates are excluded it returns candidates[0] — which can be the current word or input word, producing a no-op turn. topn must be larger (or the query must exclude at the SQL level).
- No NG-word list exists at all. WikiEntVec's vocabulary is raw Wikipedia tokens and will happily surface slurs, fragments, numerals, entity noise and English junk as new_word or as one of the 6 hints. We have to build the NG list ourselves — the reference gives us nothing to copy.
- Wikipedia is called synchronously on every /init and /calc for `description`, adding 0.5–2s of third-party latency to the game's critical path and introducing an external failure mode. Precompute descriptions into the DB instead.
- VectorEngine() is instantiated at module import in app/routers/vector.py, loading a 588MB plaintext model at process start. Fine on a long-lived Render box, fatal on serverless — do not carry this pattern into Hono on Vercel.
- RankDisplay mutates a ref during render (`prevRank.current = rank`) to compute 'ランクアップ！'. Under React 18/19 StrictMode and concurrent re-renders this double-fires and the badge flickers or is skipped. Track the previous rank in state/effect or derive it from history instead.
- HistoryDialog numbers rows as `items.length - index` while useGameState caps history at 5 entries, so after the 6th move the newest row is labelled #5 instead of #6. Number from moveCount, not from array length.
- executeMix has `[state]` in its useCallback deps, so the callback is recreated on every keystroke; harmless here but it defeats memoization if we port the pattern into a bigger RN tree.
- Documented-but-unimplemented features: star particles for the 宇宙 tier, clear confetti, and the whole use-sound SE sprite. The docs read as if they exist. Don't treat frontend.md as a description of shipped behaviour.
- The RulesDialog copy says the mix ratio is adjusted with ＋/ー buttons, but the shipped UI is a circular drag wheel — stale help text. Also MixButton.tsx and components/ui/slider.tsx are dead code.
- HintWords badges are hardcoded light-indigo (bg-indigo-50 / text-indigo-600) and are not isDark-aware, so on the slate-900 宇宙 tier they read as bright light chips on black — inconsistent with every other component, which takes isDark.

## 結論

Reproduce the algorithms exactly, harden everything around them.

Port verbatim into apps/api/src/services/game.ts: (1) mix = `(1-r)*v_current + r*v_input` on RAW vectors; (2) nearest = cosine top-N excluding {current, input} — but push the exclusion into SQL and use N≈32 instead of the reference's fragile topn=10 + fallback-to-candidates[0]; (3) hints = `0.8*v_base + 0.2*v_goal`, base = the NEW word, take the first 6 after filtering {current, input, new, goal}; (4) rank = `1 + count(*) WHERE word <> goal AND (vec <=> goal_vec) < (word's own distance)`, which is the exact gensim contract — verify it by asserting rank(goal's nearest neighbour) == 1 in a test. Keep hint_ratio 0.2 and hint_count 6 in packages/contracts/src/constants.ts, along with CLEAR_RANK = 10 and the tier thresholds 10 / 999 / 9999.

Store raw (un-normalized) 200-d vectors in pgvector plus a normalized column (or use `vector_cosine_ops`, which normalizes at comparison time) — mixing must happen in raw space or the game feel drifts. Represent "unrankable" as null, not 0, at the contract boundary.

Fix the three things the reference gets wrong: pin goal_word server-side in the session row (never accept it from the client), reject the goal word and anything within a small rank radius of it as input_word (otherwise mix_ratio=1.0 on "100億" is an instant win), and build the NG list the reference never had — at minimum strip slurs, sub-word fragments, pure numerals/latin junk and the goal's own inflections from both new_word candidates and hints. Precompute descriptions into the words table; do not call Wikipedia in the request path.

Take the 16 start words as-is (投資/学校/宇宙/魔法/侍/コンピュータ/恋愛/筋肉/インターネット/時間/料理/人工知能/地球/歴史/音楽/スポーツ) — they're well chosen: concrete, common, spread across the semantic space, and each an obviously-bad starting point for "100億".

For the RN app, the two pieces of game feel worth rebuilding faithfully are the circular MixSlider (react-native-svg + PanResponder/Gesture Handler; carry over the 12-o'clock wrap guard `|delta| > 0.5 → snap to 0 or 1`, which is what makes the wheel usable) and the MixingOverlay 錬成中 sequence. Both are Expo Go compatible (react-native-svg and react-native-reanimated ship with Expo). Reproduce the four tiers as an interpolated theme object rather than class-name swaps, and make hint chips isDark-aware — the reference forgot. Use IME-safe submit (`isComposing` has no RN equivalent; rely on the submit button, not onSubmitEditing). Skip the PWA gate, MixButton, slider.tsx and the localStorage leaderboard entirely.

Reference clones are at /tmp/coto2-ba-ref, /tmp/coto2-ba-backend, /tmp/coto2-ba-frontend if anything needs re-checking; the whole backend worth copying is one 200-line file, /tmp/coto2-ba-backend/app/services/vector_engine.py.

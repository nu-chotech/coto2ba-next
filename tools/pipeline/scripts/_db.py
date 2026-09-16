"""DB 接続と DDL。

テーブルの正は **drizzle（apps/api）** が持つ。パイプラインは単独でも走れる必要が
あるので「無ければ作る」だけにし、列定義は drizzle 側と厳密に一致させてある
（食い違うと drizzle-kit のマイグレーションが衝突する）。既にテーブルがあれば
`IF NOT EXISTS` は何もしない。
"""

from __future__ import annotations

import psycopg

from _constants import VECTOR_DIM

CREATE_EXTENSION = "CREATE EXTENSION IF NOT EXISTS vector"

DDL_VOCAB = f"""
CREATE TABLE IF NOT EXISTS vocab (
  word           text PRIMARY KEY,
  freq_rank      integer NOT NULL,
  is_input       boolean NOT NULL DEFAULT true,
  is_output      boolean NOT NULL DEFAULT false,
  is_common_noun boolean NOT NULL DEFAULT false,
  pos            text,
  w2v            halfvec({VECTOR_DIM}) NOT NULL,
  pos3           real[]
)
"""

DDL_GOAL_POOL = """
CREATE TABLE IF NOT EXISTS goal_pool (
  word          text PRIMARY KEY REFERENCES vocab(word),
  difficulty    text NOT NULL CHECK (difficulty IN ('easy','normal','hard')),
  bot_moves     real NOT NULL,
  description   text,
  review_needed boolean NOT NULL DEFAULT false,
  enabled       boolean NOT NULL DEFAULT true
)
"""

DDL_DAILY_CHALLENGES = """
CREATE TABLE IF NOT EXISTS daily_challenges (
  date       date PRIMARY KEY,
  goal       text NOT NULL REFERENCES goal_pool(word),
  start      text NOT NULL REFERENCES vocab(word),
  difficulty text NOT NULL
)
"""

DDL_NAME_PARTS = """
CREATE TABLE IF NOT EXISTS name_parts (
  word text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('adjective','noun'))
)
"""


def connect(url: str) -> psycopg.Connection:
    """autocommit 接続。DDL と COPY をそのまま流すため。"""
    return psycopg.connect(url, autocommit=True)


def ensure_vocab(conn: psycopg.Connection) -> None:
    conn.execute(CREATE_EXTENSION)
    conn.execute(DDL_VOCAB)


def ensure_goal_pool(conn: psycopg.Connection) -> None:
    ensure_vocab(conn)
    conn.execute(DDL_GOAL_POOL)


def ensure_daily_challenges(conn: psycopg.Connection) -> None:
    ensure_goal_pool(conn)
    conn.execute(DDL_DAILY_CHALLENGES)


def ensure_name_parts(conn: psycopg.Connection) -> None:
    conn.execute(DDL_NAME_PARTS)

"""テストから `scripts` パッケージを import できるようにする。

`scripts/` に `__init__.py` は無い（既存スクリプトは各自 `sys.path.insert` で
兄弟モジュールを import する作法）が、テストは `from scripts import sounds_lib`
という素直な形にしたいので、ここで tools/pipeline を sys.path に足す。
`scripts/` は Python 3 の暗黙 namespace package として扱われる。
"""

from __future__ import annotations

import sys
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
if str(PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(PIPELINE_ROOT))

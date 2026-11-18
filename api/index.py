"""Vercel entry point: the FastAPI backend as one serverless function.

Hosted demo only. It serves synthetic training data, keeps SQLite in the
function's temporary directory and issues demo viewpoint tokens to visitors.
"""

import sys
from os import environ
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "src"))
environ.setdefault("SYMBIOSIS_X_HOSTED_DEMO", "1")
environ.setdefault("SYMBIOSIS_X_DB_PATH", "/tmp/symbiosis-x.sqlite3")

from symbiosis_x.main import create_app  # noqa: E402

app = create_app()

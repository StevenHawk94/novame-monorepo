"""Compatibility entry for the permanent-ID catalog pipeline.

Edit catalog/burrow-shop-products.json to associate new art with an explicit ID.
Never rediscover/reassign purchased products from filenames or array positions.
"""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
subprocess.run(["node", str(root / "tools/sync-shop-catalog.cjs"), *sys.argv[1:]],
               cwd=root, check=True)

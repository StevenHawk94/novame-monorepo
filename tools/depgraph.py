#!/usr/bin/env python3
"""Resolved import graph for apps/mobile.

Not a grep. Every edge here is a specifier that actually resolves to a file on
disk, so `@/lib/api`, `./storage`, and `../../lib/api` all collapse to the same
node. Written to /tmp/novame-graph.json for tools/plan-delete.py to consume.

Regenerate after every deletion. A stale graph is worse than no graph: it will
confidently tell you a file has no importers.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

MOBILE = Path('apps/mobile')

# `from '...'` covers both `import ... from` and `export ... from`; the latter
# is how packages/core's barrel works, and re-exports are real edges.
SPEC = re.compile(r"""from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)""")


def source_files():
    roots = [MOBILE / 'src', MOBILE / 'app']
    return [p for r in roots for p in r.rglob('*')
            if p.suffix in ('.ts', '.tsx') and p.is_file()]


def resolve(spec: str, origin: Path):
    """Return the repo-relative path a specifier points at, or None if external."""
    if spec.startswith('@/'):
        base = MOBILE / 'src' / spec[2:]
    elif spec.startswith('.'):
        base = (origin.parent / spec).resolve()
        try:
            base = base.relative_to(Path.cwd())
        except ValueError:
            return None
    else:
        return None  # node_modules or a workspace package
    for cand in (base.with_suffix('.ts'), base.with_suffix('.tsx'),
                 base / 'index.ts', base / 'index.tsx'):
        if cand.exists():
            return str(cand)
    return None


def build():
    files = source_files()
    fwd, rev = defaultdict(set), defaultdict(set)
    for p in files:
        for m in SPEC.finditer(p.read_text(encoding='utf-8')):
            target = resolve(m.group(1) or m.group(2), p)
            if target:
                fwd[str(p)].add(target)
                rev[target].add(str(p))
    return {
        'files': sorted(str(p) for p in files),
        'imports': {k: sorted(v) for k, v in fwd.items()},
        'importedBy': {k: sorted(v) for k, v in rev.items()},
    }


if __name__ == '__main__':
    g = build()
    out = Path('/tmp/novame-graph.json')
    out.write_text(json.dumps(g, indent=1))
    edges = sum(len(v) for v in g['imports'].values())
    print(f'{len(g["files"])} files, {edges} internal edges -> {out}')

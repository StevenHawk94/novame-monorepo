#!/usr/bin/env python3
"""Plan a deletion in reverse topological order.

Given a set of seed files, answers two questions the compiler would otherwise
answer one file at a time:

  1. Which surviving files still import into the deletion set?
     Those are the edits you must make BEFORE `git rm`, or type-check drowns
     in hundreds of cascading errors and stops being a checkpoint.

  2. Which files become unreachable once the seeds are gone?
     Repeatedly: a file with no importers left is dead too. This is the whole
     point of peeling leaves rather than hacking at the trunk.

Route files under apps/mobile/app/ are never auto-orphaned. expo-router loads
them by path, so they have no importers by construction -- treating "nobody
imports it" as "it is dead" would condemn every screen in the app.

Usage:
    python3 tools/depgraph.py
    python3 tools/plan-delete.py seeds.txt
"""
import json
import sys
from pathlib import Path

ROUTES = 'apps/mobile/app/'


def main(seed_file: str) -> int:
    graph = json.loads(Path('/tmp/novame-graph.json').read_text())
    files = set(graph['files'])
    imports = {k: set(v) for k, v in graph['imports'].items()}
    imported_by = {k: set(v) for k, v in graph['importedBy'].items()}

    seeds = [l.strip() for l in Path(seed_file).read_text().splitlines()
             if l.strip() and not l.startswith('#')]

    unknown = [s for s in seeds if s not in files]
    if unknown:
        print('!! not in graph (typo? already deleted?):')
        for u in unknown:
            print(f'   {u}')
        return 1

    doomed = set(seeds)
    while True:
        newly = {
            f for f in files - doomed
            if not f.startswith(ROUTES) and f in imported_by
            and not (imported_by[f] - doomed)
        }
        if not newly:
            break
        doomed |= newly

    cascade = doomed - set(seeds)

    dangling = {}
    for f in files - doomed:
        hits = imports.get(f, set()) & doomed
        if hits:
            dangling[f] = sorted(hits)

    lines = lambda p: len(Path(p).read_text(encoding='utf-8').splitlines())
    total = sum(lines(f) for f in doomed)

    print(f'seeds        {len(seeds):3}')
    print(f'cascade      {len(cascade):3}  (become unreachable)')
    print(f'total        {len(doomed):3} files, {total} lines\n')

    if cascade:
        print('--- cascade (delete these too):')
        for f in sorted(cascade):
            print(f'   {f:66} {lines(f):5} lines')
        print()

    if dangling:
        print(f'--- !! {len(dangling)} SURVIVING file(s) import into the set.')
        print('    Fix these first, then git rm.\n')
        for f, hits in sorted(dangling.items()):
            print(f'   {f}')
            for h in hits:
                print(f'       -> {h}')
        print()
    else:
        print('--- no dangling imports. Safe to git rm.\n')

    print('--- git rm command:')
    quoted = ' \\\n          '.join(f"'{f}'" for f in sorted(doomed))
    print(f'git rm -q {quoted}')
    return 2 if dangling else 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1]))

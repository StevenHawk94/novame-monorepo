#!/usr/bin/env bash
set -euo pipefail
# Mirror only already-applied versions; never replay the old unregistered SQL.
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
mode="${1:---dry-run}"
version="${2:-20261009000207}"
case "$version" in
  20261009000207) suffix=burrow_coin_sandbox_wallet ;;
  20261009000208) suffix=burrow_coin_sandbox_testers ;;
  20261009000209) suffix=burrow_coin_prospective_testing ;;
  20261009000211) suffix=burrow_coin_environment_testing ;;
  *) echo 'Only coin sandbox migrations 207, 208, 209, and 211 are supported'; exit 2 ;;
esac
target="$repo_root/supabase/migrations/${version}_${suffix}.sql"
[[ "$mode" == "--dry-run" || "$mode" == "--apply" ]] || { echo 'Use --dry-run or --apply'; exit 2; }
listing="$(cd "$repo_root" && supabase migration list --linked)"
versions="$(printf '%s\n' "$listing" | awk -F '|' 'NF>=3 {v=$2;gsub(/^[[:space:]]+|[[:space:]]+$/, "",v);if(length(v)==14 && v~/^[0-9]+$/)print v}')"
[[ -n "$versions" ]] || { echo 'Remote migration history unavailable'; exit 1; }
if printf '%s\n' "$versions" | grep -qx "$version"; then echo "Migration $version already applied"; exit 0; fi
release_dir="$(mktemp -d /private/tmp/novame-coin-sandbox-migration.XXXXXX)"
mkdir -p "$release_dir/supabase/migrations" "$release_dir/supabase/.temp"
cp "$repo_root/supabase/config.toml" "$release_dir/supabase/config.toml"
for file in project-ref linked-project.json pooler-url; do
  cp "$repo_root/supabase/.temp/$file" "$release_dir/supabase/.temp/"
done
while IFS= read -r applied; do touch "$release_dir/supabase/migrations/${applied}_remote.sql"; done <<< "$versions"
cp "$target" "$release_dir/supabase/migrations/"
echo "Isolated migration directory: $release_dir"
args=(db push --linked)
if [[ "$mode" == "--dry-run" ]]; then args+=(--dry-run); else args+=(--yes); fi
(cd "$release_dir" && supabase "${args[@]}")

#!/usr/bin/env bash
set -euo pipefail

# Apply only this release's migration. Older SQL was often run manually, so
# --include-all against the primary checkout would replay unrelated changes.
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
mode="${1:---dry-run}"
version=20261005000201
target="$repo_root/supabase/migrations/${version}_burrow_solo_history.sql"
if [[ "$mode" != "--dry-run" && "$mode" != "--apply" ]]; then
  echo "Usage: bash tools/push-burrow-reliability.sh [--dry-run|--apply]" >&2
  exit 2
fi
for required in config.toml .temp/project-ref .temp/linked-project.json .temp/pooler-url; do
  [[ -f "$repo_root/supabase/$required" ]] || { echo "Missing linked Supabase file: $required" >&2; exit 1; }
done
[[ -f "$target" ]] || { echo "Missing migration: $version" >&2; exit 1; }

listing="$(cd "$repo_root" && supabase migration list --linked)"
remote_versions="$(printf '%s\n' "$listing" | awk -F '|' 'NF >= 3 {
  remote = $2
  gsub(/^[[:space:]]+|[[:space:]]+$/, "", remote)
  if (length(remote) == 14 && remote ~ /^[0-9]+$/) print remote
}')"
[[ -n "$remote_versions" ]] || { echo "Could not read remote migration history" >&2; exit 1; }
if printf '%s\n' "$remote_versions" | grep -qx "$version"; then
  echo "Migration $version is already registered; no SQL will be replayed."
  exit 0
fi

release_dir="$(mktemp -d /private/tmp/novame-burrow-reliability.XXXXXX)"
mkdir -p "$release_dir/supabase/migrations" "$release_dir/supabase/.temp"
cp "$repo_root/supabase/config.toml" "$release_dir/supabase/config.toml"
cp "$repo_root/supabase/.temp/project-ref" "$repo_root/supabase/.temp/linked-project.json" "$repo_root/supabase/.temp/pooler-url" "$release_dir/supabase/.temp/"
cp "$target" "$release_dir/supabase/migrations/"
# Empty mirrors satisfy the CLI's history check. These versions are already
# applied remotely; the mirrors neither execute nor alter their ledger entries.
while IFS= read -r remote; do
  touch "$release_dir/supabase/migrations/${remote}_remote.sql"
done <<< "$remote_versions"

echo "Isolated release directory: $release_dir"
args=(db push --linked)
if [[ "$mode" == "--dry-run" ]]; then args+=(--dry-run); else args+=(--yes); fi
(cd "$release_dir" && supabase "${args[@]}")

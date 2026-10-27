#!/usr/bin/env bash
set -euo pipefail
# Release only 237; do not replay older, manually applied migrations.
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
mode="${1:---dry-run}"
[[ "$mode" == "--dry-run" || "$mode" == "--apply" ]] || { echo 'Use --dry-run or --apply'; exit 2; }
version=20261014000237
listing="$(cd "$repo_root" && supabase migration list --linked)"
versions="$(printf '%s\n' "$listing" | awk -F '|' 'NF>=3 {v=$2;gsub(/^[[:space:]]+|[[:space:]]+$/, "",v);if(length(v)==14 && v~/^[0-9]+$/)print v}')"
[[ -n "$versions" ]] || { echo 'Remote migration history unavailable'; exit 1; }
if printf '%s\n' "$versions" | grep -qx "$version"; then echo "Migration $version already applied"; exit 0; fi
for prerequisite in 20260920000139 20261013000227 20261014000233 20261014000236; do
  printf '%s\n' "$versions" | grep -qx "$prerequisite" || { echo "Prerequisite $prerequisite missing"; exit 1; }
done
release_dir="$(mktemp -d /private/tmp/novame-release-room-migration.XXXXXX)"
mkdir -p "$release_dir/supabase/migrations" "$release_dir/supabase/.temp"
cp "$repo_root/supabase/config.toml" "$release_dir/supabase/config.toml"
for file in project-ref linked-project.json pooler-url; do cp "$repo_root/supabase/.temp/$file" "$release_dir/supabase/.temp/"; done
while IFS= read -r applied; do touch "$release_dir/supabase/migrations/${applied}_remote.sql"; done <<< "$versions"
cp "$repo_root/supabase/migrations/${version}_release_room.sql" "$release_dir/supabase/migrations/"
echo "Isolated migration directory: $release_dir"
args=(db push --linked)
if [[ "$mode" == "--dry-run" ]]; then args+=(--dry-run); else args+=(--yes); fi
(cd "$release_dir" && supabase "${args[@]}")

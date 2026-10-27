#!/usr/bin/env bash
set -euo pipefail
# Isolate this release: never replay earlier manually applied migrations.
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
mode="${1:---dry-run}"
[[ "$mode" == "--dry-run" || "$mode" == "--apply" || "$mode" == "--activate-dry-run" || "$mode" == "--activate" || "$mode" == "--treasure-dry-run" || "$mode" == "--treasure" || "$mode" == "--settlement-dry-run" || "$mode" == "--settlement" || "$mode" == "--outfits-dry-run" || "$mode" == "--outfits" ]] || { echo 'Unknown release mode'; exit 2; }
listing="$(cd "$repo_root" && supabase migration list --linked)"
versions="$(printf '%s\n' "$listing" | awk -F '|' 'NF>=3 {v=$2;gsub(/^[[:space:]]+|[[:space:]]+$/, "",v);if(length(v)==14 && v~/^[0-9]+$/)print v}')"
[[ -n "$versions" ]] || { echo 'Remote migration history unavailable'; exit 1; }
printf '%s\n' "$versions" | grep -qx '20261009000212' || { echo 'Expected prerequisite migration 212 is missing'; exit 1; }
release_names=(20261010000213_adventure_encounter_foundation 20261010000214_adventure_friends_content 20261010000215_adventure_encounter_runtime 20261010000216_burrow_kettle_shop)
if [[ "$mode" == --activate* ]]; then
  for prerequisite in "${release_names[@]}"; do
    printf '%s\n' "$versions" | grep -qx "${prerequisite%%_*}" || { echo "Activation prerequisite $prerequisite is missing"; exit 1; }
  done
  release_names=(20261010000217_enable_adventure_friends)
fi
if [[ "$mode" == --treasure* ]]; then
  for prerequisite in "${release_names[@]}" 20261010000217_enable_adventure_friends; do
    printf '%s\n' "$versions" | grep -qx "${prerequisite%%_*}" || { echo "Treasure prerequisite $prerequisite is missing"; exit 1; }
  done
  release_names=(20261011000218_adventure_treasure_furniture)
fi
if [[ "$mode" == --settlement* ]]; then
  for prerequisite in "${release_names[@]}" 20261010000217_enable_adventure_friends 20261011000218_adventure_treasure_furniture; do
    printf '%s\n' "$versions" | grep -qx "${prerequisite%%_*}" || { echo "Settlement prerequisite $prerequisite is missing"; exit 1; }
  done
  release_names=(20261011000219_adventure_unified_settlement)
fi
if [[ "$mode" == --outfits* ]]; then
  printf '%s\n' "$versions" | grep -qx '20261011000219' || { echo 'Outfit prerequisite 219 is missing'; exit 1; }
  release_names=(20261011000220_burrow_layered_outfits)
fi
release_dir="$(mktemp -d /private/tmp/novame-adventure-release.XXXXXX)"
mkdir -p "$release_dir/supabase/migrations" "$release_dir/supabase/.temp"
cp "$repo_root/supabase/config.toml" "$release_dir/supabase/config.toml"
for file in project-ref linked-project.json pooler-url; do cp "$repo_root/supabase/.temp/$file" "$release_dir/supabase/.temp/"; done
while IFS= read -r applied; do touch "$release_dir/supabase/migrations/${applied}_remote.sql"; done <<< "$versions"
for name in "${release_names[@]}"; do
  version="${name%%_*}"
  if ! printf '%s\n' "$versions" | grep -qx "$version"; then cp "$repo_root/supabase/migrations/${name}.sql" "$release_dir/supabase/migrations/"; fi
done
echo "Isolated release directory: $release_dir"
args=(db push --linked)
if [[ "$mode" == *dry-run ]]; then args+=(--dry-run); else args+=(--yes); fi
(cd "$release_dir" && supabase "${args[@]}")

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
supabase_dir="$repo_root/supabase"
migrations_dir="$supabase_dir/migrations"
mode="${1:---dry-run}"

if [[ "$mode" != "--dry-run" && "$mode" != "--apply" ]]; then
  echo "Usage: tools/push-bunny-court-v4.sh [--dry-run|--apply]" >&2
  exit 2
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required." >&2
  exit 1
fi

for required in config.toml .temp/project-ref .temp/linked-project.json .temp/pooler-url; do
  if [[ ! -f "$supabase_dir/$required" ]]; then
    echo "Missing linked Supabase file: supabase/$required" >&2
    exit 1
  fi
done

target_migrations=(
  "$migrations_dir/20260920000099_bunny_court_content_v4_schema.sql"
  "$migrations_dir"/202609200001??_bunny_court_content_v4_*.sql
)

if [[ "${#target_migrations[@]}" -ne 17 ]]; then
  echo "Expected 17 Bunny Court v4 migrations, found ${#target_migrations[@]}." >&2
  exit 1
fi

temp_root="$(mktemp -d "${TMPDIR:-/tmp}/novame-bunny-court-v4.XXXXXX")"
cleanup() {
  case "$temp_root" in
    */novame-bunny-court-v4.*) rm -rf -- "$temp_root" ;;
  esac
}
trap cleanup EXIT

temp_supabase="$temp_root/supabase"
temp_migrations="$temp_supabase/migrations"
mkdir -p "$temp_migrations" "$temp_supabase/.temp"
cp "$supabase_dir/config.toml" "$temp_supabase/config.toml"
cp "$supabase_dir/.temp/project-ref" "$supabase_dir/.temp/linked-project.json" "$supabase_dir/.temp/pooler-url" "$temp_supabase/.temp/"
cp "${target_migrations[@]}" "$temp_migrations/"

# The main repository contains migrations that were historically applied outside
# the CLI. Mirror only remote-applied versions as empty placeholders so db push
# cannot accidentally include unrelated local migrations.
migration_listing="$(cd "$repo_root" && supabase migration list --linked)"
while IFS= read -r version; do
  [[ -z "$version" ]] && continue
  if ! compgen -G "$temp_migrations/${version}_*.sql" >/dev/null; then
    : > "$temp_migrations/${version}_remote.sql"
  fi
done < <(
  printf '%s\n' "$migration_listing" |
    awk -F '|' 'NF >= 3 {
      remote = $2
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", remote)
      if (length(remote) == 14 && remote ~ /^[0-9]+$/) print remote
    }'
)

push_args=(db push --linked)
if [[ "$mode" == "--dry-run" ]]; then
  push_args+=(--dry-run)
else
  push_args+=(--yes)
fi

echo "Running isolated Bunny Court v4 migration $mode..."
(cd "$temp_root" && supabase "${push_args[@]}")

-- Rollback for 20260715000000_v2_enums.sql
-- Safe to run only while no column uses these types (i.e. before the
-- core-tables migration, or after its own rollback). drop type fails loudly
-- if a dependency exists, which is the correct guard.
drop type if exists public.kit_t;
drop type if exists public.gem_source;
drop type if exists public.xp_source;
drop type if exists public.tier_t;
drop type if exists public.item_rarity;
drop type if exists public.skill_source;
drop type if exists public.skill_rarity;
drop type if exists public.stage_t;
drop type if exists public.companion_t;
drop type if exists public.dimension_t;

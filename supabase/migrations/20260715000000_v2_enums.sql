-- v2.0 domain enums (schema doc §1.1).
--
-- The project has no custom enums today -- v1 used text columns with CHECK
-- constraints -- so these are pure creates with no name collision. Verified
-- against the live database: pg_enum returned nothing under the public schema.
--
-- Companion values are pet1/pet2/pet3, not animal names. The art delivery
-- decides what each pet actually is; keeping the enum abstract means that
-- choice never becomes a type migration.
--
-- Nothing in this migration is destructive: it only adds types. Rollback is
-- the paired down migration (drop type ... ), safe because no column uses
-- these types yet.

create type public.dimension_t as enum (
  'expression',   -- 表达力
  'awareness',    -- 自省力
  'momentum',     -- 行动力
  'direction',    -- 方向感
  'steadiness',   -- 稳定力
  'confidence',   -- 自信力
  'gratitude',    -- 知足力
  'connection'    -- 关系力
);

create type public.companion_t  as enum ('pet1', 'pet2', 'pet3');
create type public.stage_t      as enum ('juvenile', 'adult');
create type public.skill_rarity as enum ('normal', 'secret');
create type public.skill_source as enum ('self', 'friend');
create type public.item_rarity  as enum ('common', 'uncommon', 'rare');
create type public.tier_t       as enum ('free', 'paid');

create type public.xp_source as enum
  ('focus', 'reflect', 'quiet_wins', 'new_lens', 'true_north', 'tame_enemy');

create type public.gem_source as enum ('reflect', 'true_north');

create type public.kit_t as enum
  ('quiet_wins', 'new_lens', 'true_north', 'tame_enemy', 'visit_master');

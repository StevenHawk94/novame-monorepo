-- Quests participate in the same auditable Clover ledger as every other
-- earning source. PostgreSQL enum additions must commit before they are used
-- by a function, so the RPC itself is created in the following migration.
alter type public.xp_source add value if not exists 'quest';

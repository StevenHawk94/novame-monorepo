-- Activate v4 only after every content part succeeds.
update public.court_case_definitions set status = 'Retired', updated_at = now()
where status ilike '%Launch' and content_version < 4;
update public.court_case_definitions set status = 'Launch v4', updated_at = now()
where status = 'Staged v4' and content_version >= 4;

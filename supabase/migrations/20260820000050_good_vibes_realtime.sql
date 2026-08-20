-- Good Vibes is delivered immediately while the recipient has the app open.
-- Launch/foreground checks remain the fallback for offline devices.
do $$
begin
  alter publication supabase_realtime add table public.good_vibes;
exception
  when duplicate_object then null;
end
$$;

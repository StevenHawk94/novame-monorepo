import { apiClient } from './api';
import { supabase } from './supabase';

let lastTouch = 0;
export async function touchActivity(): Promise<void> {
  if (Date.now() - lastTouch < 15 * 60 * 1000) return;
  lastTouch = Date.now();
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user?.id) return;
  try {
    await apiClient.post('/api/activity', {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
  } catch {
    // Presence is an optimization signal; never interrupt the app for it.
  }
}

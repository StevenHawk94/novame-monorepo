import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { fetchSubscriptionTier } from './subscription';

let channel: RealtimeChannel | null = null;
let activeUserId: string | null = null;
let generation = 0;

async function reconcile(userId: string): Promise<void> {
  try {
    await fetchSubscriptionTier(userId, { force: true });
  } catch (error) {
    // Never downgrade on transport failure. The last confirmed cache remains
    // active and the next foreground/realtime event retries reconciliation.
    console.warn('[entitlement] refresh failed:', error);
  }
}

export async function startSubscriptionRealtime(userId: string): Promise<void> {
  let attemptGeneration: number | null = null;
  try {
    if (activeUserId === userId && channel) {
      // SIGNED_IN may fire again for a reauthentication and the existing account
      // cache is deliberately cleared by the root layout. Reconcile even when the
      // private channel itself is already healthy.
      void reconcile(userId);
      return;
    }
    await stopSubscriptionRealtime();
    const myGeneration = ++generation;
    attemptGeneration = myGeneration;

    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session || session.user.id !== userId || myGeneration !== generation) return;

    await supabase.realtime.setAuth(session.access_token);
    if (myGeneration !== generation) return;

    activeUserId = userId;
    channel = supabase
      .channel(`entitlement:${userId}`, { config: { private: true } })
      .on('broadcast', { event: 'entitlement_changed' }, () => {
        void reconcile(userId);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void reconcile(userId);
      });
  } catch (error) {
    // Auth restoration, websocket setup, and channel teardown can all race a
    // foreground/background transition. Realtime is an optimization; the
    // cached entitlement and the next foreground reconciliation remain valid.
    // Do not let an older failed attempt clear a newer channel that won the
    // foreground/auth race while this attempt was awaiting native work.
    if (attemptGeneration === null || attemptGeneration === generation) {
      activeUserId = null;
      channel = null;
    }
    console.warn('[entitlement] realtime start failed:', error);
  }
}

export async function resumeSubscriptionRealtime(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) return;
    // Foreground reconciliation is the delivery fallback for backgrounded or
    // disconnected devices and intentionally bypasses only the entitlement TTL.
    void reconcile(userId);
    await startSubscriptionRealtime(userId);
  } catch (error) {
    console.warn('[entitlement] realtime resume failed:', error);
  }
}

export async function stopSubscriptionRealtime(): Promise<void> {
  generation += 1;
  activeUserId = null;
  const current = channel;
  channel = null;
  if (!current) return;
  try {
    await supabase.removeChannel(current);
  } catch (error) {
    // A channel that is already disconnected/released needs no further work.
    console.warn('[entitlement] realtime stop failed:', error);
  }
}

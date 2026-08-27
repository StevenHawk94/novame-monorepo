import { useEffect } from 'react';
import { AppState } from 'react-native';
import { recoverReflectSettlements } from './reflect-settlement-outbox';
import { supabase } from './supabase';
import { fetchReflectFeed } from './reflect-feed-api';
import { fetchBags, invalidateMineBagsCache } from './bags-api';

export function useReflectSettlementRecovery() {
  useEffect(() => {
    let cancelled = false, running = false, retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function run() {
      if (cancelled || running || AppState.currentState !== 'active') return;
      running = true;
      const ok = await recoverReflectSettlements(() => {
        // Same targeted invalidation as a successful memory edit, no TTL changes.
        invalidateMineBagsCache();
        void fetchReflectFeed({ force: true });
        void fetchBags('mine');
      });
      running = false;
      if (!ok && !cancelled && AppState.currentState === 'active') {
        timer = setTimeout(() => { void run(); }, Math.min(60000, 5000 * 2 ** retry++));
      } else retry = 0;
    }
    void run();
    const listener = AppState.addEventListener('change', (state) => {
      clearTimeout(timer);
      if (state === 'active') void run();
    });
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // Outside Supabase's auth callback lock.
      if (event === 'SIGNED_IN') {
        clearTimeout(timer);
        timer = setTimeout(() => { void run(); }, 0);
      }
    });
    return () => { cancelled = true; clearTimeout(timer); listener.remove(); data.subscription.unsubscribe(); };
  }, []);
}

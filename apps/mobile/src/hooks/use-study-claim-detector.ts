/**
 * use-study-claim-detector — Stage 3.9.A.2.5
 *
 * Single global watcher mounted at the (main) layout level. On app
 * open the user expects the claim modal to appear immediately if the
 * conditions are met (mode === 'study' AND wp <= 0), not after a
 * delay.
 *
 * Strategy: instead of polling the local cache, we actively
 * fetchCharacterState() once shortly after mount. Server is the
 * source of truth, so a single round-trip on app open guarantees we
 * trigger as soon as we know the real state. After that, the slower
 * 30s fallback poll catches any later transition (e.g. WP decayed
 * to zero while the user was on Discover for 2 hours).
 *
 * Re-entrancy guard:
 *   - claimingRef latches true the moment we push the modal and
 *     releases via a 60s safety timeout in case the user dismisses
 *     the modal via gesture rather than the Awesome button.
 */
import { useCallback, useEffect, useRef } from 'react';
import { router } from 'expo-router';

import {
  requestModalSlot,
  releaseModalSlot,
  useActiveModalSlot,
} from '@/lib/modal-coordinator';

import {
  applyLocalWPDecay,
  fetchCharacterState,
  getCachedCharacterState,
} from '@/lib/character-state';
import { supabase } from '@/lib/supabase';

const POLL_INTERVAL_MS = 30_000;

export function useStudyClaimDetector() {
  const claimingRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  const initialFetchDoneRef = useRef(false);

  // Resolve userId once.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      userIdRef.current = data.session?.user.id ?? null;
    });
  }, []);

  const evaluate = useCallback(
    (
      mode: 'play' | 'study',
      wp: number,
      wpLastFetchedAtMs: number,
    ): boolean => {
      if (mode !== 'study') return false;
      const wpNow = applyLocalWPDecay(wp, mode, wpLastFetchedAtMs);
      return wpNow <= 0;
    },
    [],
  );

  // Coordinator (announcement > claim > skin): instead of pushing the route
  // immediately, register intent. The push happens only once claim becomes the
  // active (highest-priority requested) slot -- i.e. after any announcement
  // closes -- via the effect below. claimingRef latches so we request/push at
  // most once per detected condition.
  const triggerClaim = useCallback(() => {
    if (claimingRef.current) return;
    claimingRef.current = true;
    requestModalSlot('claim');
    // Safety release of the latch in case the modal is dismissed by gesture
    // without unmount-release firing (defensive; unmount cleanup is primary).
    setTimeout(() => {
      claimingRef.current = false;
    }, 60_000);
  }, []);

  // Push the study-claim route only when claim is the active slot. This makes
  // claim yield to a higher-priority announcement and only surface after it
  // closes. pushedRef guards against a double-push if active flips twice.
  const activeSlot = useActiveModalSlot();
  const pushedRef = useRef(false);
  useEffect(() => {
    if (activeSlot === 'claim' && claimingRef.current && !pushedRef.current) {
      pushedRef.current = true;
      router.push('/(main)/(modals)/study-claim');
    }
    if (activeSlot !== 'claim') {
      // Reset push latch once we are no longer active (modal closed -> slot
      // released by the study-claim screen), so a future condition can push again.
      pushedRef.current = false;
    }
  }, [activeSlot]);

  // Active first-fetch on mount: as soon as userId resolves, hit the
  // server and decide synchronously whether to push the modal. This
  // is what makes the modal feel instant on cold start.
  useEffect(() => {
    if (initialFetchDoneRef.current) return;

    let cancelled = false;
    const tryInitialFetch = async () => {
      // Wait briefly for userId to land.
      for (let i = 0; i < 20 && !userIdRef.current; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const userId = userIdRef.current;
      if (!userId || cancelled) return;

      // Optimistic check against cache first — if cached state already
      // says we should claim, push immediately while the network call
      // confirms in the background.
      const cached = getCachedCharacterState();
      if (
        cached &&
        evaluate(cached.mode, cached.wp, cached.wpLastFetchedAtMs)
      ) {
        triggerClaim();
      }

      try {
        console.log('[claim-detector] fetching server state…');
        const fresh = await fetchCharacterState(userId);
        if (cancelled) return;
        if (evaluate(fresh.mode, fresh.wp, fresh.wpLastFetchedAtMs)) {
          triggerClaim();
        }
      } catch (e) {
        console.warn('[claim-detector] initial fetch failed:', e);
      } finally {
        initialFetchDoneRef.current = true;
      }
    };

    void tryInitialFetch();
    return () => {
      cancelled = true;
    };
  }, [evaluate, triggerClaim]);

  // Background poll for the in-session case: user has been on
  // Discover or another tab for hours and WP just decayed to zero
  // locally. We re-check the cache every 30s and only fetch the
  // server when local indicates the condition holds (avoids hammering).
  useEffect(() => {
    const tick = () => {
      if (claimingRef.current) return;
      const cached = getCachedCharacterState();
      if (!cached) return;
      if (!evaluate(cached.mode, cached.wp, cached.wpLastFetchedAtMs)) return;

      const userId = userIdRef.current;
      if (!userId) return;

      // Confirm with server before triggering.
      void fetchCharacterState(userId)
        .then((fresh) => {
          if (evaluate(fresh.mode, fresh.wp, fresh.wpLastFetchedAtMs)) {
            triggerClaim();
          }
        })
        .catch(() => {
          // Silent — next tick will retry.
        });
    };

    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [evaluate, triggerClaim]);
}

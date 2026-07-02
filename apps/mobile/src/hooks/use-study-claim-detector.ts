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

import {
  requestStudyClaim,
  wasColdStartClaimHandled,
  isExternalClaimInFlight,
  isClaimDeferred,
} from '@/lib/study-claim-store';

import {
  applyLocalWPDecay,
  fetchCharacterState,
  getCachedCharacterState,
} from '@/lib/character-state';
import {
  computeLocalStudyClaim,
  type StudyClaimResponse,
} from '@/lib/study-claim-api';
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

  // Mark a study-claim as pending in the global store. The modal is rendered
  // and coordinated (announcement > claim > skin) by (tabs)/_layout.tsx, which
  // subscribes to study-claim-store and shows <StudyClaimModal> when claim is
  // the active coordinator slot. claimingRef latches so we request at most once
  // per detected condition; it releases when the modal closes (clearStudyClaim
  // in the store flips pending to null, but the latch is time-based here as a
  // defensive reset for the gesture-dismiss case).
  const triggerClaim = useCallback((result: StudyClaimResponse) => {
    if (claimingRef.current) return;
    const userId = userIdRef.current;
    if (!userId) return;
    // Nothing actually banked (stale/empty cache computed 0 XP): don't pop a
    // modal that the nothingToClaim path would instantly close (a visible
    // flicker). A subsequent fresh-fetch trigger with the real accumSecs
    // pops it properly. (In-session/poll callers only reach here after
    // evaluate() confirmed wp<=0, so a real session still pops.)
    if (result.nothingToClaim) return;
    claimingRef.current = true;
    // Optimistic local result -> instant modal, no spinner. The modal's
    // background postStudyClaim reconciles to the authoritative values
    // (and server-random souls / cardKeyword) afterwards.
    requestStudyClaim(userId, result);
    setTimeout(() => {
      claimingRef.current = false;
    }, 60_000);
  }, []);

  // Active first-fetch on mount: as soon as userId resolves, hit the
  // server and decide synchronously whether to push the modal. This
  // is what makes the modal feel instant on cold start.
  useEffect(() => {
    if (initialFetchDoneRef.current) return;

    let cancelled = false;
    const tryInitialFetch = async () => {
      // If the splash gate (app/index.tsx) already owns the cold-start
      // claim (it pre-settled and stashed the result), skip the initial
      // trigger entirely -- otherwise we'd race a second postStudyClaim
      // against the already-settled one and flash "+0 XP". The 30s
      // in-session poll below is unaffected; it covers WP hitting 0 later
      // in the session / on background return, long after the gate ran.
      if (wasColdStartClaimHandled()) {
        initialFetchDoneRef.current = true;
        return;
      }
      // Wait briefly for userId to land.
      for (let i = 0; i < 20 && !userIdRef.current; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const userId = userIdRef.current;
      if (!userId || cancelled) return;

      // Q11: do NOT pop from cache here. On the main cold-start case (study
      // started, then the process was killed for hours) the cache's
      // afkStudySeconds is stale/too-low -- popping from it would show a
      // wrong (small) XP or get skipped as 0. Fetch first and pop from the
      // fetched terminal value so the number is correct in one shot. Home has
      // already entered on the P0 gate, so this costs nothing visible there.
      try {
        const fresh = await fetchCharacterState(userId);
        if (cancelled) return;
        if (evaluate(fresh.mode, fresh.wp, fresh.wpLastFetchedAtMs)) {
          triggerClaim(
            computeLocalStudyClaim(fresh.afkStudySeconds ?? 0, fresh.totalExp),
          );
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
      // The background-resume overlay owns the claim while it settles
      // (it POSTs exactly once via preSettleStudyClaim). Skip the poll so
      // we don't race a second POST against the about-to-be-zeroed counter
      // -- the overlay clears this when it's done and the poll resumes as
      // the normal in-session fallback.
      if (isExternalClaimInFlight()) return;
      // A prior claim attempt failed with a network error and was deferred
      // to the Growth "Claim" button + next app open. Don't auto-pop here --
      // that would interrupt whatever the user is currently doing.
      if (isClaimDeferred()) return;
      const cached = getCachedCharacterState();
      if (!cached) return;
      if (!evaluate(cached.mode, cached.wp, cached.wpLastFetchedAtMs)) return;

      const userId = userIdRef.current;
      if (!userId) return;

      // Confirm with server before triggering.
      void fetchCharacterState(userId)
        .then((fresh) => {
          if (evaluate(fresh.mode, fresh.wp, fresh.wpLastFetchedAtMs)) {
            triggerClaim(
              computeLocalStudyClaim(fresh.afkStudySeconds ?? 0, fresh.totalExp),
            );
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

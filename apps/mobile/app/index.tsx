import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { getCurrentSession } from '@/lib/auth';
import { isOnboardingDone } from '@/lib/onboarding';
import { ensureP0Ready } from '@/lib/download-queue';
import { getHomeVideoFilename } from '@/lib/character-state';
import { preSettleStudyClaim } from '@/lib/pre-settle-study-claim';
import { markColdStartClaimHandled } from '@/lib/study-claim-store';
import { AssetGateError } from '@/components/main/asset-gate-error';

// P0 asset gate timeout for returning (session) cold starts. Independent
// of _layout's PREWARM_TIMEOUT_MS (that's for data fetches). P0 assets
// total ~766KB so this only trips on poor/no network.
const P0_ASSET_TIMEOUT_MS = 15000;

// Study-claim pre-settle gate timeout. On a returning cold start we
// pre-fetch character-state and, if a study session has ended (mode
// 'study' && wp<=0), settle the claim BEFORE entering Home so the
// "Session Complete" modal appears instantly with no in-Home loading.
// Capped so a slow/no network never strands the splash: on timeout we
// just enter Home and the in-session detector handles the claim there
// (current behaviour). Best-effort throughout.
const CLAIM_GATE_TIMEOUT_MS = 8000;

/**
 * Startup route — decides where to send the user after launch.
 *
 * Routing gate (session-first, industry-standard):
 *
 *   session exists                      → /(main)/(tabs)
 *   no session + onboarding not done    → /(onboarding)
 *   no session + onboarding done        → /(auth)/sign-in
 *
 * Why session-first:
 *
 * A valid session is the authoritative signal that the user is signed
 * in. Because onboarding always precedes account creation, anyone who
 * has a session has necessarily completed onboarding. We therefore
 * never gate a signed-in user on the local `done` flag — that flag can
 * be cleared by the post-sign-in server sync (syncOnboardingDataToServer
 * calls clearOnboardingState on success), by sign-out, or lost on
 * reinstall. Relying on it caused signed-in users to be bounced back to
 * onboarding on cold start after the sync cleared the local state.
 *
 * The local onboarding flag (MMKV "novame_onboarding_state".done) is
 * only consulted when there is NO session — to distinguish a brand-new
 * user (never onboarded) from a returning user who finished onboarding
 * but is signed out / not yet signed in.
 *
 * getCurrentSession() reads from AsyncStorage (async on RN), so we show
 * the launch loading screen until the read resolves, then redirect.
 * Every launch passes through this brief loading state — the standard
 * cold-start pattern.
 *
 * After this initial dispatch, app/_layout.tsx's onAuthStateChange
 * listener takes over for any subsequent sign-in / sign-out events.
 */
export default function Index() {
  const onboardingDone = isOnboardingDone();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [p0State, setP0State] = useState<'pending' | 'ready' | 'failed'>('pending');
  // Claim gate runs in parallel with the P0 asset gate. 'ready' means we
  // either settled a pending study-claim (result stashed in the store) or
  // determined there was nothing to claim -- either way Home may proceed.
  const [claimGate, setClaimGate] = useState<'pending' | 'ready'>('pending');
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getCurrentSession();
      if (!cancelled) {
        setHasSession(session !== null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // P0 asset gate — only for returning users heading to Home. Awaits
  // ensureP0Ready() (bucket-root assets) before redirecting; on a 15s
  // timeout (poor network) shows AssetGateError with Retry. Sessionless
  // paths (onboarding / auth) never trigger this. retryNonce re-runs it.
  useEffect(() => {
    if (hasSession !== true) return;
    let cancelled = false;
    setP0State('pending');
    const timer = setTimeout(() => {
      if (!cancelled) setP0State('failed');
    }, P0_ASSET_TIMEOUT_MS);
    void ensureP0Ready(getHomeVideoFilename()).then(() => {
      if (!cancelled) {
        clearTimeout(timer);
        setP0State('ready');
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasSession, retryNonce]);

  // Study-claim pre-settle gate — runs in parallel with the P0 gate for
  // returning users. Fetches the real character-state; if a study session
  // has ended (study && wp<=0) it POSTs the claim now and stashes the
  // result in the store so the modal renders instantly in Home (no
  // "Wrapping up..." spinner). If there's nothing to claim, or on
  // error/timeout, it simply marks ready and lets Home proceed (the
  // in-session detector remains the fallback). Best-effort: never blocks
  // Home for longer than CLAIM_GATE_TIMEOUT_MS.
  useEffect(() => {
    if (hasSession !== true) return;
    let cancelled = false;
    setClaimGate('pending');
    const timer = setTimeout(() => {
      if (!cancelled) setClaimGate('ready');
    }, CLAIM_GATE_TIMEOUT_MS);

    void (async () => {
      try {
        const session = await getCurrentSession();
        const userId = session?.user?.id;
        if (!userId) return;
        // Shared settle sequence. onClaimOwned marks the cold-start flag
        // BEFORE the POST so the detector's initial fetch yields (no
        // double-POST / "+0 XP"). isCancelled is checked after the fetch
        // but before the POST: if the 8s timeout already released Home and
        // unmounted us mid-fetch, we bail without POSTing and let the
        // in-session detector settle it (the counter is untouched). Once
        // the POST starts, the result is stashed in the module-level store
        // regardless of unmount, so it can't be lost.
        await preSettleStudyClaim(userId, {
          onClaimOwned: markColdStartClaimHandled,
          isCancelled: () => cancelled,
        });
      } catch (e) {
        console.warn('[index] claim pre-settle failed (non-fatal):', e);
      } finally {
        if (!cancelled) {
          clearTimeout(timer);
          setClaimGate('ready');
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Intentionally depends on hasSession only (NOT retryNonce): the claim
    // pre-settle must run exactly once per launch. retryNonce drives the P0
    // asset Retry button; re-running the claim on retry would fire a second
    // postStudyClaim against an already-zeroed afk_study_seconds and flash
    // "+0 XP". P0 retry and claim settling are independent concerns.
  }, [hasSession]);

  // Session check still pending. Return null and let the native splash
  // (kept visible via preventAutoHideAsync in _layout.tsx) stay up. We
  // intentionally render no loading screen of our own here — the splash
  // IS the loading screen, and it persists until the destination screen
  // signals first layout via hideSplashOnce(). This avoids a second,
  // redundant loading screen flashing between splash and content.
  if (hasSession === null) {
    return null;
  }

  if (hasSession) {
    if (p0State === 'failed') {
      return <AssetGateError onRetry={() => setRetryNonce((n) => n + 1)} />;
    }
    // Enter Home only when BOTH gates are ready: P0 assets downloaded AND
    // the study-claim pre-settle finished (settled-or-nothing-to-claim).
    // The claim gate has its own timeout, so it cannot strand the splash.
    if (p0State === 'ready' && claimGate === 'ready') {
      return <Redirect href="/(main)/(tabs)" />;
    }
    // Still gating: keep the native splash up.
    return null;
  }

  if (!onboardingDone) {
    return <Redirect href="/(onboarding)" />;
  }
  return <Redirect href="/(auth)/sign-in" />;
}

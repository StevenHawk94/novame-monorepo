import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { getCurrentSession } from '@/lib/auth';
import { isOnboardingDone } from '@/lib/onboarding';
import { ensureP0Ready } from '@/lib/download-queue';
import { getHomeVideoFilename } from '@/lib/character-state';
import { AssetGateError } from '@/components/main/asset-gate-error';

// P0 asset gate timeout for returning (session) cold starts. Independent
// of _layout's PREWARM_TIMEOUT_MS (that's for data fetches). P0 assets
// total ~766KB so this only trips on poor/no network.
const P0_ASSET_TIMEOUT_MS = 15000;

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
    if (p0State === 'ready') return <Redirect href="/(main)/(tabs)" />;
    if (p0State === 'failed') {
      return <AssetGateError onRetry={() => setRetryNonce((n) => n + 1)} />;
    }
    // p0 pending: keep the native splash up while P0 assets download.
    return null;
  }

  if (!onboardingDone) {
    return <Redirect href="/(onboarding)" />;
  }
  return <Redirect href="/(auth)/sign-in" />;
}

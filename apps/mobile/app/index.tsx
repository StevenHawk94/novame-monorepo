import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';

import { AssetGateError } from '@/components/main/asset-gate-error';
import { getCurrentSession } from '@/lib/auth';
import { ensureP0Ready } from '@/lib/download-queue';

/**
 * Entry gate. Blocks on P0 assets, then routes on session.
 *
 * Phase A dropped the onboarding branch. The eleven-step v1 flow is gone and
 * the six-step v2.0 flow does not exist yet, so there is nowhere to send a
 * user who has not finished it. Routing to a screen that is not there is
 * worse than not routing: a stub `isOnboardingDone()` returning false would
 * have been a lie the compiler happily accepts. Phase C restores the branch.
 *
 * ensureP0Ready() takes an optional filename -- v1 passed the home video so it
 * would be on disk before the first frame. That filename came from
 * character-state, and the v2.0 P0 set is companion videos anyway. Passing
 * nothing still downloads every bucket-root asset; only the extra hint is lost.
 */
type Gate = 'loading' | 'ready' | 'failed';

export default function Index() {
  const [gate, setGate] = useState<Gate>('loading');
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await getCurrentSession();
      if (cancelled) return;
      setHasSession(Boolean(session));
      try {
        await ensureP0Ready();
        if (!cancelled) setGate('ready');
      } catch {
        if (!cancelled) setGate('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate === 'failed') return <AssetGateError onRetry={() => setGate('loading')} />;
  if (gate === 'loading' || hasSession === null) return null;
  return <Redirect href={hasSession ? '/(main)/(tabs)' : '/(auth)/sign-in'} />;
}

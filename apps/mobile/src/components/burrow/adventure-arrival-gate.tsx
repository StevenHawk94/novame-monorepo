import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router, useGlobalSearchParams, useSegments } from 'expo-router';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import { burrowClock, getBurrowSnapshot, refreshBurrow, refreshBurrowAfterCurrent, useBurrowSnapshot } from '@/lib/burrow-store';
import { createAdventureArrival } from '@/lib/burrow-presentation';
import { subscribeSessionIdentity } from '@/lib/session-lifecycle';
import { hasActiveReflectSettlement } from '@/lib/reflect-settlement-outbox';
import { useHomeEntry } from '@/lib/use-home-entry';
import { useOverlayPresent } from '@/lib/overlay-presence';

/** One gate in MainLayout. Never replace a journal, battle or modal route. */
export function AdventureArrivalGate() {
  const enabled = useMajorUpdateEnabled();
  const { data, loading, error, busy, receivedAt } = useBurrowSnapshot();
  const entry = useHomeEntry();
  const overlay = useOverlayPresent();
  const segments = useSegments();
  const params = useGlobalSearchParams<{ section?: string }>();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [resumeReady, setResumeReady] = useState(false);
  const arrival = useRef(createAdventureArrival());
  useEffect(() => {
    if (!enabled) { arrival.current.reset(); return; }
    let backgrounded = AppState.currentState !== 'active';
    let generation = 0;
    const resume = () => {
      const current = ++generation;
      setResumeReady(false);
      arrival.current.resume(getBurrowSnapshot().data);
      void refreshBurrowAfterCurrent().then(() => { if (current === generation) setResumeReady(true); });
    };
    if (AppState.currentState === 'active') resume();
    const app = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      if (state === 'background') backgrounded = true;
      else if (state === 'active' && backgrounded) { backgrounded = false; resume(); }
    });
    const identity = subscribeSessionIdentity(() => { generation++; setResumeReady(false); arrival.current.reset(); });
    return () => { generation++; app.remove(); identity(); };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !foreground || !resumeReady) return;
    arrival.current.observe(data, !loading && !error);
    const alreadyThere = segments[segments.length - 1] === 'burrow-detail' && params.section === 'adventure';
    const safe = segments.some(segment => segment === '(tabs)') && !entry.pending && !overlay && !busy && !loading && !error && !hasActiveReflectSettlement();
    if (arrival.current.take(!!safe, alreadyThere)) {
      router.push({ pathname: '/(main)/burrow-detail', params: { section: 'adventure' } });
    }
  }, [enabled, foreground, resumeReady, data, loading, error, busy, segments, params.section, entry.pending, overlay]);
  // One server refresh at each deadline, not polling once a second. The
  // refreshed result lights the button; it never creates a foreground intent.
  useEffect(() => {
    const adventure = data?.activeAdventure;
    if (!enabled || !foreground || adventure?.status !== 'in_progress' || error) return;
    const serverNow = Date.parse(data!.serverNow) + Math.max(0, burrowClock() - receivedAt);
    const delay = Date.parse(adventure.ends_at) - serverNow;
    if (!Number.isFinite(delay)) return;
    const timer = setTimeout(() => { void refreshBurrow(); }, Math.max(1000, Math.min(delay + 250, 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [enabled, foreground, data?.activeAdventure?.id, data?.activeAdventure?.status, data?.activeAdventure?.ends_at, receivedAt, error]);
  return null;
}

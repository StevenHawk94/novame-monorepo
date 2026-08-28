import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useSegments } from 'expo-router';
import * as StoreReview from 'expo-store-review';

import { subscribeOfficialRatingRequest } from '@/lib/official-rating-prompt';
import { useRatingTransitionBusy } from '@/lib/rating-navigation';
import { useAppDialogVisible } from '@/components/ui/app-dialog';

let requestInFlight = false;

async function requestOfficialRating(): Promise<void> {
  if (requestInFlight) return;
  requestInFlight = true;
  try {
    if (await StoreReview.hasAction()) {
      await StoreReview.requestReview();
    }
  } catch (error) {
    console.warn('[official-rating] request failed:', error);
  } finally {
    requestInFlight = false;
  }
}

/**
 * Waits until Claim navigation and app alerts have settled before requesting the native
 * store dialog. Any modal route (including the Free reflection paywall) keeps
 * the request pending until it closes.
 */
export function OfficialRatingGate() {
  const segments = useSegments();
  const routeKey = useMemo(() => segments.join('/'), [segments]);
  const [pending, setPending] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const transitionBusy = useRatingTransitionBusy();
  const dialogVisible = useAppDialogVisible();

  useEffect(() => subscribeOfficialRatingRequest(() => setPending(true)), []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const routeSegments = routeKey.split('/');
    // Reflect uses a native fullScreenModal, not the '(modals)' route group.
    // Defer until a base tab is visible AND native dismissal has completed.
    // The timer holds no overlay, navigation lock, or interaction handle.
    if (!pending || appState !== 'active' || !routeSegments.includes('(tabs)') || transitionBusy || dialogVisible) return;

    const timer = setTimeout(() => {
      setPending(false);
      void requestOfficialRating();
    }, 1200);

    return () => {
      clearTimeout(timer);
    };
  }, [appState, pending, routeKey, transitionBusy, dialogVisible]);

  return null;
}

import { useEffect, useMemo, useState } from 'react';
import { AppState, InteractionManager } from 'react-native';
import { useSegments } from 'expo-router';
import * as StoreReview from 'expo-store-review';

import { subscribeOfficialRatingRequest } from '@/lib/official-rating-prompt';

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
 * Waits only until Claim navigation has settled before requesting the native
 * store dialog. Any modal route (including the Free reflection paywall) keeps
 * the request pending until it closes.
 */
export function OfficialRatingGate() {
  const segments = useSegments();
  const routeKey = useMemo(() => segments.join('/'), [segments]);
  const [pending, setPending] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => subscribeOfficialRatingRequest(() => setPending(true)), []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const routeSegments = routeKey.split('/');
    const modalOpen = routeSegments.includes('(modals)');
    if (!pending || appState !== 'active' || modalOpen) return;

    const interaction = InteractionManager.runAfterInteractions(() => {
      setPending(false);
      void requestOfficialRating();
    });

    return () => {
      interaction.cancel();
    };
  }, [appState, pending, routeKey]);

  return null;
}

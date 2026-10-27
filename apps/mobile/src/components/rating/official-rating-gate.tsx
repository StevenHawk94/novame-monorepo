import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router, useSegments } from 'expo-router';
import * as StoreReview from 'expo-store-review';

import { subscribeOfficialRatingRequest } from '@/lib/official-rating-prompt';
import { getNextReflectionPaywallVariant, subscribeReflectionPaywallRequest } from '@/lib/reflection-paywall-count';
import { isNavigationTransitionBusy, useRatingTransitionBusy } from '@/lib/rating-navigation';
import { useAppDialogVisible } from '@/components/ui/app-dialog';
import { useSubscriptionTierState } from '@/lib/use-subscription-tier';
import { useActiveModalSlot } from '@/lib/modal-coordinator';
import { isOverlayPresent, useOverlayPresent } from '@/lib/overlay-presence';
import { withDeadline } from '@/lib/async-lifecycle';
import { useHomeEntry } from '@/lib/use-home-entry';
import { consumeAdventurePaywall, peekAdventurePaywall, subscribeAdventurePaywall } from '@/lib/adventure-paywall';
import { canPresentRatingInline, consumeRatingMilestone, peekRatingMilestone, subscribeRatingMilestones, type RatingMilestone } from '@/lib/official-rating-milestones';
import { useCoinRewardBusy } from '@/lib/coin-reward-store';

let requestInFlight = false;

async function requestOfficialRating(canPresent: () => boolean): Promise<boolean> {
  if (requestInFlight || !canPresent()) return false;
  requestInFlight = true;
  try {
    const supported = await withDeadline(StoreReview.hasAction());
    if (!canPresent()) return false;
    if (supported) await StoreReview.requestReview();
    return true;
  } catch (error) {
    console.warn('[official-rating] request failed:', error);
    return true;
  } finally {
    requestInFlight = false;
  }
}

/** Non-blocking promotional queue; partner records never trigger an offer. */
export function OfficialRatingGate() {
  const homeEntry = useHomeEntry();
  const segments = useSegments();
  const routeKey = useMemo(() => segments.join('/'), [segments]);
  const [pending, setPending] = useState(false);
  const [milestone, setMilestone] = useState<RatingMilestone | null>(peekRatingMilestone);
  const [pendingPaywall, setPendingPaywall] = useState(false);
  const [adventurePaywall, setAdventurePaywall] = useState<string | null>(peekAdventurePaywall);
  const [requestingRating, setRequestingRating] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const transitionBusy = useRatingTransitionBusy();
  const dialogVisible = useAppDialogVisible();
  const tier = useSubscriptionTierState();
  const activeModal = useActiveModalSlot();
  const overlayPresent = useOverlayPresent();
  const rewarding = useCoinRewardBusy();
  const mounted = useRef(true);
  const presentingPaywall = useRef(false);
  const presentationRecovery = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const routeSegments = routeKey.split('/');
  const atTabs = routeSegments.includes('(tabs)');
  const atHome = routeKey === '(main)/(tabs)' || routeKey === '(main)/(tabs)/index';
  const atReflectPicker = routeKey === '(main)/reflect';
  const atMilestoneSurface = milestone?.kind === 'affection' && routeSegments.includes('affection-detail') && canPresentRatingInline(milestone)
    || milestone?.kind === 'purchase' && routeSegments.some(segment => ['shop-detail', 'toy-collection', 'toy-shop'].includes(segment));
  const idle = appState === 'active'
    && !homeEntry.pending
    && !homeEntry.resumeRequired
    && !transitionBusy
    && !dialogVisible
    && !activeModal
    && !overlayPresent
    && !rewarding;
  const eligibility = useRef({ paywall: false, rating: false });
  eligibility.current = {
    paywall: idle && tier === 'free' && (atTabs || atReflectPicker) && !presentingPaywall.current,
    rating: idle && tier !== null && (atTabs || atReflectPicker || !!atMilestoneSurface)
      && !(tier === 'free' && (pendingPaywall || adventurePaywall)) && !presentingPaywall.current,
  };

  useEffect(() => subscribeOfficialRatingRequest(() => setPending(true)), []);
  useEffect(() => subscribeRatingMilestones(() => setMilestone(peekRatingMilestone())), []);
  useEffect(() => subscribeReflectionPaywallRequest(() => setPendingPaywall(true)), []);
  useEffect(() => subscribeAdventurePaywall(() => setAdventurePaywall(peekAdventurePaywall())), []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(presentationRecovery.current); };
  }, []);

  useEffect(() => {
    // A visible unified offer also satisfies a pending Adventure promotion;
    // Never stack another identical offer after a manual offer closes.
    if (routeSegments.some(segment => ['subscription-paywall', 'reflection-plus-paywall'].includes(segment))) {
      if (adventurePaywall) consumeAdventurePaywall(adventurePaywall);
      presentingPaywall.current = false;
      clearTimeout(presentationRecovery.current);
    }
    if (routeSegments.includes('reflection-plus-paywall')) {
      setPendingPaywall(false);
      presentingPaywall.current = false;
      clearTimeout(presentationRecovery.current);
    }
  }, [routeKey, adventurePaywall]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (tier !== null && tier !== 'free') {
      if (pendingPaywall) setPendingPaywall(false);
      if (adventurePaywall) consumeAdventurePaywall(adventurePaywall);
    }
    if (requestingRating) return;

    if (tier === 'free' && adventurePaywall) {
      if (!atHome || !eligibility.current.paywall) return;
      const frame = requestAnimationFrame(() => {
        if (!mounted.current || AppState.currentState !== 'active' || !eligibility.current.paywall
          || isNavigationTransitionBusy() || isOverlayPresent() || peekAdventurePaywall() !== adventurePaywall) return;
        presentingPaywall.current = true;
        try {
          router.push('/(main)/(modals)/subscription-paywall' as never);
          clearTimeout(presentationRecovery.current);
          presentationRecovery.current = setTimeout(() => { presentingPaywall.current = false; }, 1500);
        } catch (error) {
          presentingPaywall.current = false;
          console.warn('[adventure-paywall] presentation failed:', error);
        }
      });
      return () => cancelAnimationFrame(frame);
    }

    if (tier === 'free' && pendingPaywall) {
      if (!eligibility.current.paywall) return;
      const frame = requestAnimationFrame(() => {
        if (!mounted.current || AppState.currentState !== 'active' || !eligibility.current.paywall || isNavigationTransitionBusy() || isOverlayPresent()) return;
        presentingPaywall.current = true;
        try {
          router.push({
            pathname: '/(main)/(modals)/reflection-plus-paywall',
            params: { variant: getNextReflectionPaywallVariant() },
          } as never);
          clearTimeout(presentationRecovery.current);
          presentationRecovery.current = setTimeout(() => { presentingPaywall.current = false; }, 1500);
        } catch (error) {
          presentingPaywall.current = false;
          console.warn('[reflection-paywall] presentation failed:', error);
        }
      });
      return () => cancelAnimationFrame(frame);
    }

    if ((!pending && !milestone) || !eligibility.current.rating) return;
    const frame = requestAnimationFrame(() => {
      if (!mounted.current || !eligibility.current.rating || isNavigationTransitionBusy() || isOverlayPresent()) return;
      setRequestingRating(true);
      const currentRequest = () => !milestone || (() => { const current = peekRatingMilestone();
        return current?.id === milestone.id && current.userId === milestone.userId; })();
      void requestOfficialRating(() => mounted.current && currentRequest() && AppState.currentState === 'active' && eligibility.current.rating && !isNavigationTransitionBusy() && !isOverlayPresent())
        .then((handled) => {
          if (!mounted.current) return;
          if (handled) { setPending(false); if (milestone) consumeRatingMilestone(milestone); }
          setRequestingRating(false);
        });
    });
    return () => cancelAnimationFrame(frame);
  }, [appState, pending, milestone, pendingPaywall, adventurePaywall, requestingRating, routeKey, transitionBusy, dialogVisible, tier, activeModal, overlayPresent, rewarding, homeEntry.pending, homeEntry.resumeRequired]);

  return null;
}

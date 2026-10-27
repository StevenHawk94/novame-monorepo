import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { BurrowToastHost } from '@/components/burrow/burrow-toast-host';
import { ratingNavigationListeners, resetNavigationTransitions } from '@/lib/rating-navigation';

import { OfficialRatingGate } from '@/components/rating/official-rating-gate';
import { HomeEntryGate } from '@/components/main/home-entry-gate';
import { BurrowEnvironmentGate } from '@/components/burrow/burrow-environment-gate';
import { useReflectSettlementRecovery } from '@/lib/use-reflect-settlement-recovery';
import { AndroidCompactTypographyProvider } from '@/components/ui/android-compact-typography';
import { getCurrentSession } from '@/lib/auth';
import { syncOnboardingCompanion, syncOnboardingProfile } from '@/lib/onboarding';
import { syncProfileAvatar } from '@/lib/avatar-upload-queue';
import {syncLocalProfileAvatar,onProfileAvatarCommitted} from '@/lib/profile-avatar-local';
import { syncAccountProfile } from '@/lib/account-profile-local';
import {sessionUserId} from '@/lib/session-lifecycle';
import {invalidateMeStats,fetchMeStats} from '@/lib/me-stats';
import {scheduleBurrowRefresh} from '@/lib/burrow-store';
import { BurrowMusicGate } from '@/components/burrow/burrow-music';
import { AdventureArrivalGate } from '@/components/burrow/adventure-arrival-gate';
import { BurrowSyncGate } from '@/components/burrow/burrow-sync-gate';
import { PartnerConnectionGate } from '@/components/main/partner-connection-gate';
import { GameSyncGate } from '@/components/burrow/game-sync-gate';
import {PlushieTouchSyncGate} from '@/components/burrow/plushie-touch-sync-gate';
import { BurrowPageEntryOverlay } from '@/components/burrow/burrow-page-entry-overlay';
import { SurpriseArrivalGate } from '@/components/burrow/surprise-arrival-gate';
import { MAIN_CARD_OPTIONS, MAIN_ADVENTURE_INPUT_OPTIONS, MAIN_TAB_OPTIONS, burrowDetailOptions } from '@/lib/main-navigation-options';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import {burrowDestinationId} from '@/lib/burrow-destination-model';

/**
 * Authenticated app layout.
 *
 * useStudyClaimDetector() went with the willpower system (D5).
 *
 * Burrow cards retain their existing navigation and durable-input policies.
 * Retired links forward without mounting a legacy screen or transition.
 */
export default function MainLayout() {
  const majorUpdate = useMajorUpdateEnabled();
  useReflectSettlementRecovery();
  useEffect(() => {
    let active = true;
    const resumePendingOnboarding = (force = false) => {
      void getCurrentSession().then((session) => {
        if (!active || !session?.user?.id) return;
        void syncOnboardingCompanion(session.user.id, { force });
        void syncOnboardingProfile(session.user.id, { force });
        void syncProfileAvatar(session.user.id, { force });
        void syncLocalProfileAvatar();
        void syncAccountProfile();
      }).catch(() => {});
    };
    // A cold returning launch goes directly to Main instead of signing-in.
    // Force one attempt on mount so a task survives process termination.
    resumePendingOnboarding(true);
    const avatarChanged=onProfileAvatarCommitted(()=>{
      const owner=sessionUserId();if(!owner)return;
      invalidateMeStats();void fetchMeStats(owner,{force:true}).catch(()=>{});scheduleBurrowRefresh();
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') resumePendingOnboarding();
      else resetNavigationTransitions();
    });
    return () => { active = false; subscription.remove();avatarChanged(); resetNavigationTransitions(); };
  }, []);
  return (
    <AndroidCompactTypographyProvider>
      <HomeEntryGate>
        <BurrowEnvironmentGate enabled={majorUpdate}>
        <Stack
          screenListeners={ratingNavigationListeners}
          screenOptions={MAIN_CARD_OPTIONS}
        >
          <Stack.Screen
            name="(tabs)"
            options={MAIN_TAB_OPTIONS}
          />
          <Stack.Screen name="room-interaction" options={{ contentStyle: { backgroundColor: '#FFFAF2' } }} />
          <Stack.Screen name="plushie-touch" options={{ contentStyle: { backgroundColor: '#502B1E' } }} />
          <Stack.Screen name="love-note-history" options={{ contentStyle: { backgroundColor: '#FFFAF2' } }} />
          <Stack.Screen name="love-note-detail" options={{ contentStyle: { backgroundColor: '#FFFAF2' } }} />
          <Stack.Screen name="gift-library" options={{ contentStyle: { backgroundColor: '#874727' } }} />
          <Stack.Screen name="gift-preview" options={{ contentStyle: { backgroundColor: '#FFF8EC' } }} />
          <Stack.Screen name="music-player" options={{ contentStyle: { backgroundColor: '#24150F' } }} />
          <Stack.Screen name="menu" options={{
            ...MAIN_CARD_OPTIONS,
            contentStyle: { backgroundColor: '#FFF9F0' },
          }} />
          <Stack.Screen name="toy-collection" options={{ fullScreenGestureEnabled: false, contentStyle: { backgroundColor: '#FFFAF2' } }} />
          <Stack.Screen name="toy-shop" options={{ fullScreenGestureEnabled: false, contentStyle: { backgroundColor: '#FFFAF2' } }} />
          <Stack.Screen name="coin-shop" options={{ presentation: 'transparentModal', animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="insufficient-coins" options={{ presentation: 'transparentModal', animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="pair-partner" options={{ presentation: 'transparentModal', animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="partner-connected" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: '#572B1A' } }} />
          <Stack.Screen name="burrow-detail" getId={burrowDestinationId} options={({ route }) => burrowDetailOptions(route.params as Record<string, unknown>)} />
          <Stack.Screen name="affection-detail" options={{ contentStyle: { backgroundColor: '#ED8390' } }} />
          <Stack.Screen name="game-room" />
          <Stack.Screen name="surprise-room" options={({route})=>(route.params as {receive?:string}|undefined)?.receive==='1'
            ? {presentation:'transparentModal',animation:'fade',gestureEnabled:false,contentStyle:{backgroundColor:'transparent'}}
            : {contentStyle:{backgroundColor:'#492817'}}}/>
          <Stack.Screen name="moment-detail" />
          <Stack.Screen name="shop-detail" />
          {/* This group contains settings/detail pages, not a sheet. Actual
              sheets and protected input tasks have explicit options below. */}
          <Stack.Screen name="(modals)" />
          <Stack.Screen
            name="ai-consent"
            options={{ presentation: 'transparentModal', animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: 'transparent' } }}
          />
          {['item-sheet','companion-sheet','quiet-wins','new-lens','true-north','friend-add','friends-list',
            'friend-profile','their-patterns','friend-detail','my-logs','reflect-detail','friend-reflect-detail',
            'guess','guesses'].map(name => <Stack.Screen key={name} name={name}
              options={{animation:'none',gestureEnabled:false,contentStyle:{backgroundColor:'transparent'}}} />)}
          <Stack.Screen name="tame-enemy" options={MAIN_CARD_OPTIONS} />
          <Stack.Screen name="visit-master" options={majorUpdate ? { animation: 'none', gestureEnabled: false } : MAIN_CARD_OPTIONS} />
          {['quest-custom', 'quest-pick', 'quest-write-own'].map(name => <Stack.Screen key={name} name={name} options={majorUpdate ? { animation: 'none', gestureEnabled: false } : MAIN_CARD_OPTIONS} />)}
          <Stack.Screen
            name="reflect"
            options={{
              presentation: 'card',
              animation: 'slide_from_bottom',
              animationDuration: 250,
              gestureEnabled: false,
              // The bundled sunset art can take one frame to decode on its
              // first visit. Match that art instead of exposing the stack's
              // shared deep-brown fallback during the transition.
              contentStyle: { backgroundColor: '#FE6F79' },
            }}
          />
          <Stack.Screen name="reflect-typing" options={majorUpdate ? MAIN_ADVENTURE_INPUT_OPTIONS
            : { presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />
          <Stack.Screen name="reflect-guided" options={majorUpdate ? MAIN_ADVENTURE_INPUT_OPTIONS
            : { presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />
          <Stack.Screen name="shared-memory-create" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />
          <Stack.Screen
            name="thump"
            options={{
              presentation: 'card',
              animation: 'none',
              animationDuration: 250,
              gestureEnabled: false,
              // Retired route: reveal the existing tabs, never paint an alias.
              contentStyle: { backgroundColor: 'transparent' },
            }}
          />
        </Stack>
        <OfficialRatingGate />
        <BurrowMusicGate />
        <AdventureArrivalGate />
        <SurpriseArrivalGate />
        <BurrowSyncGate />
        <GameSyncGate />
        {majorUpdate&&<PlushieTouchSyncGate/>}
        {majorUpdate && <PartnerConnectionGate />}
        {majorUpdate && <BurrowPageEntryOverlay />}
        <BurrowToastHost />
        </BurrowEnvironmentGate>
      </HomeEntryGate>
    </AndroidCompactTypographyProvider>
  );
}

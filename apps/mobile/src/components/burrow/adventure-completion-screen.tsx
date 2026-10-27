import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useIsFocused, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from './burrow-image';
import { BurrowBackButton } from './burrow-back-button';
import { AdventureTreasure } from './adventure-treasure';
import { AdventureEncounterCard } from './adventure-encounter-card';
import { AdventureFriendCard } from './adventure-friend-card';
import { AdventureEncounterLayout } from './adventure-encounter-layout';
import { BURROW_BACKGROUNDS } from '@/lib/burrow-art-assets';
import { claimAdventureResult, type MajorUpdateBootstrap, type MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { confirmBurrowAdventureClaimLocally, confirmBurrowAdventureInteractionLocally, confirmBurrowAdventureItemLocally, runBurrowAction } from '@/lib/burrow-store';
import { queueAdventureDelivery, readAdventureDelivery, resumeAdventureDelivery } from '@/lib/adventure-delivery';
import { dismissToRetainedTab } from '@/lib/retained-tab-navigation';
import { adventureFriendPresentation } from '@/lib/adventure-friend-presentation';
import { adventureTreasureReward } from '@/lib/adventure-treasure-reward';
import { AdventureStageTransition } from './adventure-stage-transition';
import { recordAdventurePaywallCompletion } from '@/lib/adventure-paywall';
import { markNavigationTransitionPending } from '@/lib/rating-navigation';

/** One mounted flow per journey. The intermediate claim receipt advances the
 * UI immediately; a slow/stale bootstrap must not strand users at the chest. */
export function AdventureCompletionScreen({ data }: { data: MajorUpdateBootstrap }) {
  const adventure = data.activeAdventure!, result = data.adventureResult!, meta = result.metadata;
  const v2 = !!meta?.encounterV2, hasFriend = !!result.friend_id || !!meta?.dialogue;
  const pending = readAdventureDelivery(adventure.id);
  const finishedOnEntry = useRef(!!pending?.finish && !pending.failed);
  const [encounter, setEncounter] = useState(!!pending?.treasure || v2 && !meta?.treasureReserved || !!meta?.treasureClaimed || !!meta?.dialogueCompleted || adventure.status === 'interaction_required' || result.claim_status === 'interaction_required');
  // Freeze before the chest claim (legacy claims can add a discovery), not on each dialogue tap.
  const [meeting] = useState(() => adventureFriendPresentation(data));
  const [legacyInvited, setLegacyInvited] = useState(!meeting.isNewFriend), [finished, setFinished] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const focused = useIsFocused(), focusRef = useRef(focused); focusRef.current = focused;
  const route = useRoute(), exitLock = useRef(false);
  const [completionOrdinal] = useState(() => {
    const completed = data.specialQuests?.find(quest => quest.questId === 'adventures_completed')?.progress;
    return typeof completed === 'number' ? completed + 1 : undefined;
  });
  const insets = useSafeAreaInsets();
  const treasureReward=adventureTreasureReward(meta,data.inventory,data.profile.id);
  const coins=v2?treasureReward.coins:0;
  const snapshot = v2 ? treasureReward.item : meta?.itemSnapshot;
  const item: MajorUpdateCatalogItem | null = snapshot && 'asset' in snapshot ? snapshot as MajorUpdateCatalogItem
    : v2 ? null : data.catalog.find(x => x.stable_id === result.item_id) ?? null;
  const title = coins?`${coins} Coins`:item?.title ?? snapshot?.title ?? 'You’ve collected every furniture item on this trail.';
  const exit = () => { if (focusRef.current) dismissToRetainedTab('/(main)/(tabs)'); };
  const finish = () => {
    if (!focusRef.current || exitLock.current) return;
    exitLock.current = true;
    if (Platform.OS !== 'web') markNavigationTransitionPending(route.key);
    recordAdventurePaywallCompletion({ userId: data.profile.id, adventureId: adventure.id,
      hasPlus: data.hasPlus, ordinal: completionOrdinal });
    exit();
  };
  useEffect(() => { if (v2) { void resumeAdventureDelivery();
    // Restore completed journeys on entry only. In-session claims own their
    // immediate navigation; a background receipt must not tear down that page.
    if (focused && finishedOnEntry.current) { finishedOnEntry.current = false; exit(); }
  } }, [adventure.id, v2, focused]);
  async function claimTreasure() {
    if (v2) {
      // Everything visual is already frozen. Durable backend writes do not
      // gate the invitation/animation or the next local dialogue line.
      if (queueAdventureDelivery(adventure.id, { treasure: true, ...(!meta?.giftSnapshot ? { finish: true } : {}) }) === false) {
        setError('Your discovery couldn’t be saved on this device. Please try again.'); return;
      }
      if (meta?.giftSnapshot) setEncounter(true); else finish();
      return;
    }
    setBusy(true); setError(null);
    let nextConversation = false;
    const ok = await runBurrowAction(`claim:${adventure.id}`, async () => {
      const receipt = await claimAdventureResult(adventure.id);
      confirmBurrowAdventureItemLocally(adventure.id, receipt.itemId);
      nextConversation = !!receipt.interactionRequired;
      if (nextConversation) confirmBurrowAdventureInteractionLocally(adventure.id, v2);
      else confirmBurrowAdventureClaimLocally(adventure.id);
      return receipt;
    }, { silent: true });
    if (focusRef.current) {
      if (ok && nextConversation) setEncounter(true);
      else if (ok) finish();
      else setError('Your treasure is safe. Please try again.');
      setBusy(false);
    }
  }
  return <View style={s.root}>
    <AdventureStageTransition stageKey={encounter ? 'friend' : 'treasure'}>
    <View style={[s.root, encounter && s.friendRoot]}>
    <Image source={encounter ? BURROW_BACKGROUNDS.adventureFriends : BURROW_BACKGROUNDS.adventureFinish}
      contentFit="cover" contentPosition="center" style={StyleSheet.absoluteFillObject} pointerEvents="none"/>
    <View style={[s.page, !(encounter && v2) && { paddingTop: insets.top + (encounter ? 42 : 12), paddingBottom: encounter ? insets.bottom + 16 : Math.max(16, insets.bottom) }]}>
      {!encounter ? <AdventureTreasure title={title} item={item} coins={coins} hasFriend={hasFriend} busy={busy} onClaim={claimTreasure}/>
        : v2 ? <AdventureEncounterCard data={data} presentation={meeting} onComplete={finish}/>
        : <AdventureEncounterLayout friendName={meeting.friendName} heading={meeting.heading}>
          {finished ? <ScrollView bounces={false} contentContainerStyle={s.panel}><Text style={s.copy}>{finished}</Text><Pressable accessibilityRole="button" style={s.button} onPress={finish}><Text style={s.buttonText}>Back to Home</Text></Pressable></ScrollView>
            : !legacyInvited ? <ScrollView bounces={false} contentContainerStyle={s.panel}><Text style={s.invite}>Let’s be friends</Text><Text style={s.copy}>{meeting.introduction}</Text><Pressable accessibilityRole="button" style={s.button} onPress={() => setLegacyInvited(true)}><Text style={s.buttonText}>{meeting.talkLabel}</Text></Pressable></ScrollView>
            : <ScrollView bounces={false} contentContainerStyle={s.legacyDialogue}><AdventureFriendCard embedded data={data} busy={busy} onComplete={feedback => { confirmBurrowAdventureClaimLocally(adventure.id); setFinished(feedback); }}/></ScrollView>}
        </AdventureEncounterLayout>}
      {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {pending?.failed && <Pressable onPress={() => queueAdventureDelivery(adventure.id, {})}><Text style={s.error}>Your discovery is saved on this device. Tap to retry background saving.</Text></Pressable>}
    </View>
    <BurrowBackButton light onPress={() => router.back()} style={{ position: 'absolute', left: 16, top: insets.top + 8 }}/>
    </View>
    </AdventureStageTransition>
  </View>;
}
const s = StyleSheet.create({
  root:{flex:1,backgroundColor:'#B85B35'},friendRoot:{backgroundColor:'#63351D'},page:{flex:1},
  panel:{padding:20,gap:20,flexGrow:1,justifyContent:'space-evenly'},invite:{fontSize:29,fontWeight:'800',color:'#542B14',textAlign:'center'},copy:{fontSize:21,lineHeight:30,color:'#542B14',textAlign:'center'},
  button:{backgroundColor:'#C45637',padding:18,borderRadius:28},buttonText:{color:'#FFF',fontSize:20,fontWeight:'800',textAlign:'center'},legacyDialogue:{padding:20},error:{backgroundColor:'#FFF6E9',color:'#A13B24',padding:16,borderRadius:16,margin:16,fontSize:16},
});

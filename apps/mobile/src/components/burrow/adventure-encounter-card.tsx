import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { claimAdventureResult, completeFriendInteraction, type MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { confirmBurrowAdventureClaimLocally, confirmBurrowAdventureItemLocally, runBurrowAction } from '@/lib/burrow-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { queueAdventureDelivery, readAdventureDelivery } from '@/lib/adventure-delivery';
import { AdventureEncounterLayout } from './adventure-encounter-layout';
import { adventureFriendPresentation, type AdventureFriendPresentation } from '@/lib/adventure-friend-presentation';
import { AdventureStageTransition } from './adventure-stage-transition';
import { AdventureRewardScreen } from './adventure-reward-screen';
import { AdventureReveal } from './adventure-reveal';
import { FriendDialogue } from './friend-dialogue';

/** Live catalogue edits cannot alter a dialogue or gift already reserved by the server. */
export function AdventureEncounterCard({ data, onComplete, presentation }: {
  data: MajorUpdateBootstrap; onComplete: () => void; presentation?: AdventureFriendPresentation;
}) {
  const result = data.adventureResult!, meta = result.metadata!, adventure = data.activeAdventure!;
  const dialogue = meta.dialogue;
  const pendingChoice = readAdventureDelivery(adventure.id)?.choiceId;
  const savedChoice = dialogue?.choices.find(choice => choice.id === pendingChoice);
  const [meeting] = useState(() => presentation ?? adventureFriendPresentation(data));
  const [invited, setInvited] = useState(!meeting.isNewFriend || !!meta.dialogueCompleted || !!savedChoice);
  const { height } = useWindowDimensions(), insets = useSafeAreaInsets();
  const compact = height < 730;
  const [line, setLine] = useState(0), [reaction, setReaction] = useState<string[] | null>(meta.dialogueCompleted ? meta.reaction ?? [] : savedChoice?.reaction ?? null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const alive = useRef(true), lock = useRef(false), finishLock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (meta.dialogueCompleted && reaction === null) { setReaction(meta.reaction ?? []); setLine(0); } }, [meta.dialogueCompleted, meta.reaction, reaction]);
  const introduction = dialogue ? [dialogue.scene, ...dialogue.lines].filter((x): x is string => !!x) : [];
  const replies = [...(reaction ?? []), ...(dialogue?.outro ? [dialogue.outro] : [])];
  const lines = reaction === null ? introduction : replies;
  const choosing = !!dialogue && reaction === null && line >= introduction.length;
  const giftReady = !dialogue || (reaction !== null && line >= replies.length);
  const friendName = meeting.friendName;
  const gift = meta.giftSnapshot;
  async function answer(choiceId: string) {
    if (lock.current) return;
    if (meta.encounterV2) {
      const choice = dialogue?.choices.find(row => row.id === choiceId);
      if (!choice || reaction !== null) return;
      if (queueAdventureDelivery(adventure.id, { choiceId }) === false) { setError('Your reply couldn’t be saved. Please try again.'); return; }
      lock.current = true;
      setReaction(choice.reaction); setLine(0);
      return;
    }
    lock.current = true;
    setBusy(true); setError(null);
    const ok = await runBurrowAction(`encounter:${adventure.id}`, async () => {
      const response = await completeFriendInteraction(adventure.id, { choiceId });
      if (alive.current) {
        setReaction(Array.isArray(response.reaction) ? response.reaction as string[] : dialogue?.choices.find(x => x.id === choiceId)?.reaction ?? []);
        setLine(0);
      }
      return response;
    }, { silent: true });
    lock.current = false;
    if (alive.current) { if (!ok) setError('Your reply couldn’t be saved. Please try again.'); setBusy(false); }
  }
  async function claim() {
    if (finishLock.current || !alive.current) return;
    if (meta.encounterV2) {
      if (!giftReady || finishLock.current) return;
      if (queueAdventureDelivery(adventure.id, { finish: true }) === false) { setError('Your gift is safe. Try claiming again.'); return; }
      finishLock.current = true;
      onComplete();
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(null);
    const ok = await runBurrowAction(`claim:${adventure.id}`, async () => {
      const result = await claimAdventureResult(adventure.id);
      if (result.interactionRequired) throw Error('interaction_required');
      confirmBurrowAdventureItemLocally(adventure.id, result.itemId);
      confirmBurrowAdventureClaimLocally(adventure.id);
      return result;
    }, { silent: true });
    lock.current = false;
    if (ok && alive.current) { finishLock.current = true; onComplete(); }
    if (!ok && alive.current) { setError('Your gift is safe. Try claiming again.'); setBusy(false); }
  }
  if (giftReady) return <AdventureStageTransition stageKey="friend-gift">
    <AdventureRewardScreen variant="gift" title={gift?.title ?? 'You’ve collected every treasure on this trail.'} item={gift}
      friendName={friendName} busy={busy} error={error} onClaim={claim}/>
  </AdventureStageTransition>;
  return <View style={[s.root, { paddingTop: insets.top + 42, paddingBottom: insets.bottom + 16 }]}>
    <AdventureEncounterLayout friendName={friendName} heading={meeting.heading} answered={reaction !== null}>
      <AdventureStageTransition compact stageKey={!invited ? 'invite' : choosing ? 'choices'
        : `${reaction === null ? 'intro' : 'reply'}:${giftReady ? Math.max(0, lines.length-1) : line}`}>
      {!invited && dialogue ? <ScrollView bounces={false} style={s.scroll} contentContainerStyle={[s.invitation, compact && s.compact]}>
        <AdventureReveal><Text style={s.inviteHeading}>Let’s be friend</Text></AdventureReveal>
        <AdventureReveal delay={180}><Text style={[s.copy, s.center]}>{meeting.introduction}</Text></AdventureReveal>
        <AdventureReveal delay={300} style={{width:"100%",alignItems:"center"}}><Pressable accessibilityRole="button" onPress={() => setInvited(true)} style={s.talk}><Text style={s.talkText}>{meeting.talkLabel}</Text></Pressable></AdventureReveal>
      </ScrollView> : choosing ? <ScrollView bounces={false} style={s.scroll} contentContainerStyle={[s.choices, compact && s.compact]}>
        <AdventureReveal><Text style={s.copy}>{introduction.at(-1)?.endsWith('?') ? introduction.at(-1) : 'What would you say?'}</Text></AdventureReveal>
        {dialogue!.choices.map((choice, index) => <AdventureReveal key={choice.id} delay={180 + index * 50}><Pressable accessibilityRole="button" key={choice.id} disabled={busy}
          accessibilityState={{ disabled: busy }} onPress={() => void answer(choice.id)}
          style={({ pressed }) => [s.choice, pressed && s.pressed, busy && { opacity: .6 }]}><Text style={s.choiceText}>{choice.label}</Text></Pressable></AdventureReveal>)}
        {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      </ScrollView> : <FriendDialogue key={`${reaction === null ? 'intro' : 'reply'}:${line}`} disabled={busy || giftReady}
        onPress={() => setLine(x => x + 1)}>{giftReady ? lines.at(-1) ?? 'Your bunny brought a little discovery home.' : lines[line]}</FriendDialogue>}
      </AdventureStageTransition>
    </AdventureEncounterLayout>
  </View>;
}
const s = StyleSheet.create({
  root:{flex:1},scroll:{flex:1},
  invitation:{padding:20,gap:20,flexGrow:1,justifyContent:'space-evenly',alignItems:'center'},
  choices:{padding:20,gap:10,flexGrow:1,justifyContent:'center'},compact:{padding:16,gap:12},inviteHeading:{fontSize:29,lineHeight:36,fontWeight:'800',color:'#542B14',textAlign:'center'},
  copy:{fontSize:22,lineHeight:31,fontWeight:'700',color:'#4F2C19',width:'80%',alignSelf:'center',textAlign:'left'},center:{textAlign:'center'},
  choice:{paddingHorizontal:14,paddingVertical:10,minHeight:48,justifyContent:'center',borderRadius:17,borderWidth:1.5,borderColor:'#C8663A',backgroundColor:'#F8E6D9'},choiceText:{color:'#1E1712',fontWeight:'700',fontSize:19,lineHeight:25,textAlign:'center'},
  talk:{padding:16,minHeight:52,borderRadius:28,backgroundColor:'#C45637',borderBottomWidth:4,borderBottomColor:'#D99B66',width:'85%'},talkText:{fontSize:20,fontWeight:'800',color:'#FFF',textAlign:'center'},
  error:{color:'#A13B24',fontSize:15},pressed:{transform:[{translateY:3}],opacity:.85},
});

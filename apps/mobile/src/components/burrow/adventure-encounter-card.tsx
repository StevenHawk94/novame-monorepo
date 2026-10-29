import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { claimAdventureResult, completeFriendInteraction, type MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { confirmBurrowAdventureClaimLocally, confirmBurrowAdventureItemLocally, runBurrowAction } from '@/lib/burrow-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { queueAdventureDelivery, readAdventureDelivery } from '@/lib/adventure-delivery';
import { AdventureEncounterLayout } from './adventure-encounter-layout';
import { adventureFriendPresentation, type AdventureFriendPresentation } from '@/lib/adventure-friend-presentation';
import { AdventureStageTransition } from './adventure-stage-transition';
import { AdventureRewardScreen } from './adventure-reward-screen';
import { FriendDialogue } from './friend-dialogue';
import {FriendTextPanel} from './friend-text-panel';
import type {FriendTextPage} from '@/lib/friend-text-layout';

/** Live catalogue edits cannot alter a dialogue or gift already reserved by the server. */
export function AdventureEncounterCard({ data, onComplete, presentation }: {
  data: MajorUpdateBootstrap; onComplete: () => void; presentation?: AdventureFriendPresentation;
}) {
  const result = data.adventureResult!, meta = result.metadata!, adventure = data.activeAdventure!;
  const dialogue = meta.dialogue;
  const pendingChoice = readAdventureDelivery(adventure.id)?.choiceId;
  const savedChoice = dialogue?.choices.find(choice => choice.id === pendingChoice);
  const checkpoint=readAdventureDelivery(adventure.id)?.checkpoint;
  const [meeting] = useState(() => presentation ?? adventureFriendPresentation(data));
  const [invited, setInvited] = useState(!!checkpoint?.invited||!meeting.isNewFriend || !!meta.dialogueCompleted || !!savedChoice);
  const insets = useSafeAreaInsets();
  const replying=!!meta.dialogueCompleted||!!savedChoice;
  const restoredLine=checkpoint&&Number.isSafeInteger(checkpoint.line)&&checkpoint.line>=0
    &&(checkpoint.stage!=='intro')===replying?checkpoint.line:0;
  const [line, setLine] = useState(restoredLine), [reaction, setReaction] = useState<string[] | null>(meta.dialogueCompleted ? meta.reaction ?? [] : savedChoice?.reaction ?? null);
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
  const invitePage={title:'Let’s be friends',body:meeting.introduction,action:meeting.talkLabel};
  const choicePage={body:introduction.at(-1)?.endsWith('?')?introduction.at(-1):'What would you say?',options:dialogue?.choices.map(c=>c.label)};
  const allPages:FriendTextPage[]=[invitePage,choicePage,...introduction.map(body=>({body,hint:true})),
    ...(dialogue?.choices.flatMap(c=>c.reaction.map(body=>({body,hint:true})))??[]),...replies.map(body=>({body,hint:true})),...(dialogue?.outro?[{body:dialogue.outro,hint:true}]:[])];
  const pages=[...new Map(allPages.map(page=>[JSON.stringify(page),page])).values()];
  async function answer(choiceId: string) {
    if (lock.current) return;
    if (meta.encounterV2) {
      const choice = dialogue?.choices.find(row => row.id === choiceId);
      if (!choice || reaction !== null) return;
      if (queueAdventureDelivery(adventure.id, { choiceId,checkpoint:{stage:'reply',line:0,invited:true} }) === false) { setError('Your reply couldn’t be saved. Please try again.'); return; }
      lock.current = true;
      setError(null);
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
  function advance(invitation=false){
    const next=invitation?line:line+1,stage=reaction===null?'intro':next>=replies.length?'gift':'reply';
    if(meta.encounterV2&&queueAdventureDelivery(adventure.id,{checkpoint:{stage,line:next,invited:true}})===false){setError('Your place couldn’t be saved. Please try again.');return;}
    setError(null);if(invitation)setInvited(true);else setLine(next);
  }
  if (giftReady) return <AdventureStageTransition stageKey="friend-gift">
    <AdventureRewardScreen variant="gift" title={gift?.title ?? 'You’ve collected every treasure on this trail.'} item={gift}
      friendName={friendName} busy={busy} error={error} onClaim={claim}/>
  </AdventureStageTransition>;
  return <View style={[s.root, { paddingTop: insets.top + 42, paddingBottom: insets.bottom + 16 }]}>
    <AdventureEncounterLayout friendName={friendName} heading={meeting.heading} answered={reaction !== null} pages={pages}>
      <AdventureStageTransition compact stageKey={!invited ? 'invite' : choosing ? 'choices'
        : `${reaction === null ? 'intro' : 'reply'}:${giftReady ? Math.max(0, lines.length-1) : line}`}>
      {!invited && dialogue ? <FriendTextPanel page={{...invitePage,welcome:'adventure'}} error={error} onAction={()=>advance(true)}/>
        : choosing ? <FriendTextPanel page={choicePage} disabled={busy} error={error} onChoice={index=>void answer(dialogue!.choices[index].id)}/>
        : <FriendDialogue key={`${reaction === null ? 'intro' : 'reply'}:${line}`} disabled={busy || giftReady} error={error}
        onPress={() => advance()}>{giftReady ? lines.at(-1) ?? 'Your bunny brought a little discovery home.' : lines[line]}</FriendDialogue>}
      </AdventureStageTransition>
    </AdventureEncounterLayout>
  </View>;
}
const s = StyleSheet.create({
  root:{flex:1},
});

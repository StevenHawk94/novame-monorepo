import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { Image } from './burrow-image';
import type { MajorUpdateBootstrap, MajorUpdateQuest } from '@/lib/app-major-update-api';
import { BURROW_QUEST_BANNER, BURROW_QUEST_ICONS } from '@/lib/burrow-ui-assets';
import { setNextCoinRewardOrigin, type CoinRewardPoint } from '@/lib/coin-reward-store';
import { QuestClaimConfetti } from './quest-claim-confetti';
import { QuestProgress } from './quest-progress';
import { QuestAction } from './quest-action';

const dailyOrder = ['write_adventure_record', 'send_affection', 'play_game', 'water_partner_flower', 'feed_partner_bunny', 'interact_with_toy'] as const;
type DailyId = typeof dailyOrder[number];
const dailyCopy: Record<DailyId, string> = {
  write_adventure_record: 'Finish today’s adventure record',
  send_affection: 'Send your person affection',
  play_game: 'Play a game with your person',
  water_partner_flower: "Water your flower.",
  feed_partner_bunny: 'Feed your bunny',
  interact_with_toy: 'Play with your plushie',
};
const specialCopy: Record<string, { title: string; subtitle: string }> = {
  adventures_completed: { title: "Adventures Completed.", subtitle: 'Keep exploring and make more memories' },
  items_collected: { title: 'Collect Items', subtitle: 'Treasures found or added to your burrow' },
  friends_met: { title: 'Meet New Friends', subtitle: 'Say hello to friends along the trail' },
  games_played: { title: 'Games Played', subtitle: 'Discover how well you know each other' },
};
const specialOrder = ['items_collected', 'adventures_completed', 'friends_met', 'games_played'];

/** Full-width artwork scrolls together with the quest list. */
export function QuestBanner() {
  return <Image source={BURROW_QUEST_BANNER} contentFit="contain" accessibilityLabel="Finish quests and earn coins" style={styles.banner}/>;
}

export function QuestBoard({ data, busy, onGo, onClaim, onSpecialClaim }: {
  data: MajorUpdateBootstrap;
  busy: boolean;
  onGo: (id: DailyId) => void;
  onClaim: (quest: MajorUpdateQuest) => Promise<number>;
  onSpecialClaim: (questId: string, stage: number) => Promise<number>;
}) {
  const [localClaims,setLocalClaims]=useState<Set<string>>(()=>new Set());
  const [claimError, setClaimError] = useState<string | null>(null);
  const claiming = useRef(new Set<string>());
  const activeScope = useRef('');
  const burstSequence = useRef(0);
  const [bursts, setBursts] = useState<{ scope: string; keys: Record<string, number> }>({ scope: '', keys: {} });
  const scope = `${data.profile.id}:${data.localDate}:${data.pairVersion ?? ''}`;
  activeScope.current = scope;
  useEffect(() => { claiming.current.clear(); setLocalClaims(new Set()); setClaimError(null); setBursts({ scope, keys: {} }); }, [scope]);
  useEffect(() => {
    setLocalClaims(previous => {
      const next=new Set([...previous].filter(key=>!data.quests.quests.some(q=>q.assignmentId===key&&q.claimedAt)
        &&!data.specialQuests.some(q=>key.startsWith(`${q.questId}:`)&&Number(key.split(':').at(-1))<q.stage)));
      return next.size===previous.size?previous:next;
    });
  },[data.quests,data.specialQuests]);
  useEffect(() => { if (!claimError) return; const timer = setTimeout(() => setClaimError(null), 2000); return () => clearTimeout(timer); }, [claimError]);
  const claim=(key:string,request:()=>Promise<number>,origin?:CoinRewardPoint,burstKey=key)=>{
    if(localClaims.has(key) || claiming.current.has(key))return;
    claiming.current.add(key);
    const owner = scope;
    // Daily cards settle immediately; special cards show the next milestone
    // while the server confirms the credit. A rejection rolls either back.
    // Claimed/stage state lives in the shared durable projection, not this
    // mounted page. Rejection/relaunch/tab switches must show the same state.
    setLocalClaims(previous=>new Set(previous).add(key));
    const burstId = ++burstSequence.current;
    setBursts(previous => ({ scope: owner, keys: { ...(previous.scope === owner ? previous.keys : {}), [burstKey]: burstId } }));
    if(origin)setNextCoinRewardOrigin(origin);
    void request().catch(()=>{
      if (activeScope.current !== owner) return;
      setClaimError('Couldn’t claim the reward. Tap Claim to retry.');
      setLocalClaims(previous=>{const next=new Set(previous);next.delete(key);return next;});
      setBursts(previous => {
        if (previous.scope !== owner || previous.keys[burstKey] !== burstId) return previous;
        const keys = { ...previous.keys }; delete keys[burstKey]; return { scope: owner, keys };
      });
    }).finally(() => { if (activeScope.current === owner) {
      claiming.current.delete(key);
      // A very fast rejection may be batched before React ever renders the
      // projected claimed state. Never leave this transient tap guard stuck.
      setLocalClaims(previous=>{if(!previous.has(key))return previous;const next=new Set(previous);next.delete(key);return next;});
    } });
  };
  const confetti = (key: string) => {
    const id = bursts.scope === scope ? bursts.keys[key] : undefined;
    return id === undefined ? null : <QuestClaimConfetti key={id} onComplete={() => setBursts(previous => {
      // An older run cannot remove a retry, another task, or another account.
      if (previous.scope !== scope || previous.keys[key] !== id) return previous;
      const keys = { ...previous.keys }; delete keys[key]; return { scope, keys };
    })} />;
  };
  // An older API snapshot can be empty on the first visit. Keep the complete
  // board visible while its real assignments are being created/refreshed.
  const assigned = data.quests.quests;
  const rotation = dailyOrder.slice(2)[Math.abs(Math.floor(Date.parse(`${data.localDate}T12:00:00Z`) / 86_400_000)) % 4];
  const shown = assigned.length ? assigned : [dailyOrder[0], dailyOrder[1], rotation].map(questId => ({
    assignmentId: `pending:${questId}`, questId, target: 1, progress: 0, completedAt: null, claimedAt: null,
  }));
  const specials = specialOrder.map(id => data.specialQuests.find(q => q.questId === id) ?? {
    questId: id, stage: 1, target: id === 'friends_met' ? 2 : id === 'items_collected' ? 10 : 5,
    progress: id === 'items_collected' ? data.inventory.filter(item => item.source !== 'starter').length
      : id === 'friends_met' ? data.discoveries.filter(friend => friend.interaction_completed_at).length : 0,
    reward: 15,
  });
  return <View style={styles.board}>
    <QuestBanner/>
    <View style={styles.questContent}>
    <Text accessibilityRole="header" style={styles.heading}>Daily Quests</Text>
    <View style={styles.list}>{shown.map(quest => {
      const id = quest.questId as DailyId;
      const done = !!quest.completedAt || quest.progress >= quest.target;
      const claimed = !!quest.claimedAt || localClaims.has(quest.assignmentId);
      const pending = quest.assignmentId.startsWith('pending:');
      return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`${dailyCopy[id] ?? id}, ${claimed ? 'reward collected' : done ? 'collect reward' : 'open'}`}
        disabled={claimed} onPress={event => done && !pending ? claim(quest.assignmentId,()=>onClaim(quest),event?.nativeEvent?{x:event.nativeEvent.pageX,y:event.nativeEvent.pageY}:undefined) : onGo(id)}
        style={({ pressed }) => [styles.dailyCard, claimed && styles.doneCard, pressed && styles.pressed]}>
        {({pressed})=><><Image source={BURROW_QUEST_ICONS[id]} contentFit="contain" style={styles.dailyIcon} />
        <Text numberOfLines={2} style={[styles.dailyTitle, claimed && styles.claimedTitle]}>{dailyCopy[id] ?? id}</Text>
        {!claimed&&<QuestAction ready={done&&!pending} arrow={!done||pending} pressed={pressed}/>}
        {confetti(quest.assignmentId)}
        </>}
      </Pressable>;
    })}</View>
    <Text accessibilityRole="header" style={[styles.heading, styles.specialHeading]}>Special Quests</Text>
    <View style={styles.list}>{specials.map(current => {
      const localClaimed=localClaims.has(`${current.questId}:${current.stage}`);
      // Targets are cumulative, one equal-sized step per stage. Keep earned
      // progress and raise the goal immediately, so the bar falls back without
      // treating this repeatable quest as a crossed-out completed daily card.
      const quest=localClaimed?{...current,stage:current.stage+1,
        target:current.target+current.target/Math.max(1,current.stage)}:current;
      const complete = quest.progress >= quest.target;
      const claimable = !localClaimed && complete && data.specialQuests.some(item => item.questId === quest.questId);
      const copy = specialCopy[quest.questId] ?? { title: quest.questId, subtitle: 'Keep going' };
      return <Pressable key={quest.questId} accessibilityRole="button" accessibilityLabel={`${copy.title}, ${quest.progress} of ${quest.target}, ${localClaimed ? 'updating reward' : claimable ? 'collect reward' : 'reward not ready'}`}
        accessibilityState={{disabled:!claimable}} disabled={!claimable} onPress={event => {
          if(!claimable)return;
          claim(`${quest.questId}:${quest.stage}`,()=>onSpecialClaim(quest.questId, quest.stage),event?.nativeEvent?{x:event.nativeEvent.pageX,y:event.nativeEvent.pageY}:undefined,`special:${quest.questId}`);
        }}
        style={({ pressed }) => [styles.specialCard, pressed && styles.pressed]}>
        {({pressed})=><><Image source={BURROW_QUEST_ICONS[quest.questId as keyof typeof BURROW_QUEST_ICONS]} contentFit="contain" style={styles.specialIcon} />
        <View style={styles.specialText}>
          <Text style={styles.specialTitle}>{copy.title}</Text>
          <Text numberOfLines={2} style={styles.subtitle}>{copy.subtitle}</Text>
          <QuestProgress key={`${scope}:${quest.questId}`} progress={quest.progress} target={quest.target}/>
          <Text style={styles.progress}>{Math.min(quest.progress, quest.target)}/{quest.target}</Text>
        </View>
        <View style={styles.specialRewardSlot}><QuestAction ready={claimable} pressed={pressed} disabled={!claimable}/></View>
        {confetti(`special:${quest.questId}`)}
        </>}
      </Pressable>;
    })}</View>
    {claimError && <Text accessibilityRole="alert" style={{ color: '#FFF8EC', textAlign: 'center' }}>{claimError}</Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  board: { backgroundColor: '#6a321c', paddingBottom: 30 },
  banner: { width: '100%', aspectRatio: 9 / 6, flexShrink: 0 },
  questContent: { paddingHorizontal: 18, paddingTop: 16, gap: 13 },
  heading: { color: '#FFF8EC', fontSize: 24, fontWeight: '800', marginLeft: 5, marginBottom: 3 },
  specialHeading: { marginTop: 20 },
  list: { gap: 12 },
  dailyCard: { minHeight: 78, borderRadius: 21, backgroundColor: '#FFFDF8', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, paddingVertical: 12, shadowColor: '#231008', shadowOffset: { width: 0, height: 5 }, shadowOpacity: .38, shadowRadius: 0, elevation: 4 },
  doneCard: { backgroundColor: '#C9B2A2' },
  dailyIcon: { width: 55, height: 55 },
  dailyTitle: { flex: 1, color: '#24150D', fontSize: 16, fontWeight: '700', lineHeight: 21 },
  claimedTitle: { textDecorationLine: 'line-through', color: '#FFF9EF' },
  specialCard: { minHeight: 106, borderRadius: 22, backgroundColor: '#FFFDF8', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 12, shadowColor: '#231008', shadowOffset: { width: 0, height: 5 }, shadowOpacity: .4, shadowRadius: 0, elevation: 4 },
  specialIcon: { width: 58, height: 58 },
  specialText: { flex: 1, gap: 2 },
  specialRewardSlot: { width: 76, alignItems: 'center', justifyContent: 'center' },
  specialTitle: { color: '#1F120C', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#493629', fontSize: 12, lineHeight: 16 },
  progress: { color: '#24150D', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: .8 },
});

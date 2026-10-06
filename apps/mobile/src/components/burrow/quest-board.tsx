import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from './burrow-image';
import type { MajorUpdateBootstrap, MajorUpdateQuest } from '@/lib/app-major-update-api';
import { BURROW_QUEST_ICONS } from '@/lib/burrow-ui-assets';
import { QuestClaimBurst } from './care-quest-celebration';

const dailyOrder = ['write_adventure_record', 'send_affection', 'play_game', 'water_partner_flower', 'feed_partner_bunny', 'interact_with_toy'] as const;
type DailyId = typeof dailyOrder[number];
const dailyCopy: Record<DailyId, string> = {
  write_adventure_record: 'Finish today’s adventure record',
  send_affection: 'Send your person affection',
  play_game: 'Play a game with your person',
  water_partner_flower: 'Water your flowers',
  feed_partner_bunny: 'Feed your bunny',
  interact_with_toy: 'Play with your toy',
};
const specialCopy: Record<string, { title: string; subtitle: string }> = {
  adventures_completed: { title: 'Adventure Finished', subtitle: 'Keep exploring and make more memories' },
  items_collected: { title: 'Collect Items', subtitle: 'Treasures found or added to your burrow' },
  friends_met: { title: 'Meet New Friends', subtitle: 'Say hello to friends along the trail' },
  games_played: { title: 'Games Played', subtitle: 'Discover how well you know each other' },
};
const specialOrder = ['items_collected', 'adventures_completed', 'friends_met', 'games_played'];

export function QuestBoard({ data, busy, onGo, onClaim, onSpecialClaim, onSpecialGo }: {
  data: MajorUpdateBootstrap;
  busy: boolean;
  onGo: (id: DailyId) => void;
  onClaim: (quest: MajorUpdateQuest) => Promise<number>;
  onSpecialClaim: (questId: string, stage: number) => Promise<number>;
  onSpecialGo: (questId: string) => void;
}) {
  const [localClaims,setLocalClaims]=useState<Set<string>>(()=>new Set());
  const [celebration,setCelebration]=useState<number|null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const claiming = useRef(new Set<string>());
  const activeScope = useRef('');
  const scope = `${data.profile.id}:${data.localDate}:${data.pairVersion ?? ''}`;
  activeScope.current = scope;
  useEffect(() => { claiming.current.clear(); setLocalClaims(new Set()); setCelebration(null); setClaimError(null); }, [scope]);
  useEffect(() => { if (!claimError) return; const timer = setTimeout(() => setClaimError(null), 2000); return () => clearTimeout(timer); }, [claimError]);
  const claim=(key:string,expectedReward:number,request:()=>Promise<number>)=>{
    if(localClaims.has(key) || claiming.current.has(key))return;
    claiming.current.add(key);
    const owner = scope;
    // Claim is optimistic: the card settles on this frame, while the server
    // confirms the actual credit in the background. A rejection rolls it back.
    setLocalClaims(previous=>new Set(previous).add(key));
    setCelebration(expectedReward);
    void request().then(reward=>{
      if (activeScope.current !== owner) return;
      // Zero can be a replay of an already credited claim, not a rejection.
      if (reward > 0 && reward !== expectedReward) setCelebration(reward);
    }).catch(()=>{
      if (activeScope.current !== owner) return;
      setCelebration(null); setClaimError('Couldn’t claim the reward. Tap Claim to retry.');
      setLocalClaims(previous=>{const next=new Set(previous);next.delete(key);return next;});
    }).finally(() => { if (activeScope.current === owner) claiming.current.delete(key); });
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
    <Text accessibilityRole="header" style={styles.heading}>Daily Quests</Text>
    <View style={styles.list}>{shown.map(quest => {
      const id = quest.questId as DailyId;
      const done = !!quest.completedAt || quest.progress >= quest.target;
      const claimed = !!quest.claimedAt || localClaims.has(quest.assignmentId);
      const pending = quest.assignmentId.startsWith('pending:');
      return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`${dailyCopy[id] ?? id}, ${claimed ? 'reward collected' : done ? 'collect reward' : 'open'}`}
        disabled={busy || claimed} onPress={() => done && !pending ? claim(quest.assignmentId,10,()=>onClaim(quest)) : onGo(id)}
        style={({ pressed }) => [styles.dailyCard, done && styles.doneCard, pressed && styles.pressed]}>
        <Image source={BURROW_QUEST_ICONS[id]} contentFit="contain" style={styles.dailyIcon} />
        <Text numberOfLines={2} style={[styles.dailyTitle, (done || claimed) && styles.claimedTitle]}>{dailyCopy[id] ?? id}</Text>
        {!claimed&&(done&&!pending?<View style={styles.claimButton}><Text style={styles.claimText}>Claim</Text></View>
          :<View style={styles.status}><Text style={styles.statusText}>➜</Text></View>)}
      </Pressable>;
    })}</View>
    <Text accessibilityRole="header" style={[styles.heading, styles.specialHeading]}>Special Quests</Text>
    <View style={styles.list}>{specials.map(quest => {
      const complete = quest.progress >= quest.target;
      const claimable = complete && data.specialQuests.some(item => item.questId === quest.questId);
      const localClaimed=localClaims.has(`${quest.questId}:${quest.stage}`);
      const copy = specialCopy[quest.questId] ?? { title: quest.questId, subtitle: 'Keep going' };
      return <Pressable key={quest.questId} accessibilityRole="button" accessibilityLabel={`${copy.title}, ${quest.progress} of ${quest.target}, ${complete ? 'collect reward' : 'open'}`}
        disabled={busy||localClaimed} onPress={() => claimable
          ? claim(`${quest.questId}:${quest.stage}`,quest.reward,()=>onSpecialClaim(quest.questId, quest.stage)) : onSpecialGo(quest.questId)}
        style={({ pressed }) => [styles.specialCard, pressed && styles.pressed]}>
        <Image source={BURROW_QUEST_ICONS[quest.questId as keyof typeof BURROW_QUEST_ICONS]} contentFit="contain" style={styles.specialIcon} />
        <View style={styles.specialText}>
          <Text style={styles.specialTitle}>{copy.title}</Text>
          <Text numberOfLines={2} style={styles.subtitle}>{copy.subtitle}</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, Math.max(0, quest.progress / Math.max(1, quest.target) * 100))}%` }]} /></View>
          <Text style={styles.progress}>{Math.min(quest.progress, quest.target)}/{quest.target}</Text>
        </View>
        {!localClaimed&&(claimable?<View style={styles.claimButton}><Text style={styles.claimText}>Claim</Text></View>
          :<View style={styles.status}><Text style={styles.statusText}>➜</Text></View>)}
      </Pressable>;
    })}</View>
    {celebration!=null&&<QuestClaimBurst reward={celebration} onClose={()=>setCelebration(null)}/>}
    {claimError && <Text accessibilityRole="alert" style={{ color: '#FFF8EC', textAlign: 'center' }}>{claimError}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  board: { gap: 13, paddingTop: 10, paddingBottom: 30 },
  heading: { color: '#FFF8EC', fontSize: 27, fontWeight: '800', marginBottom: 3 },
  specialHeading: { marginTop: 20 },
  list: { gap: 12 },
  dailyCard: { minHeight: 78, borderRadius: 21, backgroundColor: '#FFFDF8', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, paddingVertical: 12, shadowColor: '#231008', shadowOffset: { width: 0, height: 5 }, shadowOpacity: .38, shadowRadius: 0, elevation: 4 },
  doneCard: { backgroundColor: '#C9B2A2' },
  dailyIcon: { width: 55, height: 55 },
  dailyTitle: { flex: 1, color: '#24150D', fontSize: 16, fontWeight: '700', lineHeight: 21 },
  claimedTitle: { textDecorationLine: 'line-through', color: '#FFF9EF' },
  status: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#8B8A86', alignItems: 'center', justifyContent: 'center' },
  claimButton: { minWidth: 70, height: 38, paddingHorizontal: 10, borderRadius: 19, backgroundColor: '#31A36C', alignItems: 'center', justifyContent: 'center' },
  claimText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  statusText: { color: '#FFF', fontSize: 28, lineHeight: 32, fontWeight: '800' },
  specialCard: { minHeight: 106, borderRadius: 22, backgroundColor: '#FFFDF8', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 12, shadowColor: '#231008', shadowOffset: { width: 0, height: 5 }, shadowOpacity: .4, shadowRadius: 0, elevation: 4 },
  specialIcon: { width: 58, height: 58 },
  specialText: { flex: 1, gap: 2 },
  specialTitle: { color: '#1F120C', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#493629', fontSize: 12, lineHeight: 16 },
  track: { marginTop: 5, height: 7, borderRadius: 4, backgroundColor: '#E8E5DC', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#CF744C' },
  progress: { color: '#24150D', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: .8 },
});

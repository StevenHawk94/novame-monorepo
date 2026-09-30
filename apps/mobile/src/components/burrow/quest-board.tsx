import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MajorUpdateBootstrap, MajorUpdateQuest } from '@/lib/app-major-update-api';
import { BURROW_QUEST_ICONS } from '@/lib/burrow-ui-assets';

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
  onClaim: (quest: MajorUpdateQuest) => void;
  onSpecialClaim: (questId: string, stage: number) => void;
  onSpecialGo: (questId: string) => void;
}) {
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
      const claimed = !!quest.claimedAt;
      const pending = quest.assignmentId.startsWith('pending:');
      return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`${dailyCopy[id] ?? id}, ${claimed ? 'reward collected' : done ? 'collect reward' : 'open'}`}
        disabled={busy || claimed} onPress={() => done && !pending ? onClaim(quest) : onGo(id)}
        style={({ pressed }) => [styles.dailyCard, done && styles.doneCard, pressed && styles.pressed]}>
        <Image source={BURROW_QUEST_ICONS[id]} contentFit="contain" style={styles.dailyIcon} />
        <Text numberOfLines={2} style={[styles.dailyTitle, claimed && styles.claimedTitle]}>{dailyCopy[id] ?? id}</Text>
        <View style={[styles.status, done && styles.statusDone]}><Text style={styles.statusText}>{claimed ? '✓' : done ? '★' : '➜'}</Text></View>
      </Pressable>;
    })}</View>
    <Text accessibilityRole="header" style={[styles.heading, styles.specialHeading]}>Special Quests</Text>
    <View style={styles.list}>{specials.map(quest => {
      const complete = quest.progress >= quest.target;
      const copy = specialCopy[quest.questId] ?? { title: quest.questId, subtitle: 'Keep going' };
      return <Pressable key={quest.questId} accessibilityRole="button" accessibilityLabel={`${copy.title}, ${quest.progress} of ${quest.target}, ${complete ? 'collect reward' : 'open'}`}
        disabled={busy} onPress={() => complete && data.specialQuests.some(q => q.questId === quest.questId)
          ? onSpecialClaim(quest.questId, quest.stage) : onSpecialGo(quest.questId)}
        style={({ pressed }) => [styles.specialCard, pressed && styles.pressed]}>
        <Image source={BURROW_QUEST_ICONS[quest.questId as keyof typeof BURROW_QUEST_ICONS]} contentFit="contain" style={styles.specialIcon} />
        <View style={styles.specialText}>
          <Text style={styles.specialTitle}>{copy.title}</Text>
          <Text numberOfLines={2} style={styles.subtitle}>{copy.subtitle}</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, Math.max(0, quest.progress / Math.max(1, quest.target) * 100))}%` }]} /></View>
          <Text style={styles.progress}>{Math.min(quest.progress, quest.target)}/{quest.target}</Text>
        </View>
        <View style={[styles.status, complete && styles.statusDone]}><Text style={styles.statusText}>{complete ? '★' : '➜'}</Text></View>
      </Pressable>;
    })}</View>
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
  statusDone: { backgroundColor: '#60A871' },
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

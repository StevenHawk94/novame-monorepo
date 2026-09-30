import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { respondFriendVisit, type MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { runBurrowAction } from '@/lib/burrow-store';
import { burrowFriendArt } from '@/lib/burrow-ui-assets';

/** The server snapshots dialogue and owns completion/gifting. Reopening this
 * card after a lost response or a restart cannot reroll or double-claim it. */
export function FriendVisitCard({ data, busy, showArt = true }: { data: MajorUpdateBootstrap; busy: boolean; showArt?: boolean }) {
  const [openedVisit,setOpenedVisit]=useState<string|null>(null);
  const visit = data.friendVisit;
  const friend = data.friends.find(item => item.stable_id === visit?.friend_id);
  const goToBattle = () => {
    if (!visit?.content_snapshot.rage_monster_id) return;
    router.push({ pathname: '/(main)/tame-enemy', params: {
      monsterId: visit.content_snapshot.rage_monster_id, friendVisitId: visit.id,
    } } as Href);
  };
  const respond = (response: { choiceId?: string; acknowledged?: boolean }) => {
    if (!visit) return;
    let battleRequired = false;
    void runBurrowAction(`visit:${visit.id}`, async () => {
      const result = await respondFriendVisit(visit.id, response);
      battleRequired = !!result.battleRequired;
    }).then(ok => { if (ok && battleRequired) goToBattle(); });
  };
  const button = (label: string, onPress: () => void, secondary = false) => <Pressable
    key={label} accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
    onPress={onPress} style={[styles.button, secondary && styles.secondary, busy && { opacity: .5 }]}>
    <Text style={[styles.buttonText, secondary && { color: '#67422D' }]}>{label}</Text>
  </Pressable>;
  if (!visit) return <View style={[styles.card, styles.emptyCard]}>
    <View style={styles.emptySymbol}><Text style={styles.emptySymbolText}>♧</Text></View>
    <Text style={[styles.heading, styles.emptyHeading]}>No visitors right now</Text>
    <Text style={[styles.copy, styles.emptyCopy]}>The room is quiet for now. We’ll let you know when a friend stops by.</Text>
    {button('Back to Burrow', () => router.back())}
  </View>;
  if (!visit.completed_at && !visit.declined_at && openedVisit !== visit.id) return <View style={[styles.card,styles.emptyCard]}>
    <Text style={styles.visitorBadge}>VISITOR</Text>
    <Text style={[styles.heading,styles.emptyHeading]}>{friend?.name ?? 'A friend'} is here</Text>
    <Text style={[styles.copy,styles.emptyCopy]}>They have a little story to share.</Text>
    {button(`Talk to ${friend?.name ?? 'your visitor'} →`,()=>setOpenedVisit(visit.id))}
  </View>;
  const content = visit.content_snapshot;
  const feedback = content.feedback[visit.response?.choiceId ?? ''];
  const gift = data.catalog.find(item => item.stable_id === visit.reward_item_id);
  return <View style={styles.card}>
    {showArt&&burrowFriendArt(friend?.name)&&<Image source={burrowFriendArt(friend?.name)} contentFit="contain" style={{width:180,height:180,alignSelf:'center'}}/>}
    <Text style={styles.heading}>{friend?.name ?? 'A friend'} stopped by</Text>
    <Text style={styles.copy}>{content.prompt}</Text>
    {visit.declined_at ? <Text style={styles.copy}>“Another time is okay. I’m glad we had a moment together.”</Text>
      : visit.completed_at ? <>
        {!!feedback && <Text style={styles.feedback}>{feedback}</Text>}
        <Text style={styles.copy}>{gift
          ? `${visit.reward_recipient_id === data.profile.id ? 'You received' : 'Your partner received'} ${gift.title}. It’s in the collection.`
          : 'Every available gift is already collected. Thank you for spending a little time together.'}</Text>
      </> : content.content_type === 'insight' ? button('A little thought to keep · Collect gift', () => respond({ acknowledged: true }))
      : content.content_type === 'question' ? content.choices.map(choice => button(choice.label, () => respond({ choiceId: choice.id })))
      : <>
        <Text style={styles.note}>Help with the matching Rage Room battle, then return here for your friend’s gift. Either of you can help. Daily battle limits still apply.</Text>
        {visit.accepted_at ? <>
          {button('Continue helping in the Rage Room', goToBattle)}
          {button('I’ve finished · Collect gift', () => respond({ choiceId: 'yes' }))}
        </> : button('Yes, let’s help', () => respond({ choiceId: 'yes' }))}
        {button('Not now', () => Alert.alert('Let this visit end?', 'There is no penalty. Your friend won’t leave a gift this time.', [
          { text: 'Keep visit', style: 'cancel' }, { text: 'Not now', onPress: () => respond({ choiceId: 'not_now' }) },
        ]), true)}
      </>}
    <Text style={styles.note}>One shared visit a day · {data.friendVisitTimezone}</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFF2DD', borderRadius: 28, padding: 24, gap: 15 },
  emptyCard:{alignItems:'center',paddingVertical:32,gap:17},
  emptySymbol:{width:86,height:86,borderRadius:43,alignItems:'center',justifyContent:'center',backgroundColor:'#FAE9D2'},
  emptySymbolText:{fontSize:55,color:'#88573C'},
  emptyHeading:{fontSize:25,textAlign:'center'},
  emptyCopy:{textAlign:'center',maxWidth:290},
  visitorBadge:{overflow:'hidden',backgroundColor:'#C76B4E',borderRadius:20,paddingHorizontal:21,paddingVertical:8,color:'#FFF9EF',fontWeight:'800',fontSize:13},
  heading: { fontSize: 24, fontWeight: '800', color: '#593723' },
  copy: { fontSize: 17, color: '#674832', lineHeight: 25 },
  feedback: { fontSize: 18, color: '#23795B', lineHeight: 26, fontWeight: '600' },
  note: { fontSize: 13, color: '#86674F', lineHeight: 19 },
  button: { backgroundColor: '#683D28',borderRadius:22,padding:17,minHeight:48,width:'100%' },
  secondary: { backgroundColor: '#EFDCBE' },
  buttonText: { color: '#FFF9E9', fontSize: 16, fontWeight: '700', textAlign: 'center' },
});

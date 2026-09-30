import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Image } from 'expo-image';
import { completeFriendInteraction, type MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { runBurrowAction } from '@/lib/burrow-store';
import { burrowFriendArt } from '@/lib/burrow-ui-assets';

/** Only render the durable server snapshot; never guess a live replacement. */
export function AdventureFriendCard({ data, busy, onComplete }: {
  data: MajorUpdateBootstrap; busy: boolean; onComplete: (feedback: string) => void;
}) {
  const adventure = data.activeAdventure;
  const metadata = data.adventureResult?.metadata;
  const content = metadata?.friendContent;
  const goToBattle = () => {
    if (!adventure || !content?.rage_monster_id) return;
    router.push({ pathname: '/(main)/tame-enemy', params: {
      monsterId: content.rage_monster_id, friendAdventureId: adventure.id,
    } } as Href);
  };
  const respond = (response: { acknowledged?: boolean; choiceId?: string }) => {
    if (!adventure) return;
    let battleRequired = false;
    let feedback = '';
    void runBurrowAction(`friend:${adventure.id}`, async () => {
      const result = await completeFriendInteraction(adventure.id, response);
      battleRequired = !!result.battleRequired;
      feedback = result.feedback ?? 'Every little story matters.';
    }).then(ok => {
      if (!ok) return;
      if (battleRequired) goToBattle();
      else onComplete(feedback);
    });
  };
  const button = (label: string, onPress: () => void) => <Pressable key={label}
    accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
    style={[styles.button, busy && { opacity: .5 }]} onPress={onPress}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
  return <View style={styles.card}>
    {burrowFriendArt(metadata?.friendSnapshot?.name)&&<Image source={burrowFriendArt(metadata?.friendSnapshot?.name)} contentFit="contain" style={{width:220,height:220,alignSelf:'center'}}/>}
    <Text style={styles.heading}>{metadata?.friendSnapshot?.name ?? 'Your new friend'}</Text>
    {!content ? <Text style={styles.copy}>This story could not be loaded. Refresh to try again; your discovery is saved.</Text> : <>
      <Text style={styles.copy}>{content.prompt}</Text>
      {content.content_type === 'insight' ? button('A little thought to keep', () => respond({ acknowledged: true }))
        : content.content_type === 'question' ? content.choices.map(choice => button(choice.label, () => respond({ choiceId: choice.id })))
        : <>
          <Text style={styles.copy}>Help in the matching Rage Room battle, then return to finish this adventure. Either of you can help. Daily battle limits still apply.</Text>
          {metadata?.acceptedAt ? <>
            {button('Continue helping in the Rage Room', goToBattle)}
            {button('I’ve finished · Return home', () => respond({ choiceId: 'yes' }))}
          </> : button('Yes, let’s help', () => respond({ choiceId: 'yes' }))}
          {button('Not now', () => Alert.alert('Finish without helping?', 'Your friend stays in your collection. There is no penalty and your treasure is kept.', [
            { text: 'Stay', style: 'cancel' }, { text: 'Not now', onPress: () => respond({ choiceId: 'not_now' }) },
          ]))}
        </>}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: '#FFF4E1', borderRadius: 25, padding: 22, gap: 14 },
  heading: { color: '#553521', fontSize: 22, fontWeight: '800' },
  copy: { color: '#79563E', fontSize: 16, lineHeight: 24 },
  button: { backgroundColor: '#2F8D72', borderRadius: 20, padding: 16, minHeight: 50 },
  buttonText: { color: '#FFF8EB', fontSize: 16, fontWeight: '700', textAlign: 'center' },
});

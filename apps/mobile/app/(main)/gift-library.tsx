import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AdventureGiftCollection } from '@/components/burrow/adventure-gift-collection';
import { BurrowBackButton } from '@/components/burrow/burrow-back-button';
import { selectAdventureGift } from '@/lib/app-major-update-api';
import { confirmBurrowShelfGift, runBurrowAction, useBurrow } from '@/lib/burrow-store';
import { dismissToRetainedTab } from '@/lib/retained-tab-navigation';

/** Overview and category are separate native cards, retaining the exact
 * underlying scroll position and inheriting the app's edge-back policy. */
export default function GiftLibrary() {
  const { category, returnTo } = useLocalSearchParams<{ category?: string; returnTo?:string }>();
  const { data, loading } = useBurrow(), insets = useSafeAreaInsets();
  const close = () => returnTo==='collection'&&router.canGoBack()?router.back():dismissToRetainedTab('/(main)/(tabs)');
  const back = () => router.canGoBack() ? router.back() : close();
  if (!data) return <View style={[s.root, { paddingTop: insets.top + 8 }]}>
    <BurrowBackButton onPress={back}/><View style={s.center}>{loading
      ? <ActivityIndicator color="#FFF4DA"/> : <Text style={s.message}>Your gifts could not load. Return Home to try again.</Text>}</View>
  </View>;
  return <AdventureGiftCollection key={`${data.profile.id}:${data.partner?.id ?? ''}:${data.pairVersion ?? ''}:${category ?? ''}`}
    data={data} ownerId={data.profile.id} category={typeof category === 'string' ? category : undefined}
    onOpenCategory={name => router.push({ pathname: '/(main)/gift-library', params: { category: name } })}
    onBack={back} onClose={close} onPreview={item=>router.push({pathname:'/(main)/gift-preview',params:{itemId:item.stable_id}})} onSelect={async item => {
      const owner = data.profile.id;
      const ok = await runBurrowAction('select-adventure-gift', () => selectAdventureGift(item.stable_id), { silent: true });
      if (ok) confirmBurrowShelfGift(owner, item.stable_id);
      return ok;
    }}/>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: '#874727', paddingHorizontal: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, message: { color: '#FFF4DA', textAlign: 'center' } });

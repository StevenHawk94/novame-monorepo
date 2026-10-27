import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BurrowMusicPicker } from '@/components/burrow/burrow-music';
import { BurrowBackButton } from '@/components/burrow/burrow-back-button';
import { useBurrowSnapshot } from '@/lib/burrow-store';

/** A regular Main card: the native stack owns entrance and edge-back, while
 * the single MainLayout music gate keeps playing after this page closes. */
export default function MusicPlayerScreen() {
  const { data } = useBurrowSnapshot();
  const focused = useIsFocused(), insets = useSafeAreaInsets();
  return <View style={styles.root}>
    {focused && <StatusBar hidden={false} barStyle="light-content" backgroundColor="#24150F"/>}
    {data ? <BurrowMusicPicker data={data} onClose={() => router.back()}/> : <View style={[styles.empty, {paddingTop:insets.top + 16}]}>
      <BurrowBackButton light onPress={() => router.back()}/>
      <Text style={styles.message}>Music is unavailable right now. Return to your room and try again.</Text>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  root: {flex:1,backgroundColor:'#24150F'},
  empty: {flex:1,paddingHorizontal:18},
  message: {color:'#F4E8DF',textAlign:'center',fontSize:16,lineHeight:24,marginTop:28},
});

import { useRef } from 'react';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** A real stack overlay keeps the checkout and draft mounted below. Replace
 * this prompt with Coin Shop, so closing the shop never resurfaces the prompt. */
export default function InsufficientCoinsModal() {
  const insets = useSafeAreaInsets(), leaving = useRef(false);
  const close = () => {
    if (leaving.current) return;
    leaving.current = true;
    if (router.canGoBack()) router.back(); else router.replace('/(main)/(tabs)');
  };
  const getMore = () => {
    if (leaving.current) return;
    leaving.current = true;
    router.replace('/(main)/coin-shop');
  };
  return <View style={[s.scrim,{paddingTop:insets.top+24,paddingBottom:insets.bottom+24}]}>
    <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Dismiss insufficient coins" onPress={close}/>
    <View style={s.card} accessibilityViewIsModal>
      <ScrollView style={s.scroll} bounces={false} contentContainerStyle={s.content}>
        <Text accessibilityRole="header" style={s.title}>Oops</Text>
        <Text style={s.copy}>You do not have enough coins.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Get More" onPress={getMore}
          style={({pressed})=>[s.button,pressed&&{opacity:.8}]}>
          <Text style={s.buttonText}>Get More</Text>
        </Pressable>
      </ScrollView>
    </View>
  </View>;
}
const s=StyleSheet.create({
  scrim:{flex:1,backgroundColor:'rgba(0,0,0,0.6)',alignItems:'center',justifyContent:'center',paddingHorizontal:24},
  card:{width:'100%',maxWidth:400,maxHeight:'100%',flexShrink:1,borderRadius:28,backgroundColor:'#FFF8EE',overflow:'hidden'},
  scroll:{flexGrow:0,flexShrink:1},
  content:{paddingHorizontal:24,paddingVertical:34,alignItems:'center',gap:22},
  title:{fontSize:30,lineHeight:38,fontWeight:'800',color:'#000000',textAlign:'center'},
  copy:{fontSize:18,lineHeight:26,color:'#000000',textAlign:'center'},
  button:{width:'60%',minWidth:150,minHeight:52,marginTop:8,borderRadius:30,backgroundColor:'#673019',
    paddingHorizontal:20,paddingVertical:12,alignItems:'center',justifyContent:'center'},
  buttonText:{color:'#FFFFFF',fontSize:20,lineHeight:26,fontWeight:'700',textAlign:'center'},
});

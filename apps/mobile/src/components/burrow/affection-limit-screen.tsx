import { useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BURROW_BACKGROUNDS } from '@/lib/burrow-art-assets';
import { BURROW_DAILY_ENTRY_ART } from '@/lib/burrow-ui-assets';
import { Image } from './burrow-image';
import { BurrowBackButton } from './burrow-back-button';
import Svg, { Path } from 'react-native-svg';
import { dismissToRetainedTab } from '@/lib/retained-tab-navigation';

export function AffectionLimitScreen({ unreadCount = 0, onInbox,hasPlus=false }: { unreadCount?: number; onInbox?: () => void;hasPlus?:boolean }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const closing=useRef(false);
  function close(){if(closing.current)return;closing.current=true;dismissToRetainedTab('/(main)/(tabs)');}
  const cardWidth=Math.min(width-40,560);
  return <View style={s.root}>
    <Image source={BURROW_BACKGROUNDS.affectionSend} contentFit="cover" contentPosition="top" style={StyleSheet.absoluteFillObject}/>
    <View style={[s.header,{paddingTop:insets.top+12}]}>
      <BurrowBackButton onPress={()=>router.back()}/>
      {unreadCount > 0 && onInbox && <Pressable accessibilityRole="button" accessibilityLabel={`${unreadCount} unread affection`}
        onPress={onInbox} style={s.inbox}><Text style={s.inboxText}>{unreadCount}</Text></Pressable>}
    </View>
    <ScrollView style={s.scrollView} bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll,{paddingVertical:Math.max(insets.top+64,insets.bottom+30)}]}>
      <View style={[s.panel,{width:cardWidth,minHeight:Math.max(290,cardWidth*704/808)}]}>
        {hasPlus?<Svg accessible={false} width={52} height={52} viewBox="0 0 24 24" style={s.heart}>
          <Path fill="#F36A91" d="M12 21s-9-5.6-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.4-9 12-9 12Z"/>
        </Svg>:<Image source={BURROW_DAILY_ENTRY_ART.plus} contentFit="contain" style={s.icon}/>}
        <Text accessibilityRole="header" style={s.title}>{hasPlus?'That’s a lot of love today':'Want to send more?'}</Text>
        <Text style={s.copy}>{hasPlus?'You’ve sent all 6 for today. Come back tomorrow to send more.':'Plus gives you 6x more love every day, for both of you.'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={hasPlus?'OK':'Try Plus'} onPress={hasPlus?close:()=>router.push('/(main)/(modals)/subscription-paywall')}
          style={({pressed})=>[s.button,pressed&&s.pressed]}><Text style={s.buttonText}>{hasPlus?'OK':'Try Plus'}</Text></Pressable>
      </View>
    </ScrollView>
  </View>;
}
const s=StyleSheet.create({
  root:{flex:1,backgroundColor:'#EF8392'},header:{position:'absolute',top:0,left:0,right:0,zIndex:2,paddingHorizontal:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  scrollView:{flex:1},scroll:{flexGrow:1,justifyContent:'center',paddingHorizontal:20},
  panel:{alignSelf:'center',backgroundColor:'#f9f2e5',borderRadius:12,
    paddingHorizontal:24,paddingVertical:30,alignItems:'center',justifyContent:'space-between',gap:18},
  icon:{width:48,height:48,transform:[{scale:1.4}]},heart:{transform:[{rotate:'-10deg'}]},
  title:{color:'#482711',fontSize:22,lineHeight:29,fontWeight:'800',textAlign:'center'},
  copy:{color:'#482711',fontSize:17,lineHeight:24,textAlign:'center',width:'90%',maxWidth:380},
  button:{width:'71%',minHeight:53,paddingHorizontal:20,paddingVertical:12,borderRadius:12,backgroundColor:'#674A3B',alignItems:'center',justifyContent:'center',marginTop:8},
  buttonText:{fontSize:18,lineHeight:24,fontWeight:'600',color:'#FFF9EF'},pressed:{opacity:.8},
  inbox:{width:38,height:38,borderRadius:19,backgroundColor:'#E94754',alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'#FFF7F1'},
  inboxText:{color:'#FFF',fontWeight:'800',fontSize:18},
});

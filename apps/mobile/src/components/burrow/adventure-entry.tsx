import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BURROW_ADVENTURE_ENTRY_ART } from '@/lib/burrow-ui-assets';
import { Image } from './burrow-image';
import { AdventureReveal } from './adventure-reveal';
import { ADVENTURE_LOG_BACKGROUND } from '@/lib/burrow-surface';

/** Content follows the natural-ratio banner; tall screens keep empty space
 * below the choices, not between the banner and the first action. */
export function AdventureEntry({ onWrite, onTap }: { onWrite: () => void; onTap: () => void }) {
  return <View style={s.root}>
    <Image source={BURROW_ADVENTURE_ENTRY_ART.banner} contentFit="contain" contentPosition="top"
      accessibilityLabel="Your bunny is ready to explore" style={s.hero}/>
    <View style={s.content}>
      <AdventureReveal style={s.heading}><Image source={BURROW_ADVENTURE_ENTRY_ART.compass} contentFit="contain" style={s.compass}/>
        <Text accessibilityRole="header" style={s.subtitle}>Log a moment to begin</Text></AdventureReveal>
      <AdventureReveal delay={180} style={{width:"100%"}}><Pressable accessibilityRole="button" accessibilityLabel="Write Freely" onPress={onWrite} style={({pressed})=>[s.choice,pressed&&s.pressed]}>
        <View style={s.choiceCopy}><Text style={s.choiceTitle}>Write Freely</Text><Text style={s.choiceText}>Anything worth remembering today</Text></View>
        <Image source={BURROW_ADVENTURE_ENTRY_ART.write} contentFit="contain" style={s.choiceIcon}/>
      </Pressable></AdventureReveal>
      <AdventureReveal delay={260} style={{width:"100%"}}><Pressable accessibilityRole="button" accessibilityLabel="Tap your day" onPress={onTap} style={({pressed})=>[s.choice,pressed&&s.pressed]}>
        <View style={s.choiceCopy}><Text style={s.choiceTitle}>Tap your day</Text><Text style={s.choiceText}>Select items that tell your day.</Text></View>
        <Image source={BURROW_ADVENTURE_ENTRY_ART.tap} contentFit="contain" style={s.choiceIcon}/>
      </Pressable></AdventureReveal>
    </View>
  </View>;
}
const s=StyleSheet.create({
  root:{flexGrow:1,flexShrink:0,backgroundColor:ADVENTURE_LOG_BACKGROUND},
  hero:{width:'100%',aspectRatio:900/600,flexShrink:0},
  content:{flexShrink:0,justifyContent:'flex-start',paddingHorizontal:20,paddingTop:32,paddingBottom:24,alignItems:'center',gap:14},
  heading:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,marginBottom:12,width:'100%'},
  compass:{width:32,height:32,flexShrink:0},
  subtitle:{fontSize:20,lineHeight:28,fontWeight:'800',color:'#FFF9EB',textAlign:'center',flexShrink:1},
  choice:{width:'100%',minHeight:78,backgroundColor:'#FFF6E8',borderRadius:21,paddingHorizontal:20,paddingVertical:14,flexDirection:'row',alignItems:'center',gap:12,shadowColor:'#B16D32',shadowOffset:{width:0,height:4},shadowOpacity:1,shadowRadius:0,elevation:4},
  pressed:{transform:[{translateY:3}],shadowOffset:{width:0,height:1},elevation:1},choiceCopy:{flex:1},
  choiceTitle:{fontSize:17,fontWeight:'800',color:'#17120F'},
  choiceText:{fontSize:13,lineHeight:19,color:'#241A14'},
  choiceIcon:{width:50,height:50,flexShrink:0},
});

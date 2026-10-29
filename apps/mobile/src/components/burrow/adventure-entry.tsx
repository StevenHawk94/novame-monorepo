import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { BURROW_ADVENTURE_ENTRY_ART, BURROW_ADVENTURE_BANNERS } from '@/lib/burrow-ui-assets';
import { useAppViewport } from '@/lib/app-viewport';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBurrowEnvironment } from '@/lib/use-burrow-environment';
import { prepareBurrowImages } from '@/lib/prepared-burrow-images';
import { adventureEntryLayout } from '@/lib/adventure-entry-layout';
import { Image } from './burrow-image';
import { AdventureReveal } from './adventure-reveal';
import { ADVENTURE_LOG_BACKGROUND } from '@/lib/burrow-surface';

/** Content follows the natural-ratio banner; tall screens keep empty space
 * below the choices, not between the banner and the first action. */
export function AdventureEntry({ onWrite, onTap, timeZone, now }: {
  onWrite: () => void; onTap: () => void; timeZone?: string | null; now?: number;
}) {
  const { width } = useAppViewport(), insets = useSafeAreaInsets();
  const environment = useBurrowEnvironment(timeZone, now);
  const layout = adventureEntryLayout(width, insets.top);
  // Warm only this season, through the shared native decoder. This is optional
  // presentation work, never another Home/Splash or navigation readiness gate.
  useEffect(() => {
    void prepareBurrowImages([BURROW_ADVENTURE_BANNERS[`${environment.season}-day`],
      BURROW_ADVENTURE_BANNERS[`${environment.season}-night`]], 1600).catch(() => {});
  }, [environment.season]);
  const choiceStyle = { minHeight: layout.choiceHeight, borderRadius: layout.choiceRadius,
    paddingHorizontal: layout.choicePadding };
  const titleStyle = { fontSize: layout.choiceTitle };
  const textStyle = { fontSize: layout.choiceText, lineHeight: Math.ceil(layout.choiceText * 1.45) };
  const iconStyle = { width: layout.choiceIcon, height: layout.choiceIcon };
  return <View style={s.root}>
    <View testID="adventure-entry-banner" style={[s.hero, { aspectRatio: layout.bannerRatio }]}>
      <Image source={BURROW_ADVENTURE_BANNERS[environment.banner]} contentFit="contain" contentPosition="center"
        accessibilityLabel={`${environment.season} ${environment.period} adventure landscape`} style={[StyleSheet.absoluteFillObject,{width:'100%',height:'100%'}]}/>
      <Text accessibilityRole="header" style={[s.bannerTitle, { top: layout.titleTop, fontSize: layout.titleFont,
        color: environment.period === 'night' ? '#FFFFFF' : '#4c341b' }]}>Start Today’s Adventure</Text>
    </View>
    <View testID="adventure-entry-content" style={[s.content, { paddingHorizontal: layout.side, paddingTop: layout.bannerGap, gap: layout.choiceGap }]}>
      <AdventureReveal style={[s.heading, { gap: layout.headingGap, marginBottom: layout.headingBottom - layout.choiceGap }]}>
        <Image source={BURROW_ADVENTURE_ENTRY_ART.compass} contentFit="contain" style={{width:layout.compass,height:layout.compass}}/>
        <Text accessibilityRole="header" style={[s.subtitle,{fontSize:layout.headingFont,lineHeight:layout.headingLine}]}>Log a moment to begin</Text>
      </AdventureReveal>
      <AdventureReveal delay={180} style={{width:"100%"}}><Pressable accessibilityRole="button" accessibilityLabel="Write Freely" onPress={onWrite} style={({pressed})=>[s.choice,choiceStyle,pressed&&s.pressed]}>
        <View style={s.choiceCopy}><Text style={[s.choiceTitle,titleStyle]}>Write Freely</Text><Text style={[s.choiceText,textStyle]}>Anything worth remembering today</Text></View>
        <Image source={BURROW_ADVENTURE_ENTRY_ART.write} contentFit="contain" style={iconStyle}/>
      </Pressable></AdventureReveal>
      <AdventureReveal delay={260} style={{width:"100%"}}><Pressable accessibilityRole="button" accessibilityLabel="Tap your day" onPress={onTap} style={({pressed})=>[s.choice,choiceStyle,pressed&&s.pressed]}>
        <View style={s.choiceCopy}><Text style={[s.choiceTitle,titleStyle]}>Tap your day</Text><Text style={[s.choiceText,textStyle]}>Choose the moments that tell your day’s story.</Text></View>
        <Image source={BURROW_ADVENTURE_ENTRY_ART.tap} contentFit="contain" style={iconStyle}/>
      </Pressable></AdventureReveal>
    </View>
  </View>;
}
const s=StyleSheet.create({
  root:{flexGrow:1,flexShrink:0,backgroundColor:ADVENTURE_LOG_BACKGROUND},
  hero:{width:'100%',flexShrink:0},
  bannerTitle:{position:'absolute',left:20,right:20,fontWeight:'800',textAlign:'center'},
  content:{flexShrink:0,justifyContent:'flex-start',paddingBottom:24,alignItems:'center'},
  heading:{flexDirection:'column',alignItems:'center',justifyContent:'center',width:'100%'},
  subtitle:{fontWeight:'800',color:'#FFF9EB',textAlign:'center',flexShrink:1},
  choice:{width:'100%',backgroundColor:'#FFF6E8',paddingVertical:14,flexDirection:'row',alignItems:'center',gap:12,shadowColor:'#B16D32',shadowOffset:{width:0,height:4},shadowOpacity:1,shadowRadius:0,elevation:4},
  pressed:{transform:[{translateY:3}],shadowOffset:{width:0,height:1},elevation:1},choiceCopy:{flex:1},
  choiceTitle:{fontWeight:'800',color:'#17120F'},
  choiceText:{color:'#241A14'},
});

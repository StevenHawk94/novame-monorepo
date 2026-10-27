import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { adventureEncounterLayout } from '@/lib/adventure-encounter-layout';
import { burrowFriendArt, burrowFriendArtGeometry } from '@/lib/burrow-ui-assets';
import { Image } from './burrow-image';
import { AdventureReveal } from './adventure-reveal';
import Animated, { cancelAnimation, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { BURROW_MOTION } from '@/lib/burrow-motion';
import {friendPanelBudget,friendTextSizing,type FriendTextPage} from '@/lib/friend-text-layout';
import {FriendTextContext,FriendTextMeasure} from './friend-text-panel';

/** The same retained stage for invitation, dialogue and choices. Only the
 * panel's contents change; its size and the character's scale do not. */
export function AdventureEncounterLayout({ friendName, heading, answered = false, children, visitMode, pages=[] }: {
  friendName?: string | null; heading?: string; answered?: boolean; children: ReactNode; visitMode?:'invite'|'quiet'|'dialogue';
  pages?:readonly FriendTextPage[];
}) {
  const window = useWindowDimensions(), insets = useSafeAreaInsets();
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const width = measured?.width ?? window.width;
  const height = measured?.height ?? Math.max(1, window.height - insets.top - 42 - insets.bottom - 16);
  const panelWidth=width-(visitMode?0:12),columnWidth=Math.min(560,panelWidth*.8);
  const sizing=friendTextSizing(columnWidth,height,window.fontScale);
  const signature=JSON.stringify([pages,columnWidth,height,window.fontScale]);
  const [fit,setFit]=useState<{key:string;size:number;panelHeight:number;hintHeight:number;heights:Record<string,number>}|null>(null);
  const ready=!pages.length||fit?.key===signature;
  const panelHeight=fit?.key===signature?fit.panelHeight:friendPanelBudget(height).base;
  const panelMode=visitMode==='invite'?'visit-invite':visitMode==='quiet'?'visit-quiet':'dialogue';
  const layout = adventureEncounterLayout(width, height, burrowFriendArtGeometry(friendName), answered,panelMode,panelHeight);
  const art = burrowFriendArt(friendName, true);
  const replyLayout = adventureEncounterLayout(width, height, burrowFriendArtGeometry(friendName), true,panelMode,panelHeight);
  const greeting = burrowFriendArt(friendName, false);
  const greetingLayout = adventureEncounterLayout(width, height, burrowFriendArtGeometry(friendName), false,panelMode,panelHeight);
  const pose = useSharedValue(answered ? 1 : 0);
  useEffect(() => {
    pose.value = withTiming(answered ? 1 : 0, {duration:BURROW_MOTION.dialogue,reduceMotion:ReduceMotion.System});
    return () => cancelAnimation(pose);
  }, [answered, pose]);
  const replyStyle = useAnimatedStyle(() => ({ opacity: pose.value }));
  const greetingStyle = useAnimatedStyle(() => ({ opacity: 1 - pose.value }));
  return <View style={s.root} onLayout={({ nativeEvent: { layout: next } }) => {
    if (next.width > 0 && next.height > 0) setMeasured(old =>
      old?.width === next.width && old?.height === next.height ? old : { width: next.width, height: next.height });
  }}>
    {visitMode!=='quiet'&&ready&&<View pointerEvents="none" style={[s.stage, { top: layout.headingBottom }]}>
      {greeting && <Animated.View style={[StyleSheet.absoluteFillObject, greetingStyle]}><Image source={greeting} contentFit="contain" transition={0} style={{ position: 'absolute',
        ...greetingLayout.image, top: greetingLayout.image.top - layout.headingBottom }} /></Animated.View>}
      {art && <Animated.View style={[StyleSheet.absoluteFillObject, replyStyle]}><Image source={art} contentFit="contain" transition={0} style={{ position: 'absolute',
        ...replyLayout.image, top: replyLayout.image.top - layout.headingBottom }} /></Animated.View>}
    </View>}
    {!visitMode&&<AdventureReveal style={[s.headingPosition,{left:(width-columnWidth)/2,width:columnWidth}]}><Text accessibilityRole="header" adjustsFontSizeToFit numberOfLines={2} minimumFontScale={.8} maxFontSizeMultiplier={1.2} style={s.heading}>
      {heading ?? (friendName ? `You meet ${friendName}` : 'Adventure complete')}
    </Text></AdventureReveal>}
    <AdventureReveal delay={180} style={[s.card,visitMode&&s.visitCard, { height: layout.panelHeight }]}>
      <FriendTextContext.Provider value={{size:fit?.size??sizing.size,width:columnWidth,height:panelHeight,hintHeight:fit?.hintHeight??44,maxFontSizeMultiplier:sizing.maxFontSizeMultiplier,heights:fit?.heights??{}}}>
        {ready&&children}
      </FriendTextContext.Provider>
    </AdventureReveal>
    {pages.length>0&&<FriendTextMeasure pages={pages} width={columnWidth} height={height} fontScale={window.fontScale}
      onReady={next=>setFit({key:signature,...next})}/>}
  </View>;
}
const s = StyleSheet.create({
  root: { flex: 1 },
  stage: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  headingPosition: { position: 'absolute', top: 16 },
  heading: { fontSize: 20, lineHeight: 28,
    fontWeight: '700', color: '#FFF9EF', textAlign: 'center' },
  card: { position: 'absolute', left: 6, right: 6, bottom: 0, borderRadius: 26,
    backgroundColor: '#FFF8EC', borderBottomWidth: 5, borderBottomColor: '#D99B66', overflow: 'hidden' },
  visitCard:{left:0,right:0},
});

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

/** The same retained stage for invitation, dialogue and choices. Only the
 * panel's contents change; its size and the character's scale do not. */
export function AdventureEncounterLayout({ friendName, heading, answered = false, children, visitMode }: {
  friendName?: string | null; heading?: string; answered?: boolean; children: ReactNode; visitMode?:'invite'|'quiet'|'dialogue';
}) {
  const window = useWindowDimensions(), insets = useSafeAreaInsets();
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const width = measured?.width ?? window.width;
  const height = measured?.height ?? Math.max(1, window.height - insets.top - 42 - insets.bottom - 16);
  const panelMode=visitMode==='invite'?'visit-invite':visitMode==='quiet'?'visit-quiet':'dialogue';
  const layout = adventureEncounterLayout(width, height, burrowFriendArtGeometry(friendName), answered,panelMode);
  const art = burrowFriendArt(friendName, true);
  const replyLayout = adventureEncounterLayout(width, height, burrowFriendArtGeometry(friendName), true,panelMode);
  const greeting = burrowFriendArt(friendName, false);
  const greetingLayout = adventureEncounterLayout(width, height, burrowFriendArtGeometry(friendName), false,panelMode);
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
    {visitMode!=='quiet'&&<View pointerEvents="none" style={[s.stage, { top: layout.headingBottom }]}>
      {greeting && <Animated.View style={[StyleSheet.absoluteFillObject, greetingStyle]}><Image source={greeting} contentFit="contain" transition={0} style={{ position: 'absolute',
        ...greetingLayout.image, top: greetingLayout.image.top - layout.headingBottom }} /></Animated.View>}
      {art && <Animated.View style={[StyleSheet.absoluteFillObject, replyStyle]}><Image source={art} contentFit="contain" transition={0} style={{ position: 'absolute',
        ...replyLayout.image, top: replyLayout.image.top - layout.headingBottom }} /></Animated.View>}
    </View>}
    {!visitMode&&<AdventureReveal style={s.headingPosition}><Text accessibilityRole="header" numberOfLines={2} maxFontSizeMultiplier={1.2} style={s.heading}>
      {heading ?? (friendName ? `You meet ${friendName}` : 'Adventure complete')}
    </Text></AdventureReveal>}
    <AdventureReveal delay={180} style={[s.card,visitMode&&s.visitCard, { height: layout.panelHeight }]}>{children}</AdventureReveal>
  </View>;
}
const s = StyleSheet.create({
  root: { flex: 1 },
  stage: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  headingPosition: { position: 'absolute', top: 16, left: 36, right: 36 },
  heading: { fontSize: 25, lineHeight: 32,
    fontWeight: '800', color: '#FFF9EF', textAlign: 'center' },
  card: { position: 'absolute', left: 6, right: 6, bottom: 0, borderRadius: 26,
    backgroundColor: '#FFF8EC', borderBottomWidth: 5, borderBottomColor: '#D99B66', overflow: 'hidden' },
  visitCard:{left:0,right:0},
});

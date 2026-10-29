import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { BURROW_FIXED_ART, burrowArtForItem } from '@/lib/burrow-art-assets';
import { ADVENTURE_COIN_ART } from '@/lib/adventure-treasure-art';
import { adventureRewardArtLayout, adventureTreasureLayout } from '@/lib/adventure-screen-layout';
import { ADVENTURE_REWARD_MOTION as M, adventureGiftLayout, rewardRevealFrame, rewardTextOpacity } from '@/lib/adventure-reward-motion';
import { useAdventureMotion } from '@/lib/use-adventure-motion';
import { haptics } from '@/lib/haptics';
import { burrowShopCategoryName } from '@/lib/burrow-shop-categories';
import { AdventureReveal } from './adventure-reveal';
import { AdventureGiftBox } from './adventure-gift-box';
import { AdventureSunburst } from './adventure-sunburst';
import { Image } from './burrow-image';

function ramp(p: number, start: number, end: number) {
  'worklet';
  return Math.max(0, Math.min(1, (p - start) / (end - start)));
}

/** Open is display-only. Only explicit Claim calls the parent's existing
 * durable delivery/settlement handler, never an animation completion. */
export function AdventureRewardScreen({ variant, title, item, coins=0, friendName, hasFriend = false, busy, error, onClaim }: {
  variant: 'treasure' | 'gift'; title: string; item?: MajorUpdateCatalogItem | null;
  friendName?: string | null; hasFriend?: boolean; busy: boolean; error?: string | null;
  coins?:number;
  onClaim: () => Promise<void>;
}) {
  const window = useWindowDimensions(), insets = useSafeAreaInsets();
  const [size, setSize] = useState({ width: window.width, height: window.height });
  const [phase, setPhase] = useState<'idle' | 'opening' | 'opened'>('idle');
  const [claiming, setClaiming] = useState(false);
  const openLock = useRef(false), claimLock = useRef(false), mounted = useRef(true);
  const { active, reduced } = useAdventureMotion();
  const progress = useSharedValue(0), idle = useSharedValue(0);
  const treasure = adventureTreasureLayout(size.width, size.height);
  const gift = adventureGiftLayout(size.width, size.height, insets.top, insets.bottom);
  const isGift = variant === 'gift', emptyGift = isGift && !item;
  const cardSize = isGift ? gift.cardSize : treasure.rewardSize, cardTop = isGift ? gift.cardTop : treasure.rewardTop;
  const isCoins=!isGift&&(coins===50||coins===100);
  const art = isCoins ? ADVENTURE_COIN_ART : item ? burrowArtForItem(item) : undefined;
  const artRect = art ? adventureRewardArtLayout(art, cardSize - 36) : null;
  const revealed = phase !== 'idle', opened = phase === 'opened';
  const disabled = busy || claiming || phase === 'opening';
  const finishOpening = () => { if (mounted.current) setPhase('opened'); };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelAnimation(progress); cancelAnimation(idle); };
  }, [progress, idle]);
  useEffect(() => {
    if (active && !reduced && phase === 'idle' && !emptyGift) {
      idle.value = withRepeat(withSequence(withTiming(0, { duration: M.idlePause }),
        withTiming(-.045, { duration: 90 }), withTiming(.055, { duration: 100 }),
        withTiming(-.04, { duration: 100 }), withTiming(.025, { duration: 100 }),
        withTiming(0, { duration: 130 })), -1, false);
    } else { cancelAnimation(idle); idle.value = withTiming(0, { duration: reduced ? 0 : 80 }); }
    return () => cancelAnimation(idle);
  }, [active, reduced, phase, emptyGift, idle]);
  useEffect(() => {
    // A cancelled opening must never strand Claim on background/navigation.
    if (phase === 'opening' && (!active || reduced)) { cancelAnimation(progress); progress.value = 1; finishOpening(); }
  }, [active, reduced, phase, progress]);
  function open() {
    if (openLock.current || disabled || emptyGift) return;
    openLock.current = true; void haptics.light()?.catch(() => {});
    cancelAnimation(idle); idle.value = withTiming(0, { duration: reduced ? 0 : 80 });
    if (reduced || !active) { progress.value = 1; setPhase('opened'); return; }
    setPhase('opening');
    progress.value = withTiming(1, { duration: M.opening, easing: Easing.linear }, done => { if (done) runOnJS(finishOpening)(); });
  }
  function claim() {
    if (claimLock.current || disabled || (!opened && !emptyGift)) return;
    claimLock.current = true; setClaiming(true);
    void onClaim().catch(() => {}).finally(() => { claimLock.current = false; if (mounted.current) setClaiming(false); });
  }
  const intro = useAnimatedStyle(() => ({ opacity: 1 - ramp(progress.value, .04, .24) }));
  const prizeHeading = useAnimatedStyle(() => ({ opacity: rewardTextOpacity(progress.value) }));
  const reward = useAnimatedStyle(() => {
    const frame = rewardRevealFrame(progress.value, isGift ? gift.boxCenterY - (cardTop + cardSize / 2) : treasure.rewardRise);
    return { opacity: frame.opacity, transform: [{ translateY: frame.translateY }, { scale: frame.scale }] };
  });
  const boxMotion = useAnimatedStyle(() => {
    const squash = ramp(progress.value, 0, .12) * (1 - ramp(progress.value, .12, .26));
    return { transform: [{ translateY: 6 * squash }, { rotate: `${idle.value}rad` }, { scaleX: 1 + .06 * squash }, { scaleY: 1 - .08 * squash }] };
  });
  const closedChest = useAnimatedStyle(() => ({ opacity: 1 - ramp(progress.value, .16, .30) }));
  const openChest = useAnimatedStyle(() => ({ opacity: ramp(progress.value, .16, .30) }));
  const giftBase = useAnimatedStyle(() => ({ opacity: 1 - ramp(progress.value, .35, .75), transform: [{ translateY: gift.boxSize * .45 * ramp(progress.value, .18, .75) }] }));
  const giftLid = useAnimatedStyle(() => ({ opacity: 1 - ramp(progress.value, .32, .65), transform: [
    { translateY: -gift.boxSize * .85 * ramp(progress.value, .15, .65) }, { translateX: gift.boxSize * .15 * ramp(progress.value, .15, .65) }, { rotate: `${.55 * ramp(progress.value, .15, .65)}rad` },
  ] }));
  const openLabel = useAnimatedStyle(() => ({ opacity: 1 - ramp(progress.value, .05, .22) }));
  const claimLabel = useAnimatedStyle(() => ({ opacity: ramp(progress.value, .82, 1) }));
  return <View style={[s.root, isGift && s.giftRoot]} onLayout={({ nativeEvent: { layout } }) => {
    if (layout.width > 0 && layout.height > 0) setSize(old => old.width === layout.width && old.height === layout.height ? old : { width: layout.width, height: layout.height });
  }}>
    <View style={s.root}>
      <AdventureSunburst width={size.width} height={size.height} centerX={size.width / 2} centerY={cardTop + cardSize / 2} progress={progress} active={active} reduced={reduced}/>
      <Animated.View pointerEvents="none" accessibilityElementsHidden={revealed} importantForAccessibility={revealed ? 'no-hide-descendants' : 'auto'} style={[StyleSheet.absoluteFillObject, intro]}>
        {isGift ? <AdventureReveal delay={M.headingDelay} style={[s.giftIntro, { top: gift.titleTop }]}><Text style={s.giftHeading}>{emptyGift ? 'Welcome home' : friendName ? `You receive a gift from\n${friendName}` : 'A little gift for you'}</Text></AdventureReveal> : <>
          <AdventureReveal style={[s.tagRow, { top: treasure.tagTop }]}><Text style={s.spark}>✦</Text><Text style={s.tag}>ADVENTURE COMPLETE</Text><Text style={s.spark}>✦</Text></AdventureReveal>
          <AdventureReveal delay={M.panelDelay} style={[s.treasureTitle, { top: treasure.titleTop }]}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.7} style={[s.title, { fontSize: Math.min(44, size.width * .105) }]}>A treasure chest!</Text></AdventureReveal>
          <AdventureReveal delay={240} style={[s.subtitle, { top: treasure.subtitleTop }]}><Text style={s.subtitleText}>You found something deep below.</Text></AdventureReveal>
        </>}
      </Animated.View>
      {!isGift && <Animated.View testID="adventure-reward-heading" pointerEvents="none" accessibilityElementsHidden={!opened} importantForAccessibility={opened ? 'auto' : 'no-hide-descendants'} style={[s.found, { top: treasure.foundTop }, prizeHeading]}><Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={.8} style={s.foundText}>{isCoins?'You found coins!':item ? `You found new ${burrowShopCategoryName(item.category)}` : title}</Text></Animated.View>}
      {!isGift && <Pressable accessibilityRole="button" accessibilityLabel={revealed ? 'Opened treasure chest' : 'Tap to open treasure chest'} disabled={revealed || disabled} onPress={open} style={[s.boxTarget, treasure.chestTarget]}>
        <Animated.View pointerEvents="none" style={[s.fill, boxMotion]}>
          <Animated.View style={[s.layer, treasure.chestImage, closedChest]}><Image source={BURROW_FIXED_ART.treasureClosed} contentFit="contain" style={s.fill}/></Animated.View>
          <Animated.View style={[s.layer, treasure.chestImage, openChest]}><Image source={BURROW_FIXED_ART.treasureOpen} contentFit="contain" style={s.fill}/></Animated.View>
        </Animated.View>
      </Pressable>}
      {!emptyGift && <Animated.View testID="adventure-reward-product" pointerEvents="none" accessibilityElementsHidden={!opened} importantForAccessibility={opened ? 'auto' : 'no-hide-descendants'} style={[s.reward, { left: (size.width - cardSize) / 2, top: cardTop, width: cardSize, height: cardSize }, reward]}>
        {art && artRect ? <View style={s.item}><Image source={art.source} accessibilityLabel={title} contentFit="contain" style={[s.layer, artRect]}/></View> : <Text style={s.itemTitle}>{title}</Text>}
      </Animated.View>}
      {!isGift&&(!!item||isCoins)&&<Animated.View testID="adventure-reward-name" pointerEvents="none" accessibilityElementsHidden={!opened} importantForAccessibility={opened ? 'auto' : 'no-hide-descendants'} style={[s.giftPrize,{top:treasure.nameTop},prizeHeading]}><Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={.8} style={s.productName}>{title}</Text></Animated.View>}
      {isGift ? emptyGift ? <Text style={[s.empty, { top: gift.centerY }]}>{title}</Text> : <>
        <Pressable accessibilityRole="button" accessibilityLabel="Open gift box" disabled={revealed || disabled} onPress={open} accessibilityElementsHidden={revealed} importantForAccessibility={revealed ? 'no-hide-descendants' : 'auto'} style={[s.boxTarget, { left: (size.width - gift.boxSize) / 2, top: gift.boxCenterY - gift.boxSize / 2, width: gift.boxSize, height: gift.boxSize }]}>
          <Animated.View pointerEvents="none" style={[s.fill, boxMotion]}>
            <Animated.View style={[s.absoluteFill, giftBase]}><AdventureGiftBox layer="base"/></Animated.View>
            <Animated.View style={[s.absoluteFill, giftLid]}><AdventureGiftBox layer="lid"/></Animated.View>
          </Animated.View>
        </Pressable>
        <Animated.View testID="adventure-reward-heading" pointerEvents="none" accessibilityElementsHidden={!opened} importantForAccessibility={opened ? 'auto' : 'no-hide-descendants'} style={[s.giftPrize, { top: gift.headingTop }, prizeHeading]}><Text style={s.giftHeading}>You receive</Text></Animated.View>
        <Animated.View testID="adventure-reward-name" pointerEvents="none" accessibilityElementsHidden={!opened} importantForAccessibility={opened ? 'auto' : 'no-hide-descendants'} style={[s.giftPrize, { top: gift.prizeTop }, prizeHeading]}><Text style={s.giftName}>{title}</Text></Animated.View>
      </> : <View pointerEvents="none" accessible={false} style={[s.boxTarget, treasure.chestTarget]}>
        <Animated.View style={[s.fill, boxMotion]}>
          <View style={[s.frontClip, treasure.chestFrontClip]}>
            <Animated.View style={[s.layer, treasure.chestFrontImage, openChest]}><Image source={BURROW_FIXED_ART.treasureOpen} contentFit="contain" style={s.fill}/></Animated.View>
          </View>
        </Animated.View>
      </View>}
      <AdventureReveal delay={M.buttonDelay} style={[s.footer, { bottom: isGift ? gift.footerBottom : treasure.footerBottom }]}>
        {!isGift && <Animated.Text accessibilityElementsHidden={!opened} importantForAccessibility={opened ? 'auto' : 'no-hide-descendants'} style={[s.note, claimLabel]}>{isCoins?'Add to your coins':item ? item.item_type === 'decor' ? 'Add to Furnitures' : 'Add to Collection' : hasFriend ? 'A friend has a story to share.' : 'Your little discovery is ready.'}</Animated.Text>}
        {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={emptyGift ? 'Finish adventure' : opened ? 'Claim' : isGift ? 'Open' : 'Tap to Open'} disabled={disabled} accessibilityState={{ disabled }} onPress={emptyGift || opened ? claim : open}
          style={({ pressed }) => [s.button, isGift && s.giftButton, { minHeight: isGift ? gift.buttonHeight : treasure.buttonHeight }, pressed && s.pressed, (busy || claiming) && s.busy]}>
          {emptyGift ? <Text style={s.giftButtonText}>Finish adventure</Text> : <>
            <Animated.Text accessible={false} style={[s.label, isGift && s.giftButtonText, openLabel]}>{isGift ? 'Open' : 'Tap to Open'}</Animated.Text>
            <Animated.Text accessible={false} style={[s.label, s.claimLabel, isGift && s.giftButtonText, claimLabel]}>Claim</Animated.Text>
          </>}
        </Pressable>
      </AdventureReveal>
    </View>
  </View>;
}
const s = StyleSheet.create({
  root:{flex:1},giftRoot:{backgroundColor:'#C45637'},fill:{width:'100%',height:'100%'},absoluteFill:StyleSheet.absoluteFillObject,layer:{position:'absolute'},frontClip:{position:'absolute',overflow:'hidden'},
  tagRow:{position:'absolute',left:12,right:12,flexDirection:'row',justifyContent:'center',alignItems:'center',gap:10},spark:{fontSize:22,color:'#FFE990'},tag:{backgroundColor:'#FFF1DA',color:'#844222',borderRadius:20,overflow:'hidden',paddingHorizontal:16,paddingVertical:7,fontSize:12,fontWeight:'800',letterSpacing:1.2},
  treasureTitle:{position:'absolute',left:20,right:20},title:{fontWeight:'800',color:'#FFF9EF',textAlign:'center'},subtitle:{position:'absolute',left:20,right:20},subtitleText:{fontSize:17,lineHeight:24,color:'#FFF1DA',textAlign:'center',fontWeight:'700'},found:{position:'absolute',left:24,right:24,height:58,justifyContent:'center'},foundText:{fontSize:22,lineHeight:29,fontWeight:'800',color:'#FFF9EF',textAlign:'center'},
  reward:{position:'absolute',padding:18,alignItems:'center',justifyContent:'center'},item:{width:'100%',height:'100%',overflow:'hidden'},itemTitle:{fontSize:19,fontWeight:'800',color:'#532A17',textAlign:'center'},boxTarget:{position:'absolute'},
  productName:{fontSize:17,lineHeight:23,color:'#FFF9EF',fontWeight:'700',textAlign:'center'},
  footer:{position:'absolute',left:24,right:24,gap:14},note:{color:'#FFF1DA',fontSize:16,textAlign:'center',fontWeight:'600'},error:{color:'#FFF5DE',fontSize:15,textAlign:'center',backgroundColor:'#7B351E',borderRadius:12,padding:8},button:{backgroundColor:'#FFF5E7',paddingVertical:14,borderRadius:32,alignItems:'center',justifyContent:'center'},label:{color:'#BD5331',fontSize:24,fontWeight:'800'},claimLabel:{position:'absolute'},
  giftIntro:{position:'absolute',left:24,right:24},giftHeading:{fontSize:27,lineHeight:36,fontWeight:'800',color:'#FFF9EF',textAlign:'center'},giftPrize:{position:'absolute',left:24,right:24,gap:18},giftName:{fontSize:23,lineHeight:31,color:'#FFF9EF',fontWeight:'700',textAlign:'center'},giftButton:{backgroundColor:'#FFC64A',borderRadius:22,borderBottomWidth:4,borderBottomColor:'#D99B66'},giftButtonText:{color:'#553019',fontSize:23,fontWeight:'800'},empty:{position:'absolute',left:30,right:30,color:'#FFF9EF',fontSize:22,lineHeight:30,textAlign:'center'},pressed:{transform:[{translateY:3}],opacity:.85},busy:{opacity:.6},
});

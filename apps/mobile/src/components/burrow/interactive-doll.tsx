import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import type { BurrowArtAsset } from '@/lib/burrow-art-assets';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { haptics } from '@/lib/haptics';
import { RoomPhoto } from './room-photo';
import { dollFaceRect } from '@/lib/burrow-doll-face';

type DollPhoto = MajorUpdateBootstrap['roomPhotos'][number] | undefined;
type HeartParticle = { id: number; drift: number; rise: number; delay: number; size: number; originX: number; originY: number };
export type DollAction = { kind: 'squeeze' | 'punch'; token: number };

function FloatingHeart({ particle, onDone }: { particle: HeartParticle; onDone: (id: number) => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      delay: particle.delay,
      duration: 2200,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => { if (finished) onDone(particle.id); });
    return () => animation.stop();
  }, [onDone, particle, progress]);
  return <Animated.Text pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.heart, { left:particle.originX, top:particle.originY, fontSize: particle.size, opacity: progress.interpolate({ inputRange: [0, .08, .82, 1], outputRange: [0, 1, 1, 0] }),
      transform: [
        { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, particle.drift] }) },
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -particle.rise] }) },
        { scale: progress.interpolate({ inputRange: [0, .3, 1], outputRange: [.55, 1.15, .8] }) },
      ] }]}>{particle.id % 3 === 0 ? '💕' : '♥'}</Animated.Text>;
}

/** Squash the costume as one layer while counter-scaling the face photo. */
export function InteractiveDoll({ asset, photo, style, artStyle, onInteract, onEditPhoto, action, pulse = 0, disabled = false }: {
  asset: BurrowArtAsset;
  photo?: DollPhoto;
  style: StyleProp<ViewStyle>;
  artStyle: StyleProp<ViewStyle>;
  onInteract?: () => void;
  onEditPhoto?: () => void;
  action?: DollAction;
  pulse?: number;
  disabled?: boolean;
}) {
  const offset = useRef(new Animated.ValueXY()).current;
  const pressed = useRef(new Animated.Value(0)).current;
  const punch = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(0)).current;
  const startedAt = useRef(0);
  const moved = useRef(false);
  const onInteractRef = useRef(onInteract);
  const onEditPhotoRef = useRef(onEditPhoto);
  onInteractRef.current = onInteract;
  onEditPhotoRef.current = onEditPhoto;
  const [hearts, setHearts] = useState<HeartParticle[]>([]);
  const [stageSize,setStageSize]=useState({width:300,height:300});
  const nextHeart = useRef(0);
  const lastFeedback=useRef(0);
  const emitHearts = (count = 5) => {
    const batch = Array.from({ length: count }, (_, index) => ({
      id: nextHeart.current++, drift: (index - (count - 1) / 2) * stageSize.width * .065 + (Math.random() - .5) * stageSize.width * .045,
      rise: stageSize.height * (.30 + index * .035), delay: index * 52,
      size: Math.max(12,Math.min(28,stageSize.width*.055 + index%3*3)),
      originX: stageSize.width/2 - 15, originY: stageSize.height*.12,
    }));
    setHearts(previous => [...previous.slice(-16), ...batch]);
  };
  useEffect(() => {
    if (!action?.token) return;
    const isPunch = action.kind === 'punch';
    emitHearts(isPunch ? 7 : 5);
    void (isPunch ? haptics.medium() : haptics.light());
    pressed.stopAnimation(); punch.stopAnimation(); tilt.stopAnimation();
    Animated.parallel([
      Animated.sequence([
        Animated.timing(pressed, { toValue: 1, duration: isPunch ? 65 : 160, useNativeDriver: true }),
        Animated.spring(pressed, { toValue: 0, damping: isPunch ? 5 : 7, stiffness: isPunch ? 190 : 155, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(punch, { toValue: isPunch ? 1 : 0, duration: 65, useNativeDriver: true }),
        Animated.spring(punch, { toValue: 0, damping: 5, stiffness: 190, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(tilt, { toValue: isPunch ? -1 : .2, duration: 65, useNativeDriver: true }),
        Animated.spring(tilt, { toValue: 0, damping: 5, stiffness: 170, useNativeDriver: true }),
      ]),
    ]).start();
  }, [action?.token]);
  useEffect(()=>{
    if(pulse<1)return;
    emitHearts(5);
    Animated.sequence([
      Animated.timing(pressed,{toValue:1,duration:125,useNativeDriver:true}),
      Animated.spring(pressed,{toValue:0,damping:7,stiffness:155,useNativeDriver:true}),
    ]).start();
  },[pulse]);
  const removeHeart = useCallback((id: number) => setHearts(previous => previous.filter(heart => heart.id !== id)), []);
  const settle = (showFeedback: boolean) => {
    Animated.spring(offset, { toValue: { x: 0, y: 0 }, damping: 7, stiffness: 180, mass: .8, useNativeDriver: true }).start();
    Animated.spring(pressed, { toValue: 0, damping: 7, stiffness: 180, useNativeDriver: true }).start();
    Animated.spring(tilt, { toValue: 0, damping: 7, stiffness: 180, useNativeDriver: true }).start();
    if (!showFeedback || Date.now()-lastFeedback.current<250) return;
    lastFeedback.current=Date.now();
    emitHearts(moved.current ? 6 : 4);
    void haptics.light();
    onInteractRef.current?.();
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event,gesture) => !disabled && Math.abs(gesture.dx)+Math.abs(gesture.dy)>5,
    onPanResponderGrant: () => {
      startedAt.current = Date.now();
      moved.current = false;
      offset.setValue({ x: 0, y: 0 });
      Animated.spring(pressed, { toValue: 1, damping: 10, stiffness: 220, useNativeDriver: true }).start();
    },
    onPanResponderMove: (_event, gesture) => {
      if (Math.abs(gesture.dx) + Math.abs(gesture.dy) > 7) moved.current = true;
      offset.setValue({ x: Math.max(-38, Math.min(38, gesture.dx * .7)), y: Math.max(-26, Math.min(26, gesture.dy * .5)) });
      tilt.setValue(Math.max(-1,Math.min(1,gesture.dx / 90)));
    },
    onPanResponderRelease: () => settle(true),
    onPanResponderTerminate: () => settle(false),
    onPanResponderTerminationRequest: () => false,
  }), [disabled, offset, pressed]);
  const scaleX = Animated.add(pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 1.13] }), punch.interpolate({ inputRange: [0, 1], outputRange: [0, .1] }));
  const scaleY = Animated.add(pressed.interpolate({ inputRange: [0, 1], outputRange: [1, .86] }), punch.interpolate({ inputRange: [0, 1], outputRange: [0, -.11] }));
  const rotate = tilt.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-8deg', '0deg', '8deg'] });
  return <Pressable style={style} disabled={disabled} accessibilityRole="button" accessibilityLabel={hearts.length?'Toy sending hearts':'Play with our dolls'}
    accessibilityHint="Press or drag to make the dolls bounce and send little hearts." onLayout={event=>{const {width,height}=event.nativeEvent.layout;if(width!==stageSize.width||height!==stageSize.height)setStageSize({width,height});}} onPressIn={()=>Animated.spring(pressed,{toValue:1,damping:10,stiffness:220,useNativeDriver:true}).start()} onPress={()=>settle(true)} onPressOut={()=>Animated.spring(pressed,{toValue:0,damping:7,stiffness:180,useNativeDriver:true}).start()}>
    <View style={StyleSheet.absoluteFillObject} {...responder.panHandlers}>
    <Animated.View pointerEvents="none" style={[artStyle, { transform: [{ translateX: offset.x }, { translateY: offset.y }, { rotate }, { scaleX }, { scaleY }] }]}>
      <Animated.View style={[styles.photo, dollFaceRect(asset), { transform: [
        { scaleX: Animated.divide(1, scaleX) }, { scaleY: Animated.divide(1, scaleY) },
      ] }]}>{photo?<RoomPhoto photo={photo} circle />:<View style={styles.emptyFace}/>}</Animated.View>
      <Image source={asset.source} contentFit="fill" style={styles.fill} />
    </Animated.View>
    <View pointerEvents="none" style={styles.emitter}>{hearts.map(heart => <FloatingHeart key={heart.id} particle={heart} onDone={removeHeart} />)}</View>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  photo: { position: 'absolute', overflow: 'hidden' },
  emptyFace:{flex:1,backgroundColor:'#FFF9F0'},
  emitter: { ...StyleSheet.absoluteFillObject, overflow: 'visible', zIndex: 5 },
  heart: { position: 'absolute', width: 40, height: 45, color: '#F16A82', textShadowColor: '#FFF2E6', textShadowRadius: 5 },
});

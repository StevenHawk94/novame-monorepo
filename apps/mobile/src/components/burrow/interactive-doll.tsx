import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import type { BurrowArtAsset } from '@/lib/burrow-art-assets';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { haptics } from '@/lib/haptics';
import { RoomPhoto } from './room-photo';

type DollPhoto = MajorUpdateBootstrap['roomPhotos'][number] | undefined;
type HeartParticle = { id: number; drift: number; rise: number; delay: number; size: number };

function FloatingHeart({ particle, onDone }: { particle: HeartParticle; onDone: (id: number) => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      delay: particle.delay,
      duration: 1050,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => { if (finished) onDone(particle.id); });
    return () => animation.stop();
  }, [onDone, particle, progress]);
  return <Animated.Text pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.heart, { fontSize: particle.size, opacity: progress.interpolate({ inputRange: [0, .12, .75, 1], outputRange: [0, 1, .9, 0] }),
      transform: [
        { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, particle.drift] }) },
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -particle.rise] }) },
        { scale: progress.interpolate({ inputRange: [0, .3, 1], outputRange: [.55, 1.15, .8] }) },
      ] }]}>{particle.id % 3 === 0 ? '💕' : '♥'}</Animated.Text>;
}

/** A deliberately gentle version of ToySquish: the entire doll and its photo
 * move as one layer, so a person's face is never warped by a local shader. */
export function InteractiveDoll({ asset, photo, style, artStyle, onInteract, onEditPhoto, pulse = 0, disabled = false }: {
  asset: BurrowArtAsset;
  photo?: DollPhoto;
  style: StyleProp<ViewStyle>;
  artStyle: StyleProp<ViewStyle>;
  onInteract?: () => void;
  onEditPhoto?: () => void;
  pulse?: number;
  disabled?: boolean;
}) {
  const offset = useRef(new Animated.ValueXY()).current;
  const pressed = useRef(new Animated.Value(0)).current;
  const startedAt = useRef(0);
  const moved = useRef(false);
  const onInteractRef = useRef(onInteract);
  const onEditPhotoRef = useRef(onEditPhoto);
  onInteractRef.current = onInteract;
  onEditPhotoRef.current = onEditPhoto;
  const [hearts, setHearts] = useState<HeartParticle[]>([]);
  const nextHeart = useRef(0);
  const emitHearts = () => {
    const batch = Array.from({ length: 4 }, (_, index) => ({
      id: nextHeart.current++, drift: (index - 1.5) * 17 + (Math.random() - .5) * 9,
      rise: 42 + index * 9, delay: index * 65, size: 17 + index % 2 * 5,
    }));
    setHearts(previous => [...previous.slice(-12), ...batch]);
  };
  useEffect(() => {
    if (pulse < 1) return;
    emitHearts();
    Animated.sequence([
      Animated.timing(pressed, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.spring(pressed, { toValue: 0, damping: 7, stiffness: 180, useNativeDriver: true }),
    ]).start();
  }, [pulse]);
  const removeHeart = useCallback((id: number) => setHearts(previous => previous.filter(heart => heart.id !== id)), []);
  const settle = (showFeedback: boolean) => {
    Animated.spring(offset, { toValue: { x: 0, y: 0 }, damping: 7, stiffness: 180, mass: .8, useNativeDriver: true }).start();
    Animated.spring(pressed, { toValue: 0, damping: 7, stiffness: 180, useNativeDriver: true }).start();
    if (!showFeedback) return;
    emitHearts();
    void haptics.light();
    if (!moved.current && Date.now() - startedAt.current >= 700 && onEditPhotoRef.current) onEditPhotoRef.current();
    else onInteractRef.current?.();
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderGrant: () => {
      startedAt.current = Date.now();
      moved.current = false;
      offset.setValue({ x: 0, y: 0 });
      Animated.spring(pressed, { toValue: 1, damping: 10, stiffness: 220, useNativeDriver: true }).start();
    },
    onPanResponderMove: (_event, gesture) => {
      if (Math.abs(gesture.dx) + Math.abs(gesture.dy) > 7) moved.current = true;
      offset.setValue({ x: Math.max(-13, Math.min(13, gesture.dx * .38)), y: Math.max(-9, Math.min(9, gesture.dy * .32)) });
    },
    onPanResponderRelease: () => settle(true),
    onPanResponderTerminate: () => settle(false),
    onPanResponderTerminationRequest: () => false,
  }), [disabled, offset, pressed]);
  const scaleX = pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] });
  const scaleY = pressed.interpolate({ inputRange: [0, 1], outputRange: [1, .97] });
  return <View style={style} accessibilityRole="button" accessibilityLabel="Play with our dolls. Hold to change their photo."
    accessibilityHint="Press or drag to make the dolls bounce and send little hearts." {...responder.panHandlers}>
    <Animated.View pointerEvents="none" style={[artStyle, { transform: [{ translateX: offset.x }, { translateY: offset.y }, { scaleX }, { scaleY }] }]}>
      <Animated.View style={[styles.photo, { transform: [
        { scaleX: Animated.divide(1, scaleX) }, { scaleY: Animated.divide(1, scaleY) },
      ] }]}><RoomPhoto photo={photo} circle /></Animated.View>
      <Image source={asset.source} contentFit="fill" style={styles.fill} />
    </Animated.View>
    <View pointerEvents="none" style={styles.emitter}>{hearts.map(heart => <FloatingHeart key={heart.id} particle={heart} onDone={removeHeart} />)}</View>
  </View>;
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  photo: { position: 'absolute', top: '25%', left: '29%', width: '42%', height: '30%', borderRadius: 100, overflow: 'hidden' },
  emitter: { position: 'absolute', top: 0, left: '50%', width: 1, height: 1, overflow: 'visible', zIndex: 5 },
  heart: { position: 'absolute', color: '#F16A82', textShadowColor: '#FFF2E6', textShadowRadius: 5 },
});

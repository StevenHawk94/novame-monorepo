/**
 * Soap-bubble overlay for Home (design: Home-with bubble.png / Home-bubble
 * pop.png). Renders up to five floating bubbles, each holding a friend's
 * item from today. Tap → pop (scale-up + fade, light haptic); public items
 * then show a centered memory card (item tile + text + friend attribution),
 * dismissed by tapping anywhere.
 *
 * Layout: five fixed slots (fractions of the overlay, matching the design's
 * composition) with a deterministic per-bubble jitter so the arrangement is
 * stable all day but not grid-like. The overlay itself is pointerEvents
 * box-none — only the bubbles and the open card swallow touches, so the pet,
 * top bar, and Focus/Reflect stay tappable through it.
 *
 * Animations run on reanimated shared values (UI thread): a slow vertical
 * bob with a per-bubble phase offset, and a one-shot pop. No layout thrash.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Image } from 'react-native';
import { XP_RULES } from '@novame/engine';

import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import { markPopped, submitBubblePop, type MemoryBubble } from '@/lib/home-bubbles';
import { ItemSprite } from '@/components/ui/item-sprite';

const BUBBLE_SIZE = 84;

/** Slot centers as fractions of the overlay box — mirrors the design mock. */
const SLOTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0.26, y: 0.1 },
  { x: 0.7, y: 0.13 },
  { x: 0.11, y: 0.45 },
  { x: 0.84, y: 0.48 },
  { x: 0.85, y: 0.66 },
];

function jitter(seed: string, range: number): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 2 * range;
}

type Props = {
  bubbles: MemoryBubble[];
  /** Parent removes the popped bubble from its list after the animation. */
  onPopped: (bubbleId: string) => void;
};

export function MemoryBubbles({ bubbles, onPopped }: Props) {
  const [card, setCard] = useState<MemoryBubble | null>(null);
  // Collect effects: a "+5 🍀" floats up from each popped bubble's spot.
  const [rewards, setRewards] = useState<{ id: string; left: number; top: number }[]>([]);

  const handlePopFinished = useCallback(
    (bubble: MemoryBubble, pos: { left: number; top: number }) => {
      markPopped(bubble.id);
      // Server-authoritative +5 (idempotent, capped). Fire-and-forget: the
      // pop already happened visually; the balance shows it on next refresh.
      void submitBubblePop(bubble);
      setRewards((cur) => [...cur, { id: bubble.id, ...pos }]);
      onPopped(bubble.id);
      if (bubble.isPublic) setCard(bubble);
    },
    [onPopped],
  );

  const removeReward = useCallback((id: string) => {
    setRewards((cur) => cur.filter((r) => r.id !== id));
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {bubbles.map((b, i) => (
        <FloatingBubble
          key={b.id}
          bubble={b}
          slot={SLOTS[i % SLOTS.length]}
          onPopFinished={handlePopFinished}
        />
      ))}

      {rewards.map((r) => (
        <PopReward key={r.id} left={r.left} top={r.top} onDone={() => removeReward(r.id)} />
      ))}

      {card && (
        <Pressable style={styles.cardBackdrop} onPress={() => setCard(null)}>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <ItemSprite itemId={card.itemId} size={72} radius={12} />
              <View style={styles.cardBody}>
                <Text style={styles.cardText}>{card.itemName}</Text>
                <Text style={styles.cardFriend}>{card.friendName}</Text>
              </View>
            </View>
          </View>
        </Pressable>
      )}
    </View>
  );
}

function FloatingBubble({
  bubble,
  slot,
  onPopFinished,
}: {
  bubble: MemoryBubble;
  slot: { x: number; y: number };
  onPopFinished: (b: MemoryBubble, pos: { left: number; top: number }) => void;
}) {
  const { width, height } = useWindowDimensions();
  const bob = useSharedValue(0);
  const popScale = useSharedValue(1);
  const popOpacity = useSharedValue(1);
  const [popping, setPopping] = useState(false);

  useEffect(() => {
    // Slow bob, phase-shifted per bubble so they don't move in lockstep.
    const phaseMs = Math.abs(Math.round(jitter(bubble.id + 'phase', 900)));
    bob.value = withDelay(
      phaseMs,
      withRepeat(
        withSequence(
          withTiming(-7, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
          withTiming(7, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      ),
    );
  }, [bob, bubble.id]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bob.value }, { scale: popScale.value }],
    opacity: popOpacity.value,
  }));

  const onPress = () => {
    if (popping) return;
    setPopping(true);
    void haptics.light();
    popScale.value = withTiming(1.25, { duration: 140, easing: Easing.out(Easing.quad) });
    popOpacity.value = withTiming(0, { duration: 160 }, (finished) => {
      if (finished) runOnJS(onPopFinished)(bubble, { left, top });
    });
  };

  // Slot fraction → absolute px, clamped so the bubble never leaves the box
  // on narrow screens (the safe-area concern from the design brief).
  const cx = slot.x + jitter(bubble.id + 'x', 0.03);
  const cy = slot.y + jitter(bubble.id + 'y', 0.03);
  const left = Math.min(Math.max(cx * width - BUBBLE_SIZE / 2, 6), width - BUBBLE_SIZE - 6);
  const top = Math.min(Math.max(cy * height - BUBBLE_SIZE / 2, 0), height - BUBBLE_SIZE);

  return (
    <Animated.View style={[styles.bubbleWrap, { left, top }, animStyle]}>
      <Pressable onPress={onPress} hitSlop={6} style={styles.bubble}>
        <View style={styles.fogRing} />
        <View style={styles.shineLarge} />
        <View style={styles.shineSmall} />
        <View style={styles.shineLeft} />
        <ItemSprite itemId={bubble.itemId} size={48} radius={12} tileColor="transparent" />
      </Pressable>
      <View pointerEvents="none" style={styles.fogHalo} />
    </Animated.View>
  );
}

/** "+5 🍀" that rises and fades from a popped bubble — the collect beat. */
function PopReward({ left, top, onDone }: { left: number; top: number; onDone: () => void }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: 850, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: -52 * t.value },
      { scale: 0.8 + 0.35 * Math.min(1, t.value * 3) },
    ],
    opacity: t.value < 0.6 ? 1 : 1 - (t.value - 0.6) / 0.4,
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.rewardWrap, { left, top: top + 18 }, style]}>
      <Text style={styles.rewardText}>+{XP_RULES.bubble.award}</Text>
      <Image source={ICONS.Clover} style={styles.rewardClover} resizeMode="contain" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubbleWrap: { position: 'absolute', width: BUBBLE_SIZE, height: BUBBLE_SIZE },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Two white glints, upper-right, like the design's soap bubbles.
  shineLarge: {
    position: 'absolute',
    top: 10,
    right: 14,
    width: 22,
    height: 8,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.85)',
    transform: [{ rotate: '-28deg' }],
  },
  shineSmall: {
    position: 'absolute',
    top: 22,
    right: 9,
    width: 10,
    height: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.7)',
    transform: [{ rotate: '-28deg' }],
  },
  bubbleEmoji: { fontSize: 34 },
  // Frosted rim (mock 2026-08-08): a wide translucent band inside the edge +
  // a soft halo just outside fake the fogged-glass look without blur support.
  fogRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: BUBBLE_SIZE / 2,
    borderWidth: 7,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  fogHalo: {
    position: 'absolute',
    top: -3, left: -3, right: -3, bottom: -3,
    borderRadius: (BUBBLE_SIZE + 6) / 2,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  shineLeft: {
    position: 'absolute',
    bottom: 16,
    left: 10,
    width: 12,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.55)',
    transform: [{ rotate: '30deg' }],
  },
  rewardWrap: {
    position: 'absolute',
    width: BUBBLE_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  rewardText: {
    fontSize: 22,
    fontFamily: 'Inter_800ExtraBold',
    color: '#2E7A3A',
    textShadowColor: '#FFFFFF',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 0 },
  },
  rewardClover: { width: 24, height: 24 },

  cardBackdrop: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  card: {
    width: '86%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 3,
    borderColor: '#E8A98B',
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  cardRow: { flexDirection: 'row', gap: 14 },
  cardItemTile: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: '#F4F1F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardItemEmoji: { fontSize: 40 },
  cardBody: { flex: 1, justifyContent: 'space-between' },
  cardText: { fontSize: 17, lineHeight: 24, color: '#2B2B2B', fontFamily: 'Inter_500Medium' },
  cardFriend: {
    alignSelf: 'flex-end',
    fontSize: 15,
    color: '#1F1F1F',
    fontFamily: 'Inter_700Bold',
  },
});

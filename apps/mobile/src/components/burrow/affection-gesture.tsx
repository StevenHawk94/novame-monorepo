import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { useIsFocused } from '@react-navigation/native';
import UIAnimated, { cancelAnimation, Easing, ReduceMotion, runOnJS, useAnimatedProps, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
// matrix is the native SVG prop, intentionally bypassing JS transform parsing.
const NativeG=UIAnimated.createAnimatedComponent(G<{matrix?:number[]}>);
const NativePath=UIAnimated.createAnimatedComponent(Path);
const NativeCircle=UIAnimated.createAnimatedComponent(Circle);
const NativeRect=UIAnimated.createAnimatedComponent(Rect);
import { LinearGradient as CardGradient } from 'expo-linear-gradient';
import type { AffectionType } from '@novame/domain';
import { haptics } from '@/lib/haptics';
import { AffectionSentVisual } from './affection-sent-visual';
import { Image } from './burrow-image';

const GESTURE_FINGER=require('../../../assets/burrow-webp/affection page icons/finger.webp');

type Copy = { label: string; symbol: string; hint: string; heading: string; instruction: string; encouragement: string; footnote: string; pageTitle: string };
export const AFFECTION_COPY: Record<AffectionType, Copy> = {
  hug: { label: 'Hug', symbol: '♥', hint: 'Press and hold until the hearts meet', heading: 'Hold Your Hug Close', instruction: 'Press and hold until the hearts meet', encouragement: 'Keep holding until the hearts meet', footnote: 'Hold for 3 seconds', pageTitle: 'Send a Hug' },
  spicy: { label: 'Spice', symbol: '♥', hint: 'Tap ten times', heading: 'Turn Up the Heat', instruction: 'Tap ten times', encouragement: 'Each tap makes the heart grow', footnote: 'Sends on the 10th tap', pageTitle: 'Send Some Spice' },
  cuddle: { label: 'Cuddle', symbol: '♥', hint: 'Sway left and right ten times', heading: 'Rock It Into a Cuddle', instruction: 'Sway left and right ten times', encouragement: 'The heart fills as you sway', footnote: 'Sends after the tenth sway', pageTitle: 'Send a Cuddle' },
  gratitude: { label: 'Gratitude', symbol: '♥', hint: 'Pinch two fingers in and hold', heading: 'Bring Your Thanks Together', instruction: 'Pinch two fingers in and hold', encouragement: 'Hold when your fingers meet', footnote: 'Hold for 3 seconds', pageTitle: 'Send Gratitude' },
  kiss: { label: 'Kiss', symbol: '♥', hint: 'Spread two fingers apart and hold', heading: 'Make Your Kiss Bigger', instruction: 'Spread two fingers apart and hold', encouragement: 'The kiss grows while you hold', footnote: 'Hold for 3 seconds', pageTitle: 'Send a Kiss' },
  miss_you: { label: 'Miss You', symbol: '♥', hint: 'Draw a heart in one stroke', heading: 'Trace the Distance Closed', instruction: 'Draw a heart in one stroke', encouragement: 'Follow the shape in one stroke', footnote: 'Lift to send when complete', pageTitle: 'Say I Miss You' },
};

export const AFFECTION_SENT_COPY: Record<AffectionType, { title: string; description: (name: string) => string }> = {
  kiss: { title: 'Kiss Sent', description: name => `Your kiss is on its way to ${name}.` },
  hug: { title: 'Hug Sent', description: name => `A warm hug is on its way to ${name}.` },
  spicy: { title: 'Spice Sent', description: name => `Ten sparks are flying over to ${name}.` },
  cuddle: { title: 'Cuddle Sent', description: name => `All that warmth is heading to ${name}.` },
  gratitude: { title: 'Gratitude Sent', description: name => `Your thanks are on their way to ${name}.` },
  miss_you: { title: 'Miss You Sent', description: name => `${name} will know you were thinking of them.` },
};

const DURATION_MS = 3000;
type Point = [number, number];
const heartCurves: [Point, Point, Point, Point][] = [
  [[150, 200], [98, 166], [76, 128], [76, 104]],
  [[76, 104], [76, 78], [100, 66], [120, 72]],
  [[120, 72], [136, 77], [146, 90], [150, 104]],
  [[150, 104], [154, 90], [164, 77], [180, 72]],
  [[180, 72], [200, 66], [224, 78], [224, 104]],
  [[224, 104], [224, 128], [202, 166], [150, 200]],
];
function pointOnCurve([a, b, c, d]: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t;
  return [0, 1].map(i => u ** 3 * a[i] + 3 * u ** 2 * t * b[i] + 3 * u * t ** 2 * c[i] + t ** 3 * d[i]) as Point;
}
// Dense checkpoints keep the drawn contour tied to the finger instead of
// jumping between nine coarse positions. The same samples estimate dash length.
export const HEART_TRACE_POINTS: Point[] = [[150 / 300, 200 / 250], ...heartCurves.flatMap(curve =>
  Array.from({ length: 8 }, (_, index) => {
    const [x, y] = pointOnCurve(curve, (index + 1) / 8);
    return [x / 300, y / 250] as Point;
  }))];
const HEART_PATH_LENGTH = HEART_TRACE_POINTS.slice(1).reduce((sum, [x, y], index) => {
  const [px, py] = HEART_TRACE_POINTS[index];
  return sum + Math.hypot((x - px) * 300, (y - py) * 250);
}, 0);
type GestureState = {
  startedAt: number; touching: boolean; released: boolean; qualified: boolean; assisted: boolean;
  twoFingers: boolean;
  taps: number; turns: number; travel: number; direction: number; lastX: number;
  pathPoints: number; initialDistance: number; maxScale: number; inwardAt: number; outwardAt: number; close: number;
};
const freshGesture = (): GestureState => ({ startedAt: 0, touching: false, released: false, qualified: false,
  assisted: false, twoFingers: false, taps: 0, turns: 0, travel: 0, direction: 0, lastX: 0,
  pathPoints: 0, initialDistance: 0, maxScale: 1, inwardAt: 0, outwardAt: 0, close: 0 });

function Finger({ flip = false }: { flip?: boolean }) {
  return <Image source={GESTURE_FINGER} contentFit="contain" accessible={false}
    style={{width:76,height:114,transform:[{scaleX:flip?-1:1}]}}/>;
}

// Start the contour at its bottom point so Miss You can be traced in one stroke.
const HEART_D = 'M150 200 C98 166 76 128 76 104 C76 78 100 66 120 72 C136 77 146 90 150 104 C154 90 164 77 180 72 C200 66 224 78 224 104 C224 128 202 166 150 200 Z';
const LIPS_D = 'M45 130 C80 100 121 104 150 120 C179 104 220 100 255 130 C220 165 180 177 150 171 C120 177 80 165 45 130Z';

export function kissArtScale(progress: number) {
  'worklet';
  const value = Math.max(0, Math.min(1, progress));
  // Lips span x=45..255 in a 300px viewBox. At 1.24x they retain ~20px
  // of transparent breathing room on both sides instead of clipping flat.
  // Same endpoints/safe bounds; spread the existing growth over the full hold
  // instead of easing almost to maximum before the hold has completed.
  return .82 + .42 * value;
}

export function cuddleFill(progress: number) {
  'worklet';
  // The visible heart extends from just above y=72 to y=200, not y=32..202.
  // Keep its top uncovered through 9/10; only the tenth sway fills it fully.
  const height = 130 * Math.max(0, Math.min(1, progress));
  return { y: 200 - height, height };
}

export function hugArtPose(progress: number, side: -1 | 1) {
  'worklet';
  const p = Math.max(0, Math.min(1, progress));
  // Both translation and scale advance uniformly for the entire hold. Keep
  // the existing endpoints, with complete coincidence only on the last frame.
  const scale = .56 + .26 * p;
  const distance = 62 * (1 - p);
  return { matrix: [scale, 0, 0, scale, 150 * (1 - scale) + side * distance, 130 * (1 - scale)] };
}

/** The SVG layers use the same heart/lip vocabulary as the supplied HTML. */
function GestureArt({ type, progress, taps }: { type: AffectionType; progress: SharedValue<number>; taps: number }) {
  const heart = <Path d={HEART_D} fill="url(#love)"/>;
  const glow=useAnimatedProps(()=>({opacity:type==='cuddle'?progress.value*.85:type==='miss_you'?progress.value*.7:.12+progress.value*.82}));
  const clip=useAnimatedProps(()=>cuddleFill(progress.value));
  const marks=useAnimatedProps(()=>({opacity:progress.value}));
  const trace=useAnimatedProps(()=>({strokeDashoffset:HEART_PATH_LENGTH*(1-progress.value)}));
  const traceFill=useAnimatedProps(()=>({fillOpacity:progress.value>=1?1:0}));
  const startDot=useAnimatedProps(()=>({opacity:progress.value===0?1:0}));
  const left=useAnimatedProps(()=>hugArtPose(progress.value,-1));
  const right=useAnimatedProps(()=>hugArtPose(progress.value,1));
  const main=useAnimatedProps(()=>{
    const s=type==='spicy'?.82+taps*.034:type==='gratitude'?.6+progress.value*.62:type==='kiss'?kissArtScale(progress.value):1;
    return {matrix:[s,0,0,s,150*(1-s),130*(1-s)]};
  });
  return <Svg width="100%" height="100%" viewBox="0 0 300 250" pointerEvents="none">
    <Defs>
      <LinearGradient id="love" x1="0" y1="0" x2="0.4" y2="1"><Stop offset="0" stopColor="#FF9A9F"/><Stop offset="0.52" stopColor="#F76D80"/><Stop offset="1" stopColor="#EA4B66"/></LinearGradient>
      <LinearGradient id="soft" x1="0" y1="0" x2="0.4" y2="1"><Stop offset="0" stopColor="#FFD9D2"/><Stop offset="1" stopColor="#F7ACA9"/></LinearGradient>
      <LinearGradient id="lips" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FF828E"/><Stop offset="1" stopColor="#E94D68"/></LinearGradient>
      <RadialGradient id="gestureGlow" cx="50%" cy="50%" rx="50%" ry="50%"><Stop offset="0" stopColor="#FF8E92" stopOpacity="0.48"/><Stop offset="1" stopColor="#FF8E92" stopOpacity="0"/></RadialGradient>
      <ClipPath id="warmClip"><NativeRect animatedProps={clip} x="0" width="300"/></ClipPath>
    </Defs>
    <NativeCircle cx="150" cy="129" r="118" fill="url(#gestureGlow)" animatedProps={glow}/>
    {type==='hug'?<>
      <NativeG animatedProps={left}>{heart}</NativeG><NativeG animatedProps={right}>{heart}</NativeG>
      <NativePath d="M150 43 V29 M112 48 L104 36 M188 48 L196 36" stroke="#F66C7B" strokeWidth="5" strokeLinecap="round" animatedProps={marks}/>
    </>:type==='miss_you'?<>
      <NativePath d={HEART_D} fill="url(#love)" stroke="#F9C2C5" strokeWidth="5" strokeDasharray="3 14" animatedProps={traceFill}/>
      <NativePath d={HEART_D} fill="none" stroke="#F05A75" strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${HEART_PATH_LENGTH} ${HEART_PATH_LENGTH}`} animatedProps={trace}/>
      <NativeCircle cx="150" cy="200" r="6" fill="#F05A75" animatedProps={startDot}/>
    </>:type==='kiss'?<NativeG animatedProps={main}>
      <Path d={LIPS_D} fill="url(#lips)"/><Path d="M150 153 C136 140 134 133 143 130 C148 129 150 133 150 136 C150 133 153 129 158 130 C167 133 164 140 150 153Z" fill="#FFD1D5"/>
    </NativeG>:type==='cuddle'?<G transform="translate(150,130) scale(.94) translate(-150,-130)">
      <Path d={HEART_D} fill="url(#soft)"/><Path d={HEART_D} fill="url(#love)" clipPath="url(#warmClip)"/>
    </G>:<NativeG animatedProps={main}>{heart}{type==='spicy'&&<>
      <Path d="M145 187 C121 157 143 146 148 125 C161 140 160 146 155 155 C177 141 168 121 174 110 C205 140 188 180 161 192 C166 170 156 161 153 157 C153 173 149 179 145 187Z" fill="#FFB24D"/>
      <Path d="M151 178 C144 164 151 155 153 147 C158 154 162 161 159 178Z" fill="#FFE499"/>
    </>}</NativeG>}
  </Svg>;
}

function GestureGuides({ type }: { type: AffectionType }) {
  if (type !== 'kiss' && type !== 'cuddle') return null;
  return <Svg width="100%" height="100%" viewBox="0 0 300 250" pointerEvents="none" style={styles.guide}>
    {type === 'kiss' ? <Path d="M150 42 V28 M111 53 L102 40 M189 53 L198 40 M52 129 H26 M52 129 L37 118 M52 129 L37 140 M248 129 H274 M248 129 L263 118 M248 129 L263 140" stroke="#F36F7D" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8"/>
      : <Path d="M66 40 H234 M66 40 L79 28 M66 40 L79 52 M234 40 L221 28 M234 40 L221 52" stroke="#F36F7D" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.75"/>}
  </Svg>;
}

const seenHints = new Set<AffectionType>();
function GestureDemo({ type, visible }: { type: AffectionType; visible: boolean }) {
  const motion = useRef(new Animated.Value(0)).current;
  const focused = useIsFocused();
  const [reduced, setReduced] = useState(false);
  const [shown, setShown] = useState(() => !seenHints.has(type));
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduced(value); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { live = false; sub.remove(); };
  }, []);
  useEffect(() => {
    if (!visible || !shown || !focused) {
      if (seenHints.has(type)) setShown(false);
      return;
    }
    seenHints.add(type);
    if (reduced) { setShown(false); return; }
    motion.setValue(0);
    const demo = Animated.timing(motion, { toValue: 1, duration: type === 'miss_you' ? 2600 : 1800, useNativeDriver: true });
    demo.start(({ finished }) => { if (finished) setShown(false); });
    return () => { demo.stop(); motion.stopAnimation(); };
  }, [visible, shown, reduced, focused, type, motion]);
  if (!visible || !shown) return null;
  const finger = (key: string, x: Animated.AnimatedInterpolation<number> | number,
    y: Animated.AnimatedInterpolation<number> | number, flip = false) =>
    <Animated.View key={key} pointerEvents="none" style={[styles.finger, { transform: [{ translateX: x }, { translateY: y }] }]}>
      <View style={{position:'absolute',left:flip?-53:-23,top:-10}}>
      <Svg width={90} height={80} viewBox="0 0 90 80" style={[styles.hintRing,{left:flip?3:-27}]}>
        {[12, 22, 32].map((radius, index) => <Circle key={radius} cx="50" cy="41" r={radius} fill="none" stroke="#F4707E" strokeWidth="2.4" opacity={.55 - index * .13}/>)}
      </Svg>
      <Finger flip={flip}/>
      </View>
    </Animated.View>;
  const inward = motion.interpolate({ inputRange: [0, 1], outputRange: [-83, -23] });
  const inwardRight = motion.interpolate({ inputRange: [0, 1], outputRange: [83, 23] });
  const outward = motion.interpolate({ inputRange: [0, 1], outputRange: [-20, -92] });
  const outwardRight = motion.interpolate({ inputRange: [0, 1], outputRange: [20, 92] });
  const sweep = motion.interpolate({ inputRange: [0, .5, 1], outputRange: [-55, 55, -55] });
  const tap = motion.interpolate({ inputRange: [0, .55, 1], outputRange: [18, -8, 18] });
  const traceX = motion.interpolate({ inputRange: [0, .125, .25, .375, .5, .625, .75, .875, 1], outputRange: [0, -42, -75, -56, 0, 56, 75, 42, 0] });
  const traceY = motion.interpolate({ inputRange: [0, .125, .25, .375, .5, .625, .75, .875, 1], outputRange: [70, 27, -30, -63, -30, -63, -30, 27, 70] });
  return <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
    {type === 'gratitude' ? <>{finger('left', inward, 0, true)}{finger('right', inwardRight, 0)}</> :
      type === 'kiss' ? <>{finger('left', outward, 0, true)}{finger('right', outwardRight, 0)}</> :
        type === 'cuddle' ? finger('stroke', sweep, 0) :
          type === 'miss_you' ? finger('trace', traceX, traceY) : finger('press', 0, tap)}
  </View>;
}

function TapSparks({ count }: { count: number }) {
  const motion = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!count) return;
    motion.setValue(0);
    const animation = Animated.timing(motion, { toValue: 1, duration: 620, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [count, motion]);
  if (!count) return null;
  return <View pointerEvents="none" style={styles.sparkCenter}>
    {Array.from({ length: 8 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 8;
      return <Animated.View key={index} style={[styles.tapSpark, {
        backgroundColor: index % 2 ? '#F46F83' : '#FFC25F',
        opacity: motion.interpolate({ inputRange: [0, .2, 1], outputRange: [0, 1, 0] }),
        transform: [
          { translateX: motion.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * 77] }) },
          { translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * 67] }) },
          { scale: motion.interpolate({ inputRange: [0, .2, 1], outputRange: [.3, 1, .45] }) },
        ],
      }]}/>;
    })}
  </View>;
}

export function AffectionGesture({ type, disabled, status = 'ready', recipientName = 'your person', onComplete, onDone }: {
  type: AffectionType; disabled: boolean; status?: 'ready' | 'sending' | 'sent'; recipientName?: string;
  onComplete: (metrics: Record<string, number>) => void; onDone?: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const progressMotion=useSharedValue(0),announcedProgress=useRef(-1);
  const [taps, setTaps] = useState(0);
  const [working, setWorking] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;
  const swayMotion = useRef(new Animated.Value(0)).current;
  const focused = useIsFocused();
  const callback = useRef(onComplete); callback.current = onComplete;
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const interactive = useRef(focused && AppState.currentState === 'active');
  interactive.current = focused && AppState.currentState === 'active';
  const gesture = useRef<GestureState>(freshGesture());
  const completed = useRef(false);
  const timeline = useRef({ key: '', generation: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastHapticAt = useRef(0);
  const padSize = useRef({ width: 300, height: 250 });
  const stopTimer = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  const returnSway = () => {
    Animated.spring(swayMotion, { toValue: 0, friction: 5, tension: 75, useNativeDriver: true }).start();
  };
  const reset = () => { stopTimer(); timeline.current = { key: '', generation: timeline.current.generation + 1 }; cancelAnimation(progressMotion);progressMotion.value=0;announcedProgress.current=-1; gesture.current = freshGesture(); lastHapticAt.current = 0; setProgress(0); setTaps(0); setWorking(false); pulse.setValue(1); swayMotion.stopAnimation(); swayMotion.setValue(0); };
  const finish = () => {
    if (completed.current || !interactive.current) return;
    completed.current = true;
    const g = gesture.current;
    const durationMs = Math.round(performance.now() - g.startedAt);
    stopTimer();cancelAnimation(progressMotion);progressMotion.value=1;setProgress(1);setWorking(false);
    // Release the full heart from the finger immediately; the send animation
    // runs alongside this small spring rather than waiting for finger-up.
    if (type === 'cuddle') returnSway();
    void haptics.success().catch(() => {});
    callback.current(g.assisted ? { assistedHoldMs: Math.max(DURATION_MS, durationMs), durationMs: Math.max(DURATION_MS, durationMs) } : {
      durationMs, taps: g.taps, turns: g.turns, scale: g.maxScale,
      pathPoints: g.pathPoints, holdMs: g.inwardAt || g.outwardAt ? Math.round(performance.now() - (g.inwardAt || g.outwardAt)) : 0,
    });
  };
  const visualComplete = (generation: number) => {
    if (timeline.current.generation !== generation || disabledRef.current || !interactive.current) return;
    finish();
  };
  const animateProgress = (key: string, target: number, duration: number, completes: boolean, start?: number) => {
    // One UI-thread clock per qualified hold/stroke. Pointer moves and the
    // haptic/accessibility timer must never keep restarting that clock.
    if (timeline.current.key === key) return;
    const generation = timeline.current.generation + 1;
    timeline.current = { key, generation };
    cancelAnimation(progressMotion);
    if (start !== undefined) progressMotion.value = start;
    progressMotion.value = withTiming(target, { duration, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, finished => {
      if (finished && completes) runOnJS(visualComplete)(generation);
    });
  };
  const refresh = () => {
    const g = gesture.current;
    if (!g.startedAt || completed.current || !interactive.current) return;
    const now = performance.now();
    const elapsed = now - g.startedAt;
    const next = g.assisted ? Math.min(1, elapsed / DURATION_MS)
      : type === 'hug' ? (g.touching ? Math.min(1, elapsed / DURATION_MS) : 0)
      : type === 'spicy' ? g.taps / 10
      : type === 'cuddle' ? Math.min(1, g.turns / 10)
      : type === 'gratitude' ? g.inwardAt && g.touching
        ? Math.min(1, .14 * g.close + .86 * (now - g.inwardAt) / DURATION_MS) : .14 * g.close
      : type === 'kiss' ? g.outwardAt && g.touching && g.twoFingers ? Math.min(1, (now - g.outwardAt) / DURATION_MS) : 0
      : Math.min(1, g.pathPoints / HEART_TRACE_POINTS.length);
    const holdStart = g.assisted || type === 'hug' && g.touching ? g.startedAt
      : type === 'gratitude' && g.touching && g.twoFingers ? g.inwardAt
      : type === 'kiss' && g.touching && g.twoFingers ? g.outwardAt : 0;
    if (holdStart) {
      animateProgress(`hold:${holdStart}`, 1, Math.max(0, DURATION_MS - (now - holdStart)), true, next);
    } else {
      const countsDone = type === 'spicy' && g.taps >= 10 || type === 'cuddle' && g.turns >= 10;
      animateProgress(`step:${next}`, next, 80, countsDone);
    }
    if(Math.floor(next*10)!==announcedProgress.current){announcedProgress.current=Math.floor(next*10);setProgress(next);}
    // A gentle, metered haptic train follows continuous holds. Counted gestures
    // vibrate only for each real tap, sway or traced checkpoint below.
    const continuous = holdStart && now - holdStart < DURATION_MS;
    if (continuous && now - lastHapticAt.current >= 175) {
      lastHapticAt.current = now;
      void haptics.selection().catch(() => {});
    }
  };
  const begin = () => {
    if (disabledRef.current || !interactive.current || completed.current) return false;
    if (!gesture.current.startedAt) {
      gesture.current.startedAt = performance.now();
      timer.current = setInterval(refresh, 100);
      setWorking(true);
    }
    return true;
  };
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') reset(); });
    return () => { sub.remove(); stopTimer(); timeline.current.generation++; cancelAnimation(progressMotion); swayMotion.stopAnimation(); };
  }, []);
  useEffect(() => { if (!focused) reset(); }, [focused]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => type !== 'spicy' && interactive.current && !disabledRef.current && !completed.current,
    onMoveShouldSetPanResponder: () => type !== 'spicy' && interactive.current && !disabledRef.current && !completed.current,
    onPanResponderGrant: event => {
      if (!begin()) return;
      const g = gesture.current;
      g.touching = true; g.released = false;
      if (type === 'cuddle') g.lastX = 0;
      if ((type === 'kiss' || type === 'gratitude') && event.nativeEvent.touches.length >= 2) {
        const touches = event.nativeEvent.touches;
        g.twoFingers = true;
        g.initialDistance = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
      }
      if (type === 'hug') g.qualified = true;
      refresh();
    },
    onPanResponderMove: (event, state) => {
      const g = gesture.current;
      if (!g.startedAt || !g.touching || !interactive.current || completed.current) return;
      const touches = event.nativeEvent.touches;
      if (type === 'kiss' || type === 'gratitude') g.twoFingers = touches.length >= 2;
      if ((type === 'kiss' || type === 'gratitude') && touches.length >= 2) {
        const distance = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
        if (!g.initialDistance) g.initialDistance = Math.max(distance, 18);
        const scale = distance / g.initialDistance;
        if (type === 'kiss') {
          g.maxScale = Math.max(g.maxScale, scale);
          if (scale >= 1.5) { if (!g.outwardAt) g.outwardAt = performance.now(); g.qualified = true; }
          else { g.outwardAt = 0; g.qualified = false; }
        } else {
          g.close = Math.max(0, Math.min(1, (1 - scale) / .5));
          if (scale <= .6) { if (!g.inwardAt) g.inwardAt = performance.now(); g.qualified = true; }
          else { g.inwardAt = 0; g.qualified = false; }
        }
      } else if (type === 'gratitude') { g.inwardAt = 0; g.qualified = false; g.close = 0; }
      else if (type === 'kiss') {
        g.outwardAt = 0; g.qualified = false;
      }
      if (type === 'cuddle') {
        const delta = state.dx - g.lastX;
        swayMotion.stopAnimation();
        swayMotion.setValue(Math.max(-45, Math.min(45, state.dx)));
        const threshold = Math.max(18, Math.min(40, padSize.current.width * 25 / 300));
        if (Math.abs(delta) >= threshold) {
          const direction = Math.sign(delta);
          g.travel += Math.abs(delta);
          if (direction !== g.direction && g.turns < 10) {
            g.turns++;
            if (g.turns < 10) void haptics.light().catch(() => {});
          }
          g.direction = direction;
          g.lastX = state.dx;
          g.qualified = g.turns >= 10;
        }
      }
      if (type === 'miss_you' && touches.length === 1) {
        const { width, height } = padSize.current;
        const scale = Math.min(width / 300, height / 250);
        const x = (event.nativeEvent.locationX - (width - 300 * scale) / 2) / scale / 300;
        const y = (event.nativeEvent.locationY - (height - 250 * scale) / 2) / scale / 250;
        for (let skipped = 0; skipped < 4; skipped++) {
          const point = HEART_TRACE_POINTS[g.pathPoints];
          if (!point || Math.hypot(x - point[0], y - point[1]) >= .12) break;
          g.pathPoints++;
          if (g.pathPoints % 4 === 0) void haptics.selection().catch(() => {});
        }
        g.qualified = g.pathPoints >= HEART_TRACE_POINTS.length;
      }
      refresh();
    },
    onPanResponderRelease: () => {
      const g = gesture.current;
      const traceDone = type === 'miss_you' && g.pathPoints >= HEART_TRACE_POINTS.length;
      g.touching = false; g.released = true;
      if (traceDone) { stopTimer(); animateProgress('trace:complete', 1, 80, true); return; }
      if (type === 'cuddle') {
        g.lastX = 0;
        if (!completed.current) returnSway();
        return;
      }
      if (!completed.current) reset();
      refresh();
    },
    onPanResponderEnd: event => {
      if ((type === 'kiss' || type === 'gratitude') && !completed.current
        && event.nativeEvent.touches.length < 2) reset();
    },
    onPanResponderTerminate: () => { if (!completed.current) reset(); },
    // A hold can complete while fingers are still down. Once inactive, let
    // the Sent page/button take ownership instead of retaining the old pad.
    onPanResponderTerminationRequest: () => completed.current || disabledRef.current || !interactive.current,
  }), [type]);
  const tap = () => {
    if (type !== 'spicy' || !begin()) return;
    const g = gesture.current;
    g.taps = Math.min(10, g.taps + 1);
    g.qualified = g.taps >= 10;
    setTaps(g.taps);
    pulse.setValue(1.18);
    Animated.spring(pulse, { toValue: 1, friction: 4, tension: 95, useNativeDriver: true }).start();
    if (g.taps < 10) void haptics.light().catch(() => {});
    refresh();
  };
  const accessibleSend = () => {
    if (!begin()) return;
    const g = gesture.current;
    g.assisted = true; g.qualified = true;
    refresh();
  };
  const copy = AFFECTION_COPY[type];
  const sentCopy = AFFECTION_SENT_COPY[type];
  const artMotion = type === 'spicy' ? { transform: [{ scale: pulse }] }
    : type === 'cuddle' ? { transform: [
      { translateX: swayMotion.interpolate({ inputRange: [-45, 0, 45], outputRange: [-20, 0, 20] }) },
      { rotate: swayMotion.interpolate({ inputRange: [-45, 0, 45], outputRange: ['-13deg', '0deg', '13deg'] }) },
    ] } : undefined;
  return <View style={styles.card}>
    <CardGradient pointerEvents="none" colors={['#FFF5EF', '#FFEBE5', '#FFF3ED']} locations={[0, .54, 1]} style={StyleSheet.absoluteFillObject}/>
    {status !== 'sent' ? <>
      <View style={styles.prompt}>
        <Text style={styles.heading}>{copy.heading}</Text>
        <Text style={styles.instruction}>{copy.instruction}</Text>
      </View>
      <View style={styles.stage} {...responder.panHandlers}
        onLayout={event => { padSize.current = event.nativeEvent.layout; }}
        accessible accessibilityRole="button" accessibilityLabel={`${copy.instruction}. Gesture area.`}
        accessibilityHint="Double tap to use the accessible three-second send option"
        accessibilityActions={[{ name: 'activate', label: 'Use accessible gesture' }]}
        onAccessibilityAction={accessibleSend}>
        <Animated.View pointerEvents="none" style={[styles.art, artMotion]}>
          <GestureArt type={type} progress={progressMotion} taps={taps}/>
        </Animated.View>
        {status === 'ready' && !working && !completed.current && <GestureGuides type={type}/>}
        <GestureDemo type={type} visible={status === 'ready' && !working && !completed.current}/>
        {type === 'spicy' && status === 'ready' && <>
          <TapSparks count={taps}/>
          <Pressable accessibilityRole="button" accessibilityLabel="Tap to add a spark" onPress={tap} style={StyleSheet.absoluteFillObject}/>
        </>}
      </View>
      <Text style={styles.footnote}>{copy.footnote}</Text>
      <View accessible accessibilityLabel={`Gesture progress ${Math.round(progress * 100)} percent`} style={styles.a11yProgress}/>
    </> : <View key="affection-sent" collapsable={false} style={styles.successContent}>
      <View style={styles.successVisual}>
        <AffectionSentVisual key={type} type={type}/>
      </View>
      <View style={styles.successWords}>
        <Text style={styles.sentTitle}>{sentCopy.title}</Text>
        <Text style={styles.sentBody}>{sentCopy.description(recipientName)}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={onDone} style={({ pressed }) => [styles.doneButton, pressed && styles.doneButtonPressed]}>
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  card: { flex: 1, backgroundColor: '#FFF0E9', borderRadius: 35, paddingHorizontal: 20, paddingTop: 26, paddingBottom: 28, alignItems: 'center', overflow: 'hidden' },
  prompt: { alignItems: 'center', gap: 6, width: '100%' },
  heading: { color: '#843B41', fontSize: 26, lineHeight: 32, fontWeight: '800', textAlign: 'center' },
  instruction: { color: '#B25260', fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  stage: { width: '100%', flex: 1, minHeight: 165, justifyContent: 'center', alignItems: 'center' },
  art: { position: 'absolute', width: '100%', height: '100%' },
  guide: { position: 'absolute' },
  finger: { position: 'absolute', left: '50%', top: '50%', width:0,height:0 },
  // The supplied 200×300 art's index fingertip sits at x≈60, not x≈113
  // like the retired vector. Keep the touch rings on it in both mirror poses.
  hintRing: { position: 'absolute', top: -31 },
  footnote: { color: '#86503B', fontSize: 16, lineHeight: 22, fontWeight: '700', textAlign: 'center' },
  sparkCenter: { position: 'absolute', left: '50%', top: '50%', width: 1, height: 1 },
  tapSpark: { position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: 4 },
  successContent: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'space-between', paddingTop: 20, zIndex: 1 },
  successVisual: { height: '38%', minHeight: 95, width: '100%', alignItems: 'center', justifyContent: 'center' },
  successWords: { alignItems: 'center', gap: 11 },
  sentTitle: { color: '#51301F', fontSize: 31, lineHeight: 37, fontWeight: '800', textAlign: 'center' },
  sentBody: { color: '#4B3027', fontSize: 17, lineHeight: 23, textAlign: 'center' },
  doneButton: { width: '100%', minHeight: 60, borderRadius: 25, backgroundColor: '#633B32', alignItems: 'center', justifyContent: 'center', shadowColor: '#E7A378', shadowOpacity: .8, shadowOffset: { width: 0, height: 3.5 }, shadowRadius: 0 },
  doneButtonPressed: { transform: [{ translateY: 2.5 }], shadowOffset: { width: 0, height: 1 } },
  doneText: { color: '#FFF9F5', fontSize: 20, fontWeight: '800' },
  a11yProgress: { width: 1, height: 1, opacity: 0 },
});

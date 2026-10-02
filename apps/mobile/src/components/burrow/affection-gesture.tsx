import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';
import type { AffectionType } from '@novame/domain';
import { haptics } from '@/lib/haptics';

type Copy = { label: string; symbol: string; hint: string; heading: string; instruction: string; encouragement: string; footnote: string; pageTitle: string };
export const AFFECTION_COPY: Record<AffectionType, Copy> = {
  hug: { label: 'Hug', symbol: '♥', hint: 'Press and hold for 3 seconds', heading: 'Hold your Hug close', instruction: 'Press and hold for 3 seconds', encouragement: 'Keep holding until the circle fills', footnote: 'Sends when the hold completes', pageTitle: 'Send a Hug' },
  spicy: { label: 'Spicy', symbol: '♥', hint: 'Tap 10 times', heading: 'Turn up the heat', instruction: 'Tap 10 times', encouragement: 'Each tap adds a little spark', footnote: 'Sends after 10 taps and 3 seconds', pageTitle: 'Send Some Spice' },
  cuddle: { label: 'Cuddle', symbol: '♥', hint: 'Swipe gently left and right', heading: 'Make it a cuddle', instruction: 'Swipe gently left and right', encouragement: 'Keep stroking to build warmth', footnote: 'Sends when the heart is full', pageTitle: 'Send a Cuddle' },
  gratitude: { label: 'Gratitude', symbol: '♥', hint: 'Slide two fingers inward, then hold', heading: 'Bring your thanks together', instruction: 'Slide two fingers inward, then hold', encouragement: 'Hold when your fingers meet', footnote: 'Sends after the hold', pageTitle: 'Send Gratitude' },
  kiss: { label: 'Kiss', symbol: '♥', hint: 'Spread two fingers apart', heading: 'Make your Kiss bigger', instruction: 'Spread two fingers apart', encouragement: 'Feel the gentle taps as it grows', footnote: 'Release to send after 3 seconds', pageTitle: 'Send a Kiss' },
  miss_you: { label: 'Miss You', symbol: '♥', hint: 'Trace a heart with one finger', heading: 'Draw a heart', instruction: 'Trace a heart with one finger', encouragement: 'Follow the shape in one stroke', footnote: 'Lift to send when complete', pageTitle: 'Say I Miss You' },
};

const DURATION_MS = 3000;
const HEART_POINTS: [number, number][] = [
  [.5, .34], [.35, .20], [.20, .32], [.24, .52], [.5, .80],
  [.76, .52], [.80, .32], [.65, .20], [.5, .34],
];
type GestureState = {
  startedAt: number; touching: boolean; released: boolean; qualified: boolean; assisted: boolean;
  taps: number; turns: number; travel: number; direction: number; lastX: number;
  pathPoints: number; initialDistance: number; maxScale: number; inwardAt: number;
};
const freshGesture = (): GestureState => ({ startedAt: 0, touching: false, released: false, qualified: false,
  assisted: false, taps: 0, turns: 0, travel: 0, direction: 0, lastX: 0,
  pathPoints: 0, initialDistance: 0, maxScale: 1, inwardAt: 0 });

function Finger({ flip = false }: { flip?: boolean }) {
  return <Svg width={76} height={116} viewBox="0 0 76 116" style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
    <Defs><LinearGradient id="finger" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#FFF1E7"/><Stop offset="1" stopColor="#FFBFAF"/></LinearGradient></Defs>
    <Path d="M24 112 L16 57 Q13 43 20 38 Q28 33 33 45 L39 63 L35 17 Q34 5 42 4 Q50 3 51 17 L55 65 Q62 60 67 65 Q74 71 68 83 L60 112 Z" fill="url(#finger)" stroke="#F47D7B" strokeWidth="3" strokeLinejoin="round"/>
    <Ellipse cx="43" cy="25" rx="6" ry="11" fill="#FFF8F2" opacity=".92"/>
    <Path d="M34 97 Q40 94 47 96" fill="none" stroke="#F39A92" strokeWidth="3" strokeLinecap="round"/>
  </Svg>;
}

/** The guide illustration is still art; only its finger layer moves. */
function GestureArt({ type }: { type: AffectionType }) {
  const isKiss = type === 'kiss';
  const isTrace = type === 'miss_you';
  return <Svg width="100%" height="100%" viewBox="0 0 300 250" pointerEvents="none">
    <Defs><LinearGradient id="love" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#FF8E8E"/><Stop offset="1" stopColor="#EF5963"/></LinearGradient></Defs>
    {isTrace ? <>
      <Path d="M150 92 C115 37 54 49 51 98 C49 141 101 177 150 213 C199 177 251 141 249 98 C246 49 185 37 150 92Z" fill="none" stroke="#FFC8C6" strokeWidth="8" strokeDasharray="11 12" strokeLinecap="round"/>
      <Path d="M150 92 C115 37 54 49 51 98 C49 141 101 177 150 213" fill="none" stroke="#F46B70" strokeWidth="10" strokeLinecap="round"/>
    </> : isKiss ? <>
      <Path d="M40 137 Q83 101 111 112 Q133 118 150 128 Q167 118 189 112 Q217 101 260 137 Q219 180 150 181 Q81 180 40 137Z" fill="url(#love)"/>
      <Path d="M40 137 Q100 152 150 142 Q200 152 260 137 Q195 168 150 158 Q105 168 40 137Z" fill="#DF4F58"/>
      <Path d="M123 139 Q150 129 177 139" fill="none" stroke="#FFD2C8" strokeWidth="4" strokeLinecap="round"/>
      <Path d="M136 145 Q150 160 164 145 Q150 145 136 145Z" fill="#FFE1DB"/>
    </> : <>
      <Path d="M150 78 C121 35 56 43 55 101 C54 153 105 188 150 217 C195 188 246 153 245 101 C244 43 179 35 150 78Z" fill="url(#love)"/>
      <Path d="M85 92 Q98 64 121 66" fill="none" stroke="#FFADAA" strokeWidth="9" strokeLinecap="round"/>
      {(type === 'hug' || type === 'cuddle' || type === 'gratitude') && <>
        <Path d="M64 157 Q99 135 118 150 L150 170 Q121 193 92 181Z" fill="#FFE3D8"/>
        <Path d="M236 157 Q201 135 182 150 L150 170 Q179 193 208 181Z" fill="#FFE3D8"/>
      </>}
      {type === 'spicy' && <Path d="M145 187 C121 157 143 146 148 125 C161 140 160 146 155 155 C177 141 168 121 174 110 C205 140 188 180 161 192 C166 170 156 161 153 157 C153 173 149 179 145 187Z" fill="#FFAD51" stroke="#FFF1D6" strokeWidth="3"/>}
      {type === 'gratitude' && <>
        <Path d="M21 133 H55 M21 133 L37 119 M21 133 L37 147 M279 133 H245 M279 133 L263 119 M279 133 L263 147" stroke="#F46B70" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
      </>}
      {type === 'cuddle' && <Path d="M62 49 H238 M62 49 L77 36 M62 49 L77 62 M238 49 L223 36 M238 49 L223 62" stroke="#F46B70" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>}
    </>}
    {!isTrace && <>
      <Path d="M150 22 V41 M108 31 L117 47 M192 31 L183 47" stroke="#F46B70" strokeWidth="6" strokeLinecap="round"/>
      <Circle cx="145" cy="125" r="31" fill="none" stroke="#FFF1EC" strokeWidth="5" opacity=".7"/>
      <Circle cx="145" cy="125" r="19" fill="none" stroke="#FFF1EC" strokeWidth="4" opacity=".7"/>
    </>}
  </Svg>;
}

function GestureDemo({ type, visible }: { type: AffectionType; visible: boolean }) {
  const motion = useRef(new Animated.Value(0)).current;
  const focused = useIsFocused();
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduced(value); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { live = false; sub.remove(); };
  }, []);
  useEffect(() => {
    motion.setValue(0);
    if (!visible || reduced || !focused) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(motion, { toValue: 1, duration: type === 'miss_you' ? 2100 : 1350, useNativeDriver: true }),
      Animated.timing(motion, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]));
    loop.start();
    return () => { loop.stop(); motion.stopAnimation(); };
  }, [visible, reduced, focused, type, motion]);
  if (!visible) return null;
  const finger = (key: string, x: Animated.AnimatedInterpolation<number> | number,
    y: Animated.AnimatedInterpolation<number> | number, flip = false) =>
    <Animated.View key={key} pointerEvents="none" style={[styles.finger, { transform: [{ translateX: x }, { translateY: y }] }]}><Finger flip={flip}/></Animated.View>;
  const inward = motion.interpolate({ inputRange: [0, 1], outputRange: [-83, -23] });
  const inwardRight = motion.interpolate({ inputRange: [0, 1], outputRange: [83, 23] });
  const outward = motion.interpolate({ inputRange: [0, 1], outputRange: [-20, -92] });
  const outwardRight = motion.interpolate({ inputRange: [0, 1], outputRange: [20, 92] });
  const sweep = motion.interpolate({ inputRange: [0, .5, 1], outputRange: [-55, 55, -55] });
  const tap = motion.interpolate({ inputRange: [0, .55, 1], outputRange: [18, -8, 18] });
  const traceX = motion.interpolate({ inputRange: [0, .125, .25, .375, .5, .625, .75, .875, 1], outputRange: [0, -39, -77, -68, 0, 68, 77, 39, 0] });
  const traceY = motion.interpolate({ inputRange: [0, .125, .25, .375, .5, .625, .75, .875, 1], outputRange: [-53, -85, -58, -7, 52, -7, -58, -85, -53] });
  return <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
    {type === 'gratitude' ? <>{finger('left', inward, 0)}{finger('right', inwardRight, 0, true)}</> :
      type === 'kiss' ? <>{finger('left', outward, 0)}{finger('right', outwardRight, 0, true)}</> :
        type === 'cuddle' ? finger('stroke', sweep, 0) :
          type === 'miss_you' ? finger('trace', traceX, traceY) : finger('press', 0, tap)}
  </View>;
}

function ProgressRing({ progress, type, taps }: { progress: number; type: AffectionType; taps: number }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  return <View pointerEvents="none" style={styles.ring}>
    <Svg width={78} height={78} viewBox="0 0 78 78" style={StyleSheet.absoluteFillObject}>
      <Circle cx="39" cy="39" r={radius} stroke="#F8D6D1" strokeWidth="7" fill="none"/>
      <Circle cx="39" cy="39" r={radius} stroke="#F46B70" strokeWidth="7" fill="none" strokeLinecap="round"
        strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - progress)} rotation={-90} origin="39,39"/>
    </Svg>
    <Text style={styles.ringText}>{type === 'spicy' ? `${taps}/10` : `${Math.max(0, Math.ceil((1 - progress) * 3))}s`}</Text>
  </View>;
}

export function AffectionGesture({ type, disabled, onComplete }: {
  type: AffectionType; disabled: boolean; onComplete: (metrics: Record<string, number>) => void;
}) {
  const [progress, setProgress] = useState(0);
  const [taps, setTaps] = useState(0);
  const [working, setWorking] = useState(false);
  const focused = useIsFocused();
  const callback = useRef(onComplete); callback.current = onComplete;
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const interactive = useRef(focused && AppState.currentState === 'active');
  interactive.current = focused && AppState.currentState === 'active';
  const gesture = useRef<GestureState>(freshGesture());
  const completed = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const step = useRef(0);
  const padSize = useRef({ width: 300, height: 250 });
  const stopTimer = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  const reset = () => { stopTimer(); gesture.current = freshGesture(); step.current = 0; setProgress(0); setTaps(0); setWorking(false); };
  const finish = () => {
    if (completed.current || !interactive.current) return;
    completed.current = true;
    const g = gesture.current;
    const durationMs = Math.max(DURATION_MS, Math.round(performance.now() - g.startedAt));
    stopTimer(); setProgress(1); setWorking(false);
    void haptics.medium().catch(() => {});
    callback.current(g.assisted ? { assistedHoldMs: durationMs, durationMs } : {
      durationMs, taps: g.taps, turns: g.turns, scale: g.maxScale,
      pathPoints: g.pathPoints, holdMs: g.inwardAt ? Math.round(performance.now() - g.inwardAt) : 0,
    });
  };
  const refresh = () => {
    const g = gesture.current;
    if (!g.startedAt || completed.current || !interactive.current) return;
    const elapsed = performance.now() - g.startedAt;
    const time = Math.min(1, elapsed / DURATION_MS);
    const action = g.assisted || type === 'hug' ? 1 : type === 'spicy' ? g.taps / 10 :
      type === 'cuddle' ? Math.min(1, g.turns / 4) : type === 'gratitude' ?
        g.inwardAt ? Math.min(1, (performance.now() - g.inwardAt) / 1000) : 0 :
        type === 'kiss' ? Math.min(1, Math.max(0, (g.maxScale - 1) / .5)) : g.pathPoints / HEART_POINTS.length;
    const next = Math.min(time, Math.min(1, action));
    setProgress(next);
    const nextStep = Math.floor(next * 4);
    if (nextStep > step.current && nextStep < 4) void haptics.light().catch(() => {});
    step.current = nextStep;
    if (elapsed < DURATION_MS || !g.qualified) return;
    if (!g.assisted && type === 'hug' && !g.touching) return;
    if (!g.assisted && type === 'gratitude' && (!g.touching || !g.inwardAt || performance.now() - g.inwardAt < 1000)) return;
    if (!g.assisted && (type === 'kiss' || type === 'miss_you') && !g.released) return;
    finish();
  };
  const begin = () => {
    if (disabledRef.current || !interactive.current || completed.current) return false;
    if (!gesture.current.startedAt) {
      gesture.current.startedAt = performance.now();
      timer.current = setInterval(refresh, 40);
      setWorking(true);
    }
    return true;
  };
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') reset(); });
    return () => { sub.remove(); stopTimer(); };
  }, []);
  useEffect(() => { if (!focused) reset(); }, [focused]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => type !== 'spicy' && interactive.current && !disabledRef.current && !completed.current,
    onMoveShouldSetPanResponder: () => type !== 'spicy' && interactive.current && !disabledRef.current && !completed.current,
    onPanResponderGrant: event => {
      if (!begin()) return;
      const g = gesture.current;
      g.touching = true; g.released = false;
      if ((type === 'kiss' || type === 'gratitude') && event.nativeEvent.touches.length >= 2) {
        const touches = event.nativeEvent.touches;
        g.initialDistance = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
      }
      if (type === 'hug') g.qualified = true;
      refresh();
    },
    onPanResponderMove: (event, state) => {
      const g = gesture.current;
      if (!g.startedAt || !g.touching || !interactive.current) return;
      const touches = event.nativeEvent.touches;
      if ((type === 'kiss' || type === 'gratitude') && touches.length >= 2) {
        const distance = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
        if (!g.initialDistance) g.initialDistance = Math.max(distance, 18);
        const scale = distance / g.initialDistance;
        if (type === 'kiss') { g.maxScale = Math.max(g.maxScale, scale); g.qualified = g.maxScale >= 1.5; }
        else if (scale <= .7) { if (!g.inwardAt) g.inwardAt = performance.now(); g.qualified = true; }
        else { g.inwardAt = 0; g.qualified = false; }
      } else if (type === 'gratitude') { g.inwardAt = 0; g.qualified = false; }
      if (type === 'cuddle') {
        const delta = state.dx - g.lastX;
        if (Math.abs(delta) >= 23) {
          const direction = Math.sign(delta);
          g.travel += Math.abs(delta);
          if (direction !== g.direction) { g.turns++; g.direction = direction; }
          g.lastX = state.dx;
          g.qualified = g.turns >= 4 && g.travel >= 140;
        }
      }
      if (type === 'miss_you' && touches.length === 1) {
        const point = HEART_POINTS[g.pathPoints];
        const x = event.nativeEvent.locationX / padSize.current.width;
        const y = event.nativeEvent.locationY / padSize.current.height;
        if (point && Math.hypot(x - point[0], y - point[1]) < .2) g.pathPoints++;
        g.qualified = g.pathPoints >= HEART_POINTS.length;
      }
      refresh();
    },
    onPanResponderRelease: () => {
      const g = gesture.current;
      g.touching = false; g.released = true;
      if (!g.qualified || type === 'hug' || type === 'gratitude') { if (!completed.current) reset(); return; }
      refresh();
    },
    onPanResponderTerminate: () => { if (!completed.current) reset(); },
    onPanResponderTerminationRequest: () => false,
  }), [type]);
  const tap = () => {
    if (type !== 'spicy' || !begin()) return;
    const g = gesture.current;
    g.taps = Math.min(10, g.taps + 1);
    g.qualified = g.taps >= 10;
    setTaps(g.taps);
    void haptics.light().catch(() => {});
    refresh();
  };
  const accessibleSend = () => {
    if (!begin()) return;
    const g = gesture.current;
    g.assisted = true; g.qualified = true;
    refresh();
  };
  const copy = AFFECTION_COPY[type];
  return <View style={styles.card}>
    <Text style={styles.heading}>{copy.heading}</Text>
    <Text style={styles.instruction}>{copy.instruction}</Text>
    <View style={styles.stage} {...responder.panHandlers}
      onLayout={event => { padSize.current = event.nativeEvent.layout; }}
      accessible accessibilityRole="button" accessibilityLabel={`${copy.instruction}. Three-second gesture area.`}
      accessibilityHint="Double tap to use the accessible three-second send option"
      accessibilityActions={[{ name: 'activate', label: 'Use accessible gesture' }]}
      onAccessibilityAction={accessibleSend}>
      <View pointerEvents="none" style={styles.art}><GestureArt type={type}/></View>
      <GestureDemo type={type} visible={!working && !completed.current}/>
      {type === 'spicy' && <Pressable accessibilityRole="button" accessibilityLabel="Tap to add a spark" onPress={tap} style={StyleSheet.absoluteFillObject}/>}
      {(type === 'hug' || type === 'spicy') && <ProgressRing progress={progress} type={type} taps={taps}/>}
    </View>
    <Text style={styles.encouragement}>{copy.encouragement}</Text>
    <Text style={styles.footnote}>{copy.footnote}</Text>
    <View accessibilityLabel={`Gesture progress ${Math.round(progress * 100)} percent`} style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${progress * 100}%` }]}/>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { flex: 1, backgroundColor: '#FFF8F4', borderRadius: 35, paddingHorizontal: 18, paddingTop: 29, paddingBottom: 25, alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' },
  heading: { color: '#793337', fontSize: 27, lineHeight: 33, fontWeight: '800', textAlign: 'center' },
  instruction: { color: '#A84953', fontSize: 18, lineHeight: 25, fontWeight: '600', textAlign: 'center' },
  stage: { width: '100%', flex: 1, minHeight: 160, maxHeight: 285, justifyContent: 'center', alignItems: 'center' },
  art: { position: 'absolute', width: '100%', height: '100%' },
  finger: { position: 'absolute', left: '50%', top: '40%', marginLeft: -38, marginTop: -24 },
  ring: { position: 'absolute', right: 1, top: '48%', width: 78, height: 78, alignItems: 'center', justifyContent: 'center' },
  ringText: { color: '#F46B70', fontSize: 20, fontWeight: '800' },
  encouragement: { color: '#AA4D56', fontSize: 16, lineHeight: 23, fontWeight: '600', textAlign: 'center' },
  footnote: { color: '#CF9998', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  progressTrack: { height: 5, width: '85%', backgroundColor: '#F8D6D1', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#F46B70' },
});

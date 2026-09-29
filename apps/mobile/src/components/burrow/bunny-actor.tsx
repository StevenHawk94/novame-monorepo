import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import type { MajorUpdateCatalogItem } from '@/lib/app-major-update-api';

export type BunnyPose = 'idle' | 'sleeping' | 'digging' | 'away';
export function outfitAppearance(outfit?: MajorUpdateCatalogItem) {
  const style = outfit?.asset.outfitStyle;
  const color = outfit?.asset.outfitColor;
  return {
    style: typeof style === 'string' && ['explorer','jumper','raincoat','pyjamas'].includes(style) ? style : 'explorer',
    color: typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : '#65845B',
    title: outfit?.title ?? 'Little Explorer',
  };
}

/** Stable pose/outfit boundary for future art. Zero needs never change pose.
 * All current shapes are code-native placeholders, not final bunny artwork. */
export function BunnyActor({ outfit, pose = 'idle', partner = false, standalone = false }: {
  outfit?: MajorUpdateCatalogItem; pose?: BunnyPose; partner?: boolean; standalone?: boolean;
}) {
  const appearance = outfitAppearance(outfit);
  const movement = useRef(new Animated.Value(0)).current;
  const [reduced, setReduced] = useState(true); // Still until accessibility is known.
  const [active, setActive] = useState(AppState.currentState === 'active');
  const focused = useIsFocused();
  useEffect(() => {
    let live = true, changed = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live && !changed) setReduced(value); }).catch(() => {});
    const accessibility = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { changed = true; setReduced(value); });
    const app = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => { live = false; accessibility.remove(); app.remove(); };
  }, []);
  useEffect(() => {
    movement.setValue(0);
    if (reduced || !active || !focused || pose === 'away') return;
    const duration = pose === 'digging' ? 450 : 1600;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(movement, { toValue: -2, duration, useNativeDriver: true }),
      Animated.timing(movement, { toValue: 0, duration, useNativeDriver: true }),
    ]));
    animation.start();
    return () => { animation.stop(); movement.stopAnimation(); movement.setValue(0); };
  }, [reduced, active, focused, pose, movement]);
  if (pose === 'away') return null;
  const fur = partner ? '#FFF1D6' : '#DFAC79';
  return <Animated.View pointerEvents="none" accessible accessibilityRole="image"
    accessibilityLabel={`${partner ? 'Your person’s bunny' : 'Your bunny'}, ${appearance.title}, ${pose}`}
    style={[standalone ? styles.standalone : styles.actor, !standalone && partner && styles.partner, { transform: [{ translateY: movement }] }]}>
    <Svg viewBox="0 0 100 130" width="100%" height="100%">
      <Ellipse cx="50" cy="121" rx="38" ry="6" fill="#563720" opacity=".18"/>
      <Ellipse cx="34" cy="29" rx="10" ry="26" fill={fur}/><Ellipse cx="65" cy="29" rx="10" ry="26" fill={fur}/>
      <Ellipse cx="34" cy="29" rx="5" ry="19" fill="#F2BEAC"/><Ellipse cx="65" cy="29" rx="5" ry="19" fill="#F2BEAC"/>
      <Ellipse cx="50" cy="94" rx="31" ry="30" fill={fur}/>
      <Path d="M22 80Q50 71 78 80L74 111Q50 120 26 111Z" fill={appearance.color}/>
      {appearance.style === 'explorer' && <G><Path d="M28 80L49 100L70 80" stroke="#E2C596" strokeWidth="6" fill="none"/><Rect x="43" y="98" width="15" height="13" rx="3" fill="#BF985F"/></G>}
      {appearance.style === 'jumper' && <G><Path d="M24 87H76M24 100H76" stroke="#FFF0D6" strokeWidth="5"/><Path d="M43 105Q38 99 42 97Q47 94 50 99Q57 94 59 98Q61 103 50 112Z" fill="#FFF0D6"/></G>}
      {appearance.style === 'raincoat' && <G><Path d="M50 78V115" stroke="#AF8732" strokeWidth="2"/>{[87,98,109].map(y=><Circle key={y} cx="54" cy={y} r="2" fill="#FFF0D6"/>)}</G>}
      {appearance.style === 'pyjamas' && <G><Path d="M30 87H73M27 101H74" stroke="#A4B8DB" strokeWidth="3"/><Path d="M65 91L67 96L72 96L68 100L69 105L65 102L61 105L62 100L58 96L63 96Z" fill="#FFEBA7"/></G>}
      <Ellipse cx="50" cy="62" rx="32" ry="27" fill={fur}/><Ellipse cx="50" cy="75" rx="20" ry="13" fill="#FFF0D6"/>
      {pose === 'sleeping' ? <Path d="M28 61Q34 67 40 61M59 61Q65 67 71 61" stroke="#623F2D" strokeWidth="2.5" fill="none"/>
        : <G><Circle cx="34" cy="62" r="3.5" fill="#623F2D"/><Circle cx="65" cy="62" r="3.5" fill="#623F2D"/></G>}
      <Path d="M45 70Q50 67 55 70L50 75Z" fill="#C97866"/><Path d="M43 77Q50 83 57 77" stroke="#623F2D" strokeWidth="1.5" fill="none"/>
      <Ellipse cx="28" cy="117" rx="14" ry="8" fill="#FFF0D6"/><Ellipse cx="72" cy="117" rx="14" ry="8" fill="#FFF0D6"/>
      {pose === 'digging' && <G><Path d="M63 84L88 111" stroke="#85552B" strokeWidth="5"/><Path d="M78 110L88 101L98 113L90 123Z" fill="#ACAEAD"/></G>}
      {pose === 'sleeping' && <Path d="M79 39H91L80 50H92M84 22H93L84 31H94" stroke="#FFF0D6" strokeWidth="2.5" fill="none"/>}
    </Svg>
  </Animated.View>;
}
const styles = StyleSheet.create({
  actor: { position: 'absolute', left: '14%', top: '55%', width: '32%', height: '28%' },
  partner: { left: '39%' },
  standalone: { width: 155, height: 195, alignSelf: 'center' },
});

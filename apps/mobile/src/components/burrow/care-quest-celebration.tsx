import { memo, useEffect, useMemo, useRef } from 'react';
import { Animated as NativeAnimated, Easing as NativeEasing, AppState, BackHandler, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { useReducedMotion } from 'react-native-reanimated';
import {CARE_CONFETTI,CARE_CONFETTI_DURATION,CARE_COMPLETION_INPUT,CARE_COMPLETION_SCALE} from '@/lib/care-confetti-motion';

const COLORS = ['#E9AD48', '#F17E67', '#79B99A', '#F4D777', '#CE91B9', '#86BED1'];

const ConfettiPiece = memo(function ConfettiPiece({ index, elapsed }: { index: number; elapsed: NativeAnimated.Value }) {
  const piece=CARE_CONFETTI[index];
  const style=useMemo(()=>{
    const interpolate=(outputRange:number[]|string[])=>elapsed.interpolate({inputRange:piece.inputRange,outputRange,extrapolate:'clamp'});
    return {opacity:interpolate(piece.opacity),transform:[{translateX:interpolate(piece.x)},{translateY:interpolate(piece.y)},
      {rotate:interpolate(piece.rotation)},{scale:interpolate(piece.scale)}]};
  },[piece,elapsed]);
  return <NativeAnimated.View style={[styles.piece,{backgroundColor:COLORS[index%COLORS.length],width:piece.width,height:piece.height},style]}/>;
});

/** Care's status message stays separate from the global currency presentation.
 * Use an in-screen layer, not a native Modal that would cover the banner. */
export function CareQuestCelebration({ title, message, reward, icon='celebration', onClose, visible=true }: {
  title: string; message?: string; reward?: number; icon?: 'celebration'|'heart'; onClose: () => void; visible?: boolean;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  // Entrance belongs to this mounted completion, never a reward receipt or
  // changing callback. Animate the card only; the scrim and wallet stay put.
  const reduced = useRef(useReducedMotion()).current;
  const clock=useRef<NativeAnimated.Value|null>(null);
  if(!clock.current)clock.current=new NativeAnimated.Value(0,{useNativeDriver:true});
  const elapsed=clock.current;
  const entrance=useMemo(()=>({opacity:elapsed.interpolate({inputRange:[0,reduced?160:120],outputRange:[0,1],extrapolate:'clamp'}),
    transform:[{scale:reduced?1:elapsed.interpolate({inputRange:CARE_COMPLETION_INPUT,outputRange:CARE_COMPLETION_SCALE,extrapolate:'clamp'})}]}),[elapsed,reduced]);
  useEffect(() => {
    if (!visible) { elapsed.stopAnimation(); elapsed.setValue(0); return; }
    // One clock for all 36 pieces, not 36 effects/animations competing with
    // the card and wallet on the same completion frame. Geometry is unchanged.
    const burst=NativeAnimated.timing(elapsed,{toValue:reduced?160:CARE_CONFETTI_DURATION,duration:reduced?160:CARE_CONFETTI_DURATION,easing:NativeEasing.linear,useNativeDriver:true,isInteraction:false});
    burst.start();
    const state = AppState.addEventListener('change', next => {
      if (next === 'active') return;
      burst.stop(); elapsed.stopAnimation(); elapsed.setValue(CARE_CONFETTI_DURATION);
    });
    return () => { state.remove(); burst.stop(); elapsed.stopAnimation(); };
  }, [visible, reduced, elapsed]);
  useEffect(() => {
    if (!visible) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { close.current(); return true; });
    return () => back.remove();
  }, [visible]);
  return <View accessibilityViewIsModal={visible} accessibilityElementsHidden={!visible} importantForAccessibility={visible?'auto':'no-hide-descendants'}
      pointerEvents={visible?'auto':'none'} style={[StyleSheet.absoluteFillObject, styles.scrim, { zIndex: 100, opacity: visible ? 1 : 0 }]}>
      {!reward && <View pointerEvents="none" style={[styles.burst,reduced&&{opacity:0}]}>{Array.from({ length: 36 }, (_, index) => <ConfettiPiece key={index} index={index} elapsed={elapsed} />)}</View>}
      <NativeAnimated.View shouldRasterizeIOS renderToHardwareTextureAndroid style={[styles.card, entrance]}>
        <Text style={styles.emoji}>{icon==='heart'?'❤️':'🎉'}</Text>
        <Text style={styles.title}>{title}</Text>
        {!!message&&<Text style={styles.message}>{message}</Text>}
        <Pressable accessibilityRole="button" disabled={!visible} onPress={onClose} style={styles.button}><Text style={styles.buttonText}>Done</Text></Pressable>
      </NativeAnimated.View>
  </View>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2A160E99', padding: 24 },
  burst: { position: 'absolute', top: '50%', left: '50%', zIndex: 2, alignItems: 'center', justifyContent: 'center' },
  piece: { position: 'absolute', borderRadius: 2 },
  card: { width: '100%', maxWidth: 350, borderRadius: 28, backgroundColor: '#FFF8EE', padding: 26, alignItems: 'center', gap: 12, shadowColor: '#321A0F', shadowOpacity: .25, shadowRadius: 18, elevation: 10 },
  emoji: { fontSize: 48 },
  title: { color: '#4C2B22', fontSize: 22, lineHeight: 28, fontWeight: '800', textAlign: 'center' },
  message: { color: '#69483A', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  button: { marginTop: 10, minHeight: 48, width: '100%', borderRadius: 25, backgroundColor: '#4C2B22', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
});

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { NativeAnimatedContent } from '../ui/native-animated-content';
import { useAdventureMotion } from '@/lib/use-adventure-motion';
import { ADVENTURE_REWARD_MOTION as M } from '@/lib/adventure-reward-motion';

/** Key by logical page/line, never clock/catalogue updates. Layout is reserved
 * immediately; hidden controls are neither touchable nor accessible. */
export function AdventureReveal({ children, delay = M.headingDelay, style, enabled = true, onVisible }: {
  children: ReactNode; delay?: number; style?: StyleProp<ViewStyle>; enabled?: boolean; onVisible?:()=>void;
}) {
  const { active, reduced } = useAdventureMotion();
  const progress = useRef(new Animated.Value(reduced || !enabled ? 1 : 0)).current;
  const [visible, setVisible] = useState(reduced || !enabled);
  const began = useRef(false), mounted = useRef(true);
  const completed = useRef(reduced || !enabled);
  const visibleCallback=useRef(onVisible),notified=useRef(false);visibleCallback.current=onVisible;
  useEffect(()=>{
    if(visible&&active&&!notified.current){notified.current=true;visibleCallback.current?.();}
  },[visible,active]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let live = true;
    const finish = () => { if (live && mounted.current) {
      completed.current=true;setVisible(true);
      // Native opacity is already 1 here. Do not leave a passive-effect gap
      // in which a very fast next tap could unmount the first reply first.
      if(active&&!notified.current){notified.current=true;visibleCallback.current?.();}
    } };
    if (!enabled || reduced || (began.current && !active)) {
      began.current = true;
      progress.stopAnimation(); progress.setValue(1); finish(); return;
    }
    // Simple opacity/transform entrances need no per-frame Fabric ShadowTree
    // commits. Native Animated serializes the same cubic curve and timings once.
    if (!active || completed.current) return;
    began.current = true;
    const animation = Animated.timing(progress, {toValue:1,delay,duration:M.entrance,easing:Easing.out(Easing.cubic),useNativeDriver:true});
    animation.start(({finished}) => { if (finished) finish(); });
    return () => { live = false; animation.stop(); };
  }, [active, reduced, enabled, delay, progress]);
  const animated = useMemo(() => ({ opacity: progress, transform: [{ translateY: progress.interpolate({inputRange:[0,1],outputRange:[10,0]}) }] }),[progress]);
  return <NativeAnimatedContent collapsable={false} pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible}
    importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} style={[style, animated]} renderScene={() => children}/>;
}

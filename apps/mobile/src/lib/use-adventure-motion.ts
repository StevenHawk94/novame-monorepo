import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useAdventureVideoActive } from './use-adventure-video-active';

/** Observe both navigation and real backgrounding; no invisible looping work. */
export function useAdventureMotion() {
  const active = useAdventureVideoActive();
  const systemReduced = useReducedMotion();
  const [reduced, setReduced] = useState(systemReduced);
  useEffect(() => {
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => listener.remove();
  }, []);
  return { active, reduced };
}

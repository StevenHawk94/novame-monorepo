import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { isNativeNavigationTransitionBusy } from './rating-navigation';
import { isOverlayPresent } from './overlay-presence';

/** Local duplicate-tap guard; no persistent/global permission to click Home. */
export function useNavigationAction() {
  const focused = useRef(false);
  const lockedUntil = useRef(0);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    lockedUntil.current = 0;
    return () => { focused.current = false; lockedUntil.current = 0; };
  }, []));
  return useCallback((action: () => void) => {
    if (!focused.current || Date.now() < lockedUntil.current
      || isNativeNavigationTransitionBusy() || isOverlayPresent()) return;
    lockedUntil.current = Date.now() + 600;
    try { action(); } catch (error) { lockedUntil.current = 0; throw error; }
  }, []);
}

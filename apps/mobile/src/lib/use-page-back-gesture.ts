import { useLayoutEffect } from 'react';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { HORIZONTAL_EDGE_BACK_OPTIONS } from './page-edge-gesture';

/** Temporary transaction safety only; ordinary page modes inherit the global
 * edge policy. Do not use this to disable back throughout a nested page flow. */
export function usePageBackGesture(enabled: boolean) {
  const navigation = useNavigation();
  const focused = useIsFocused();
  useLayoutEffect(() => {
    // Native-stack preloads are placeholder routes until promoted. They cannot
    // set options, and must not alter the visible source screen's gesture.
    if (!focused) return;
    navigation.setOptions({ ...HORIZONTAL_EDGE_BACK_OPTIONS, gestureEnabled: enabled });
  }, [navigation, enabled, focused]);
}

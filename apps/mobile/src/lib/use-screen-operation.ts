import { useCallback, useRef } from 'react';
import { useFocusEffect, useNavigation } from 'expo-router';
import { createOperationScope } from './async-lifecycle';
import { sessionEpoch } from './session-lifecycle';

/** One operation per focused screen; old promises cannot navigate a later page. */
export function useScreenOperation() {
  const navigation = useNavigation();
  const scope = useRef(createOperationScope()).current;
  const focused = useRef(false);
  const busy = useRef(false);
  const invalidate = useCallback(() => { scope.invalidate(); busy.current = false; }, [scope]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    // Invalidate at the back action, not after its native exit animation.
    const stop = () => { focused.current = false; invalidate(); };
    const unsubscribe = navigation.addListener('beforeRemove', stop);
    return () => { unsubscribe(); stop(); };
  }, [invalidate, navigation]));
  const begin = useCallback(() => {
    if (!focused.current || busy.current) return null;
    busy.current = true;
    const current = scope.begin();
    const epoch = sessionEpoch();
    return {
      isCurrent: () => focused.current && current() && epoch === sessionEpoch(),
      finish: () => { if (current()) busy.current = false; },
    };
  }, [scope]);
  return { begin, invalidate };
}

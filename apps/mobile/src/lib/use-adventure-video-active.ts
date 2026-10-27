import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

export function useAdventureVideoActive() {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    // Reconcile a change between render and listener installation.
    setForeground(AppState.currentState === 'active');
    return () => subscription.remove();
  }, []);
  return focused && foreground;
}

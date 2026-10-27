import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { dismissToRetainedTab } from '@/lib/retained-tab-navigation';

/** Retired native links reuse the existing tabs tree; replacing it duplicates it. */
export function NativeTabRedirect({ href }: { href: string }) {
  useFocusEffect(useCallback(() => { dismissToRetainedTab(href); }, [href]));
  return null;
}

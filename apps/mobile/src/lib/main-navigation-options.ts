import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';
import { HORIZONTAL_EDGE_BACK_OPTIONS } from './page-edge-gesture';
import { ADVENTURE_LOG_BACKGROUND } from './burrow-surface';
type NativeStackNavigationOptions = Exclude<NonNullable<ComponentProps<typeof Stack.Screen>['options']>, Function>;

/** One transition owner per layer. Never put a native pan around the tab compositor. */
export const MAIN_CARD_OPTIONS: NativeStackNavigationOptions = {
  headerShown: false,
  presentation: 'card',
  animation: 'slide_from_right',
  ...HORIZONTAL_EDGE_BACK_OPTIONS,
  // Every screen paints its own background; don't flash a shared brown cover
  // between the mounted previous screen and the incoming cached screen.
  contentStyle: { backgroundColor: 'transparent' },
};

export const MAIN_ADVENTURE_INPUT_OPTIONS: NativeStackNavigationOptions = {
  ...MAIN_CARD_OPTIONS,
  animationDuration: 300,
  contentStyle: { backgroundColor: ADVENTURE_LOG_BACKGROUND },
};

export const MAIN_TAB_OPTIONS: NativeStackNavigationOptions = {
  animation: 'none', gestureEnabled: false, fullScreenGestureEnabled: false,
  contentStyle: { backgroundColor: '#E8D5B0' },
};

export const MAIN_SHEET_OPTIONS: NativeStackNavigationOptions = {
  presentation: 'transparentModal', animation: 'slide_from_bottom',
  gestureEnabled: true, gestureDirection: 'vertical', fullScreenGestureEnabled: false,
  contentStyle: { backgroundColor: 'transparent' },
};

export function isRetainedBurrowAlias(params?: Record<string, unknown>): boolean {
  const section = params?.section;
  return ['burrow', 'moments', 'collection'].includes(String(section))
    || (section === 'shop' && !params?.giftTo && !params?.itemId && !params?.category && !params?.ownedOnly);
}

export function burrowDetailOptions(params?: Record<string, unknown>): NativeStackNavigationOptions {
  if (params?.section === 'adventure' && params?.adventureFade === '1')
    return { animation: 'slide_from_right', animationTypeForReplace: 'push', animationDuration: 300,
      contentStyle: { backgroundColor: '#2B1008' } };
  if (isRetainedBurrowAlias(params) || params?.section === 'carrot_shop' || params?.section === 'our_room')
    return { animation: 'none', gestureEnabled: false };
  const background = { adventure: ADVENTURE_LOG_BACKGROUND, affection: '#EF8392', memories_room: '#FBEEDD',
    partner_room: '#482010', decorate: '#FFFAF2', friends_room: '#793D29' }[String(params?.section)];
  return background ? { ...(params?.section === 'adventure' ? { animationDuration: 300 } : {}),
    contentStyle: { backgroundColor: background } } : {};
}

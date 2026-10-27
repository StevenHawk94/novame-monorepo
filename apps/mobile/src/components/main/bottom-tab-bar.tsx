import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';

import { haptics } from '@/lib/haptics';
import { HomeEntryImage } from './home-entry-gate';
import { useHomeEntry } from '@/lib/use-home-entry';
import { markHomeEntryAsset } from '@/lib/home-entry-readiness';
import { yieldDownloadQueueForInteraction } from '@/lib/download-queue';
import { useBurrowTabAttention } from '@/lib/burrow-tab-attention';
import { UpdateBadge } from '../burrow/update-badge';
import { homeTabBarHeight, HOME_TAB_BAR_TOP_SPACE } from '@/lib/burrow-home-layout';
import { retainedTabRoot } from '@/lib/retained-tab-layers';
import { cancelBurrowPageEntry, enterBurrowPage } from '@/lib/burrow-page-entry';
import { stageForegroundJobs } from '@/lib/ui-idle';
import { uiWorkPriority } from '@/lib/ui-work-priority';

/** Burrow tabs use only the current neutral/selected artwork below. */
const BURROW_TABS = [
  { name: 'index', label: 'Home' },
  { name: 'burrow', label: 'Burrow' },
  { name: 'quests', label: 'Quests' },
  { name: 'shop', label: 'Shop' },
  { name: 'friends', label: 'Moments' },
] as const;
const TAB_PRELOAD_START_DELAY_MS = 100;
const TAB_PRELOAD_SETTLE_MS = 120;

export function BottomTabBar({ state, navigation, retainedHome = false }: BottomTabBarProps & { retainedHome?: boolean }) {
  const attention = useBurrowTabAttention();
  const tabs = BURROW_TABS;
  const { attempt, pending: homeEntryPending } = useHomeEntry();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const activeRoute = state.routes[state.index];
  const activeRouteName = activeRoute?.name ?? 'index';
  const underlayRootName = retainedTabRoot(state)?.name ?? 'index';
  const routesByName = new Map<string, (typeof state.routes)[number]>();
  state.routes.forEach((r) => routesByName.set(r.name, r));
  const preloadedTabs = useRef(new Set<string>());
  const stopPreloading = useRef<(() => void) | null>(null);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppIsActive(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (
      homeEntryPending
      || !appIsActive
    ) return;
    const preloadOrder = ['quests','burrow','shop','friends','collection'];

    const cancel = stageForegroundJobs(preloadOrder.filter(name => !preloadedTabs.current.has(name))
      .map((routeName, index) => ({ delayMs: TAB_PRELOAD_START_DELAY_MS + index * TAB_PRELOAD_SETTLE_MS, run: () => {
        try { navigation.preload(routeName); preloadedTabs.current.add(routeName); }
        catch (error) { console.warn('[tabs] background preload skipped:', routeName, error); }
      } })));
    stopPreloading.current = cancel;

    const memorySub = AppState.addEventListener('memoryWarning', cancel);

    return () => {
      cancel();
      memorySub.remove();
      if (stopPreloading.current === cancel) stopPreloading.current = null;
    };
  }, [activeRouteName, appIsActive, homeEntryPending, navigation]);

  const commitTabPress = (routeName: string, isFocused: boolean) => {
    // A real user action always outranks speculative background mounting.
    if (!isFocused) {
      stopPreloading.current?.();
      yieldDownloadQueueForInteraction();
    }
    void haptics.pageOpen();
    const route = routesByName.get(routeName);
    if (!route) return;
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!isFocused && !event.defaultPrevented) {
      navigation.dispatch({
        ...CommonActions.navigate(route.name, route.params),
        target: state.key,
      });
    }
  };

  const handleTabPress = (routeName: string, isFocused: boolean) => {
    uiWorkPriority.action();
    // Yield at intent time, not after an entry preparation has already waited.
    if (!isFocused) yieldDownloadQueueForInteraction();
    if (!isFocused && routeName !== 'index') enterBurrowPage({kind:routeName==='shop'?'shop':routeName==='friends'?'private':'page',intent:`tab:${routeName}`}, () => commitTabPress(routeName, isFocused));
    else {if(!isFocused)cancelBurrowPageEntry();commitTabPress(routeName, isFocused);}
  };

  // Retained tabs keep the established full-screen room presentation.
  if (!retainedHome && ['burrow','shop','friends','collection'].includes(activeRouteName)) return null;

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: insets.bottom,
          backgroundColor: '#FFF2DF',
          borderTopColor: 'rgba(90,74,50,0.12)',
          height: homeTabBarHeight(width, insets.bottom),
        },
      ]}
    >
      <View key={attempt} style={[styles.row, styles.burrowRow]} onLayout={() => markHomeEntryAsset('tabs-layout', attempt)}>
        {tabs.map((tab) => {
          const route = routesByName.get(tab.name);
          if (!route) return null;
          // Retained child cards keep their underlying root tab selected.
          const routeIsFocused = state.index === state.routes.findIndex((r) => r.name === tab.name);
          const isFocused = retainedHome && ['burrow','shop','friends','collection'].includes(activeRouteName)
            ? tab.name === underlayRootName
            : routeIsFocused;
          return <BurrowTabButton key={route.key} name={tab.name} count={attention.tabs[tab.name] ?? 0} label={tab.label} isFocused={isFocused} attempt={attempt} onPress={() => handleTabPress(tab.name, routeIsFocused)} />;
        })}
      </View>
    </View>
  );
}

// Always use the supplied local neutral/selected pairs, not legacy ICONS art.
// Updated Burrow artwork is 500×500; contain in the same slot as the 313×313
// pairs so source resolution never changes the bar's layout or touch targets.
const burrowIcons = {
  index: { inactive: require('../../../assets/burrow-webp/home tab icons/home.webp'), active: require('../../../assets/burrow-webp/home tab icons/home-selected.webp') },
  burrow: { inactive: require('../../../assets/burrow-webp/home tab icons/burrow.webp'), active: require('../../../assets/burrow-webp/home tab icons/burrow-selected.webp') },
  quests: { inactive: require('../../../assets/burrow-webp/home tab icons/quests.webp'), active: require('../../../assets/burrow-webp/home tab icons/quests-selected.webp') },
  shop: { inactive: require('../../../assets/burrow-webp/home tab icons/shop.webp'), active: require('../../../assets/burrow-webp/home tab icons/shop-selected.webp') },
  friends: { inactive: require('../../../assets/burrow-webp/home tab icons/moments.webp'), active: require('../../../assets/burrow-webp/home tab icons/moments-selected.webp') },
} as const;
function BurrowTabButton({ name, label, isFocused, attempt, onPress, count }: { name: keyof typeof burrowIcons; label: string; isFocused: boolean; attempt: number; onPress: () => void; count: number }) {
  const { width } = useWindowDimensions();
  const scale = width / 900;
  return <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: isFocused }} onPress={onPress} onLayout={() => markHomeEntryAsset(`tab:${name}`, attempt)} style={styles.burrowTab}>
    {({ pressed }) => <>
      <View><HomeEntryImage asset={`tab:${name}`} source={isFocused || pressed ? burrowIcons[name].active : burrowIcons[name].inactive} style={[styles.burrowIcon, { width: 64 * scale, height: 64 * scale }]} contentFit="contain" /><UpdateBadge count={count} exact={name==='shop'} size={Math.max(18, 35 * scale)} /></View>
      <Text style={[styles.burrowLabel, { fontSize: 23 * scale, lineHeight: 28 * scale }, (isFocused || pressed) && styles.burrowLabelActive]}>{label}</Text>
    </>}
  </Pressable>;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: '#1F140C',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -4 },
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingTop: 4,
    paddingBottom: 4,
  },
  burrowRow: { flex: 1, alignItems: 'center', paddingTop: 1 + HOME_TAB_BAR_TOP_SPACE, paddingBottom: 0 },
  burrowTab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 0 },
  burrowIcon: { width: 34, height: 34 },
  burrowLabel: { color: '#1D1A17', fontSize: 11, lineHeight: 14 },
  burrowLabelActive: { color: '#C95D2F', fontWeight: '700' },
});

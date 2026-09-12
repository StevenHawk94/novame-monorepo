import { ReactNode, useEffect, useRef, useState } from 'react';
import { AppState, InteractionManager, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import type { ImageSourcePropType } from 'react-native';
import { useSegments } from 'expo-router';

import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import { HomeEntryImage } from './home-entry-gate';
import { useHomeEntry } from '@/lib/use-home-entry';
import { isHomeEntryRoute, markHomeEntryAsset, type HomeEntryAsset } from '@/lib/home-entry-readiness';
import { yieldDownloadQueueForInteraction } from '@/lib/download-queue';

/**
 * Bottom tab bar for (main)/(tabs). Five tabs with the illustrated icon set
 * (assets/Icons), on a warm cream bar to match the Home art. The focused tab
 * reads at full opacity; unfocused tabs dim slightly.
 */
const TABS: ReadonlyArray<{ name: 'index' | 'bags' | 'quests' | 'friends' | 'status'; icon: ImageSourcePropType; label: string }> = [
  { name: 'index', icon: ICONS.Home, label: 'Home' },
  { name: 'bags', icon: ICONS.Memories, label: 'Memories' },
  { name: 'quests', icon: ICONS.Quests, label: 'Quests' },
  { name: 'friends', icon: ICONS.Friends, label: 'Paired' },
  { name: 'status', icon: ICONS.friendList, label: 'Connection' },
];

// Lightest first, heaviest last. React Navigation's preload mounts the real
// inactive route without focusing it, so useFocusEffect network refreshes do
// not run until the user actually visits the tab.
const TAB_PRELOAD_ORDER = ['quests', 'friends', 'bags', 'status'] as const;
const TAB_PRELOAD_START_DELAY_MS = 650;
const TAB_PRELOAD_SETTLE_MS = 700;

type TabBarTheme = {
  background: string;
  label: string;
  activeBackground: string;
  topBorder: string;
};

/** Each bar is a slightly lighter continuation of its screen's main color. */
const TAB_THEMES: Record<string, TabBarTheme> = {
  index: {
    background: '#F0DFC0',
    label: '#5A4A32',
    activeBackground: '#FFF3D9',
    topBorder: 'rgba(90,74,50,0.12)',
  },
  bags: {
    background: '#FBE7A7',
    label: '#533A23',
    activeBackground: '#FFF4CF',
    topBorder: 'rgba(83,58,35,0.12)',
  },
  quests: {
    background: '#62472F',
    label: '#FFFFFF',
    activeBackground: 'rgba(255,255,255,0.16)',
    topBorder: 'rgba(255,255,255,0.10)',
  },
  friends: {
    background: '#80583B',
    label: '#FFFFFF',
    activeBackground: 'rgba(255,255,255,0.16)',
    topBorder: 'rgba(255,255,255,0.10)',
  },
  status: {
    background: '#936453',
    label: '#FFFFFF',
    activeBackground: 'rgba(255,255,255,0.16)',
    topBorder: 'rgba(255,255,255,0.10)',
  },
};

const BAG_COLLECTION_THEMES: Record<'their' | 'ours', TabBarTheme> = {
  their: {
    background: '#EAF6FA',
    label: '#45616D',
    activeBackground: '#F7FCFE',
    topBorder: 'rgba(69,97,109,0.12)',
  },
  ours: {
    background: '#FBEAF0',
    label: '#674A54',
    activeBackground: '#FFF6F9',
    topBorder: 'rgba(103,74,84,0.12)',
  },
};

const FALLBACK_THEME = TAB_THEMES.index;

export function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const { attempt, pending: homeEntryPending } = useHomeEntry();
  const segments = useSegments();
  const homeIsForeground = isHomeEntryRoute(segments);
  const insets = useSafeAreaInsets();
  const activeRoute = state.routes[state.index];
  const activeRouteName = activeRoute?.name ?? 'index';
  const collectionTab = (activeRoute?.params as { tab?: string } | undefined)?.tab;
  const theme = activeRouteName === 'bags' && (collectionTab === 'their' || collectionTab === 'ours')
    ? BAG_COLLECTION_THEMES[collectionTab]
    : TAB_THEMES[activeRouteName] ?? FALLBACK_THEME;
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
      || !homeIsForeground
      || activeRouteName !== 'index'
      || !appIsActive
    ) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let interaction: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;

    const cancel = () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      interaction?.cancel();
      interaction = null;
    };
    stopPreloading.current = cancel;

    const schedule = (startAt: number) => {
      if (cancelled) return;
      let index = startAt;
      while (index < TAB_PRELOAD_ORDER.length && preloadedTabs.current.has(TAB_PRELOAD_ORDER[index])) {
        index += 1;
      }
      if (index >= TAB_PRELOAD_ORDER.length) return;

      interaction = InteractionManager.runAfterInteractions(() => {
        interaction = null;
        if (cancelled || AppState.currentState !== 'active') return;
        const routeName = TAB_PRELOAD_ORDER[index];
        try {
          navigation.preload(routeName);
          preloadedTabs.current.add(routeName);
        } catch (error) {
          // Preloading is an optional performance optimization. A navigator
          // teardown must never affect normal tab navigation.
          console.warn('[tabs] background preload skipped:', routeName, error);
        }
        timer = setTimeout(() => schedule(index + 1), TAB_PRELOAD_SETTLE_MS);
      });
    };

    const memorySub = AppState.addEventListener('memoryWarning', cancel);
    timer = setTimeout(() => schedule(0), TAB_PRELOAD_START_DELAY_MS);

    return () => {
      cancel();
      memorySub.remove();
      if (stopPreloading.current === cancel) stopPreloading.current = null;
    };
  }, [activeRouteName, appIsActive, homeEntryPending, homeIsForeground, navigation]);

  const handleTabPress = (routeName: string, isFocused: boolean) => {
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

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: insets.bottom,
          backgroundColor: theme.background,
          borderTopColor: theme.topBorder,
        },
      ]}
    >
      <View key={attempt} style={styles.row} onLayout={() => markHomeEntryAsset('tabs-layout', attempt)}>
        {TABS.map((tab) => {
          const route = routesByName.get(tab.name);
          if (!route) return null;
          const isFocused =
            state.index === state.routes.findIndex((r) => r.name === tab.name);
          return (
            <TabButton
              key={route.key}
              icon={tab.icon}
              asset={`tab:${tab.name}`}
              label={tab.label}
              isFocused={isFocused}
              labelColor={theme.label}
              activeBackground={theme.activeBackground}
              onPress={() => handleTabPress(tab.name, isFocused)}
            />
          );
        })}
      </View>
    </View>
  );
}

type TabButtonProps = {
  icon: ImageSourcePropType;
  asset: HomeEntryAsset;
  label: string;
  isFocused: boolean;
  labelColor: string;
  activeBackground: string;
  onPress: () => void;
};

function TabButton({ icon, asset, label, isFocused, labelColor, activeBackground, onPress }: TabButtonProps): ReactNode {
  // Focused pill wraps icon + label together with even padding (mock).
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isFocused }}
      style={[styles.tabBtn, isFocused && { backgroundColor: activeBackground }]}
    >
      <HomeEntryImage asset={asset} source={icon} style={styles.tabIcon} contentFit="contain" />
      <Text style={[styles.tabLabel, { color: labelColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
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
  tabBtn: {
    minWidth: 66, alignItems: 'center', justifyContent: 'center', gap: 2,
    paddingVertical: 7, paddingHorizontal: 10, borderRadius: 20,
  },
  tabIcon: { width: 40, height: 40 },
  tabLabel: { fontSize: 11, lineHeight: 13, fontFamily: 'Inter_700Bold' },
});

import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { haptics } from '@/lib/haptics';

/**
 * Custom bottom tab bar for the (main)/(tabs) layout.
 *
 * 1:1 visual replica of the old NovaMe Capacitor BottomNav (4 tabs +
 * a centered raised mic button between Growth and Discover), but built
 * on top of expo-router + react-navigation BottomTabBarProps.
 *
 * Layout:
 *   Home (/) | Growth | Mic (raised) | Discover | Assets
 *   ^^^ left two ^^^   ^^^ center ^^^   ^^^ right two ^^^
 *
 * The mic button is NOT a tab — it's a router.push to the
 * (main)/(modals)/record screen. Pressing it does not change the
 * underlying tab.
 *
 * Visual constants come from old BottomNav.js (Stage 3.6 prep
 * extracted these as authoritative):
 *   - Background: #0A0A0F (--color-bg-secondary)
 *   - Border-top: 1px rgba(255,255,255,0.04)
 *   - Tab item: 64x48, icon 22px, label 9px
 *   - Active color: #C084FC + drop-shadow rgba(168,85,247,0.6)
 *   - Inactive color: rgba(255,255,255,0.3)
 *   - Mic button: 52x52 round, gradient #A855F7 to #7C3AED,
 *     raised 20px above the bar
 *   - Tab row height: 56px + safe-area-inset-bottom
 */

// ---- icon mapping per route name ----

type IconName = keyof typeof MaterialIcons.glyphMap;

const ROUTE_ICONS: Record<string, IconName> = {
  index: 'home',
  growth: 'trending-up',
  discover: 'explore',
  assets: 'diamond',
};

const ROUTE_LABELS: Record<string, string> = {
  index: 'Home',
  growth: 'Growth',
  discover: 'Discover',
  assets: 'Assets',
};

/**
 * Custom tab bar — the function passed to <Tabs tabBar={...} />.
 *
 * Renders the 4 declared tab routes plus an interleaved center mic
 * button. The mic button does not consume a route slot in the
 * underlying navigator — it's purely an overlay button that triggers
 * router.push to /(main)/(modals)/record.
 */
export function BottomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Map of routeName -> route object so we can render in our own order
  // (and inject the mic button between index 1 and 2).
  const routesByName = new Map<string, (typeof state.routes)[number]>();
  state.routes.forEach((r) => routesByName.set(r.name, r));

  const order = ['index', 'growth', '__mic__', 'discover', 'assets'] as const;

  const handleTabPress = (routeName: string, isFocused: boolean) => {
    void haptics.light();
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

  const handleMicPress = () => {
    void haptics.medium();
    router.push('/(main)/(modals)/record');
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.row}>
        {order.map((slot) => {
          if (slot === '__mic__') {
            return <MicButton key="mic" onPress={handleMicPress} />;
          }
          const route = routesByName.get(slot);
          if (!route) return null;
          const isFocused =
            state.index === state.routes.findIndex((r) => r.name === slot);
          return (
            <TabButton
              key={route.key}
              icon={ROUTE_ICONS[slot]}
              label={ROUTE_LABELS[slot]}
              isFocused={isFocused}
              onPress={() => handleTabPress(slot, isFocused)}
            />
          );
        })}
      </View>
    </View>
  );
}

// ---- TabButton subcomponent ----

type TabButtonProps = {
  icon: IconName;
  label: string;
  isFocused: boolean;
  onPress: () => void;
};

function TabButton({ icon, label, isFocused, onPress }: TabButtonProps): ReactNode {
  const color = isFocused ? '#C084FC' : 'rgba(255,255,255,0.3)';
  return (
    <Pressable onPress={onPress} style={styles.tabBtn}>
      <MaterialIcons name={icon} size={22} color={color} />
      <Text style={[styles.tabLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

// ---- MicButton subcomponent ----

type MicButtonProps = {
  onPress: () => void;
};

function MicButton({ onPress }: MicButtonProps): ReactNode {
  return (
    <View style={styles.micWrap}>
      <Pressable onPress={onPress} style={styles.micBtn} hitSlop={8}>
        <MaterialIcons name="mic" size={26} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

// ---- styles ----

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0A0A0F',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    height: 56,
  },
  tabBtn: {
    width: 64,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabLabel: {
    fontSize: 9,
    lineHeight: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  micWrap: {
    width: 64,
    alignItems: 'center',
    marginTop: -20,
  },
  micBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#A855F7',
    alignItems: 'center',
    justifyContent: 'center',
    // Single-color background instead of gradient to avoid pulling in
    // expo-linear-gradient just for this. Visual difference is minor.
    shadowColor: '#A855F7',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
});

import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';

/**
 * Bottom tab bar for (main)/(tabs).
 *
 * v1 drew four tabs around a raised mic button, held centred by a '__mic__'
 * sentinel in the order array so that space-around split the row two and two.
 * Five real tabs leave no centre slot, so the sentinel, the mic styles, and
 * the AI-consent gate all go. Reflect is entered from Home now, next to Focus.
 *
 * Icons are placeholders; Phase C swaps in the illustrated set.
 */

type IconName = keyof typeof MaterialIcons.glyphMap;

const TABS: ReadonlyArray<{ name: string; icon: IconName; label: string }> = [
  { name: 'index', icon: 'home', label: 'Home' },
  { name: 'bags', icon: 'work', label: 'Bags' },
  { name: 'skills', icon: 'auto-awesome', label: 'Skills' },
  { name: 'friends', icon: 'people', label: 'Friends' },
  { name: 'status', icon: 'show-chart', label: 'Status' },
];

export function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  const routesByName = new Map<string, (typeof state.routes)[number]>();
  state.routes.forEach((r) => routesByName.set(r.name, r));

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

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.row}>
        {TABS.map((tab) => {
          const route = routesByName.get(tab.name);
          if (!route) return null;
          const isFocused =
            state.index === state.routes.findIndex((r) => r.name === tab.name);
          return (
            <TabButton
              key={route.key}
              icon={tab.icon}
              label={tab.label}
              isFocused={isFocused}
              onPress={() => handleTabPress(tab.name, isFocused)}
            />
          );
        })}
      </View>
    </View>
  );
}

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

const styles = StyleSheet.create({
  container: { backgroundColor: '#0A0A0F' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    height: 56,
  },
  tabBtn: { width: 64, height: 48, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabLabel: { fontSize: 9, lineHeight: 11, fontFamily: 'Inter_600SemiBold' },
});

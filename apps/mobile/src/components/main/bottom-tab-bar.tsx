import { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import type { ImageSourcePropType } from 'react-native';

import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';

/**
 * Bottom tab bar for (main)/(tabs). Five tabs with the illustrated icon set
 * (assets/Icons), on a warm cream bar to match the Home art. The focused tab
 * reads at full opacity; unfocused tabs dim slightly.
 */
const TABS: ReadonlyArray<{ name: string; icon: ImageSourcePropType; label: string }> = [
  { name: 'index', icon: ICONS.Home, label: 'Home' },
  { name: 'bags', icon: ICONS.Bags, label: 'Bags' },
  { name: 'quests', icon: ICONS.Quests, label: 'Quests' },
  { name: 'friends', icon: ICONS.Friends, label: 'Friends' },
  { name: 'status', icon: ICONS.Me, label: 'Me' },
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
  icon: ImageSourcePropType;
  label: string;
  isFocused: boolean;
  onPress: () => void;
};

function TabButton({ icon, label, isFocused, onPress }: TabButtonProps): ReactNode {
  // Focused pill wraps icon + label together with even padding (mock).
  return (
    <Pressable onPress={onPress} style={[styles.tabBtn, isFocused && styles.tabBtnActive]}>
      <Image source={icon} style={styles.tabIcon} resizeMode="contain" />
      <Text style={styles.tabLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#E8D5B0' },
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
  tabBtnActive: { backgroundColor: '#F8EFDA' },
  tabIcon: { width: 40, height: 40 },
  tabLabel: { fontSize: 11, lineHeight: 13, fontFamily: 'Inter_700Bold', color: '#5A4A32' },
});

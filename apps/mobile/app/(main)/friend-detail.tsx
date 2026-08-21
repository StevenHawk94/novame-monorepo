import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { useTheme } from '../../src/theme/use-theme';
import { fetchFriends, type FriendCard } from '../../src/lib/friends-api';
import { haptics } from '../../src/lib/haptics';

/**
 * Friend detail (C11a). A friend's day at a glance: the emoji of what they
 * collected today, enlarged. This is the whole window into their day -- no
 * reflections, by design. Guess Their Day (C11c) will live here.
 */
export default function FriendDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const { userId, name } = useLocalSearchParams<{ userId: string; name: string }>();
  const [friend, setFriend] = useState<FriendCard | null>(null);

  useFocusEffect(
    useCallback(() => {
      void fetchFriends().then((s) => {
        setFriend(s.friends.find((f) => f.userId === userId) ?? null);
      });
    }, [userId]),
  );

  return (
    <View style={[styles.root, { backgroundColor: c.bgPrimary, paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => { void haptics.pageClose(); router.back(); }} style={styles.back} hitSlop={12}>
        <MaterialIcons name="arrow-back" size={24} color={c.textSecondary} />
      </Pressable>

      <View style={styles.head}>
        <View style={[styles.avatar, { backgroundColor: c.bgCard }]}>
          <MaterialIcons name="pets" size={32} color={c.brand.primary} />
        </View>
        <Text style={[styles.name, { color: c.textPrimary }]}>{name}</Text>
        <Text style={[styles.sub, { color: c.textSecondary }]}>Today, at a glance</Text>
      </View>

      <ScrollView contentContainerStyle={styles.emojiWrap} showsVerticalScrollIndicator={false}>
        {friend && friend.todayEmoji.length > 0 ? (
          <View style={styles.emojiGrid}>
            {friend.todayEmoji.map((e, i) => (
              <View key={i} style={[styles.emojiCell, { backgroundColor: c.bgCard, borderColor: c.border }]}>
                <Text style={styles.emojiBig}>{e}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={[styles.noUpdate, { color: c.textMuted }]}>No update yet today.</Text>
        )}
      </ScrollView>

      {/* Guess Their Day (C11c) */}
      <Pressable
        onPress={() => {
          void haptics.pageOpen();
          router.push({ pathname: '/(main)/guess', params: { userId, name } });
        }}
        style={[styles.guessBtn, { backgroundColor: c.brand.primary, marginBottom: insets.bottom + 12 }]}
      >
        <MaterialIcons name="lightbulb-outline" size={20} color="#FFFFFF" />
        <Text style={styles.guessText}>Guess their day</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  back: { alignSelf: 'flex-start', paddingVertical: 8 },
  head: { alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 24 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular' },

  emojiWrap: { flexGrow: 1, alignItems: 'center' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
  emojiCell: { width: 72, height: 72, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emojiBig: { fontSize: 36 },
  noUpdate: { fontSize: 15, fontFamily: 'Inter_400Regular', marginTop: 40 },

  guessBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 16 },
  guessText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
});

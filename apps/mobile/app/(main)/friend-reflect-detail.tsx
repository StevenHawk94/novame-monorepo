import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { CaveShell } from '@/components/main/cave-shell';
import { ItemSprite } from '@/components/ui/item-sprite';
import { UserAvatar } from '@/components/ui/user-avatar';
import { getCachedFriends } from '@/lib/friends-api';

/**
 * Friend reflect detail (mock 1:1): one reflect's memories inside the cave
 * shell — avatar + name + time-ago header, then an outlined card per item
 * (blank tile + the friend's memory text). Reached only when the friend
 * shares details (server never sends the text otherwise).
 */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function FriendReflectDetailScreen() {
  const { friendUserId, friendName, createdAt, detailsJson } = useLocalSearchParams<{
    friendUserId?: string;
    friendName?: string;
    createdAt?: string;
    detailsJson?: string;
  }>();
  const name = typeof friendName === 'string' && friendName ? friendName : 'Friend';
  const cachedFriend = getCachedFriends().friends.find((f) => f.userId === friendUserId);

  const details = useMemo<{ itemId: string; text: string }[]>(() => {
    if (typeof detailsJson !== 'string' || !detailsJson) return [];
    try {
      const arr = JSON.parse(detailsJson) as unknown;
      if (Array.isArray(arr)) return arr as { itemId: string; text: string }[];
    } catch {
      // broken param → empty list
    }
    return [];
  }, [detailsJson]);

  return (
    <CaveShell>
      <View style={styles.header}>
        <UserAvatar userId={typeof friendUserId === 'string' ? friendUserId : null} avatarUrl={cachedFriend?.avatarUrl} isDefaultAvatar={cachedFriend?.isDefaultAvatar} size={46} />
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {typeof createdAt === 'string' && !!createdAt && (
          <Text style={styles.time}>{timeAgo(createdAt)}</Text>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {details.length > 0 ? details.map((d, i) => (
          <View key={`${d.itemId}:${i}`} style={styles.memCard}>
            <ItemSprite itemId={d.itemId} size={72} radius={14} />
            <Text style={styles.memText}>{d.text}</Text>
          </View>
        )) : (
          <Text style={styles.emptyText}>No memories created today.</Text>
        )}
      </ScrollView>
    </CaveShell>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  name: { flex: 1, fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#1B1B1B' },
  time: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#9A8770' },

  scroll: { gap: 14, paddingBottom: 80 },
  emptyText: {
    paddingVertical: 48, paddingHorizontal: 20, textAlign: 'center',
    fontSize: 16, lineHeight: 24, fontFamily: 'Inter_600SemiBold', color: '#8A7A63',
  },
  memCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1.5, borderColor: '#E5C8B8',
    padding: 16,
  },
  blankTile: { width: 72, height: 72, borderRadius: 14, backgroundColor: '#F4F1F8' },
  memText: { flex: 1, fontSize: 16, fontFamily: 'Inter_500Medium', color: '#1B1B1B', lineHeight: 24 },
});

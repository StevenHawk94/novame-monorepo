import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { CaveShell } from '@/components/main/cave-shell';
import { ItemSprite } from '@/components/ui/item-sprite';

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
  const { friendName, createdAt, detailsJson } = useLocalSearchParams<{
    friendName?: string;
    createdAt?: string;
    detailsJson?: string;
  }>();
  const name = typeof friendName === 'string' && friendName ? friendName : 'Friend';

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
        <View style={styles.avatar}><Text style={styles.avatarEmoji}>{'🐰'}</Text></View>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {typeof createdAt === 'string' && !!createdAt && (
          <Text style={styles.time}>{timeAgo(createdAt)}</Text>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {details.map((d, i) => (
          <View key={`${d.itemId}:${i}`} style={styles.memCard}>
            <ItemSprite itemId={d.itemId} size={72} radius={14} />
            <Text style={styles.memText}>{d.text}</Text>
          </View>
        ))}
      </ScrollView>
    </CaveShell>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  avatar: { width: 66, height: 66, borderRadius: 33, backgroundColor: '#F4F1F8', alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 32 },
  name: { flex: 1, fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#1B1B1B' },
  time: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#9A8770' },

  scroll: { gap: 14, paddingBottom: 80 },
  memCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1.5, borderColor: '#E5C8B8',
    padding: 16,
  },
  blankTile: { width: 72, height: 72, borderRadius: 14, backgroundColor: '#F4F1F8' },
  memText: { flex: 1, fontSize: 16, fontFamily: 'Inter_500Medium', color: '#1B1B1B', lineHeight: 24 },
});

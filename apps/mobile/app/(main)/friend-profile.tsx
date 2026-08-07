import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { CaveShell } from '@/components/main/cave-shell';
import { FRIEND_ICONS } from '@/lib/icons';
import { fetchFriendFeed, getCachedFriendFeed, markFriendRead, type FeedEntry } from '@/lib/friends-api';
import { ItemSprite } from '@/components/ui/item-sprite';

/**
 * Friend Profile (mock 1:1): the friend's history inside the cave shell —
 * header with avatar, name and the Shared Memories chip; one outlined card
 * per reflect (calendar + date, blank item tiles, +N chip, Details pill).
 * Details appears only when the friend shares their memory text (PRD).
 */
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

export default function FriendProfileScreen() {
  const router = useRouter();
  const { friendUserId, friendName } = useLocalSearchParams<{ friendUserId: string; friendName?: string }>();
  const name = typeof friendName === 'string' && friendName ? friendName : 'Friend';
  // Tiles are 56pt + 8 gap; reserve room for the +N chip and the Details pill
  // so they stay inside the card (fixed 4 overflowed at 375pt width).
  const { width } = useWindowDimensions();
  const maxTiles = Math.min(4, Math.max(2, Math.floor((width - 190) / 64)));
  // Cache-first: this friend's slice of the cached feed paints instantly.
  const [entries, setEntries] = useState<FeedEntry[]>(() =>
    typeof friendUserId === 'string'
      ? getCachedFriendFeed().filter((e) => e.friendUserId === friendUserId)
      : [],
  );

  useFocusEffect(
    useCallback(() => {
      if (typeof friendUserId !== 'string' || !friendUserId) return;
      void fetchFriendFeed().then((feed) => {
        setEntries(feed.filter((e) => e.friendUserId === friendUserId));
      });
      void markFriendRead(friendUserId);
    }, [friendUserId]),
  );

  function openDetail(e: FeedEntry) {
    void haptics.light();
    router.push({
      pathname: '/(main)/friend-reflect-detail' as never,
      params: {
        friendName: e.friendName,
        createdAt: e.createdAt,
        detailsJson: JSON.stringify(e.details ?? []),
      },
    } as never);
  }

  return (
    <CaveShell>
      {/* header */}
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarEmoji}>{'🐰'}</Text></View>
        <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{name}</Text>
        <Pressable
          onPress={() => {
            void haptics.light();
            router.push({
              pathname: '/(main)/friend-memories' as never,
              params: { friendUserId, friendName: name },
            } as never);
          }}
          style={({ pressed }) => [styles.memChip, pressed && { transform: [{ translateY: 2 }] }]}
        >
          <Image source={FRIEND_ICONS.sharedMemories} style={styles.memChipIcon} resizeMode="contain" />
          <Text style={styles.memChipText} numberOfLines={1}>Shared Memories</Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {entries.length === 0 ? (
          <Text style={styles.empty}>Nothing here yet — their memory items will show up as they reflect.</Text>
        ) : (
          entries.map((e) => (
            <View key={e.reflectId} style={styles.entryCard}>
              <View style={styles.dateRow}>
                <Image source={FRIEND_ICONS.calendar} style={styles.calendarIcon} resizeMode="contain" />
                <Text style={styles.dateText}>{fmtDate(e.createdAt)}</Text>
              </View>
              <View style={styles.tilesRow}>
                {e.itemIds.slice(0, maxTiles).map((id, i) => (
                  <ItemSprite key={`${id}:${i}`} itemId={id} size={56} radius={12} />
                ))}
                {e.itemIds.length > maxTiles && (
                  <View style={styles.moreChip}>
                    <Text style={styles.moreChipText}>+{e.itemIds.length - maxTiles}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }} />
                {e.sharesDetails && e.details && e.details.length > 0 && (
                  <Pressable onPress={() => openDetail(e)} style={styles.detailsBtn}>
                    <Text style={styles.detailsText}>Details</Text>
                    <MaterialIcons name="chevron-right" size={18} color="#FFFFFF" />
                  </Pressable>
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </CaveShell>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  avatar: { width: 66, height: 66, borderRadius: 33, backgroundColor: '#F4F1F8', alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 32 },
  name: { flex: 1, fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#1B1B1B' },
  memChip: {
    flexShrink: 1,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#4A3220', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: '#D98B4B', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  memChipIcon: { width: 24, height: 24 },
  memChipText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_800ExtraBold' },

  scroll: { gap: 14, paddingBottom: 80 },
  empty: {
    fontSize: 14, fontFamily: 'Inter_500Medium', color: '#8A7A63',
    textAlign: 'center', lineHeight: 21, paddingVertical: 40, paddingHorizontal: 20,
  },
  entryCard: {
    backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1.5, borderColor: '#E5C8B8',
    padding: 14, gap: 12,
  },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  calendarIcon: { width: 26, height: 26 },
  dateText: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#1B1B1B' },
  tilesRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  blankTile: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#F4F1F8' },
  moreChip: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: '#F0D9AC',
    alignItems: 'center', justifyContent: 'center',
  },
  moreChipText: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#1B1B1B' },
  detailsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#4A3220', borderRadius: 18, paddingLeft: 16, paddingRight: 10, paddingVertical: 12,
  },
  detailsText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },
});

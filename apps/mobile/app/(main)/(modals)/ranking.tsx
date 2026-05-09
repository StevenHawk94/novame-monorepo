import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { haptics } from '@/lib/haptics';
import {
  fetchLeaderboardWithCache,
  getCachedLeaderboard,
  type LeaderboardEntry,
} from '@/lib/leaderboard-api';

/**
 * Leaderboard overlay -- Stage 3.10.3 C.
 *
 * Top-50 ranking by total wisdom-creation minutes (relabeled "exp" in
 * the UI for consistency with the old web). 1:1 mirror of the legacy
 * RankingOverlay layout: top-3 podium + list 4-N.
 *
 * Data flow:
 *   - On mount, GET /api/leaderboard?period=all&limit=50
 *   - Server merges curated seeds + real users, returns pre-ranked.
 *   - Mobile renders top-3 in podium (2nd left / 1st center / 3rd right),
 *     remaining ranks in a list.
 *   - Avatars are public Supabase URLs; null/broken URLs fall back to
 *     a MaterialIcons person glyph.
 *
 * No caching -- this is a low-frequency, time-sensitive view (users
 * want to see live ranks). Each entry refetches.
 */

export default function RankingModal() {
  const insets = useSafeAreaInsets();

  const [entries, setEntries] = useState<LeaderboardEntry[]>(
    () => getCachedLeaderboard() ?? [],
  );
  const [loading, setLoading] = useState(() => getCachedLeaderboard() === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Stage 6 SWR: only show spinner if no cache. Otherwise silent
      // background refresh; user sees prior leaderboard immediately.
      const hasCache = getCachedLeaderboard() !== null;
      if (!hasCache) setLoading(true);
      const res = await fetchLeaderboardWithCache(50);
      if (cancelled) return;
      if (res.kind === 'success') {
        setEntries(res.entries);
        setError(null);
      } else {
        setError(res.message);
      }
      if (!hasCache) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClose = () => {
    void haptics.light();
    router.back();
  };

  const topThree = entries.slice(0, 3);
  const restOfList = entries.slice(3);

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>Leaderboard</Text>
      </View>

      {/* Body */}
      {loading ? (
        <View style={styles.centerFlex}>
          <ActivityIndicator color="#A855F7" size="large" />
        </View>
      ) : error ? (
        <View style={styles.centerFlex}>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.centerFlex}>
          <Text style={styles.emptyText}>No data for this period yet</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Top 3 Podium */}
          {topThree.length >= 3 ? (
            <View style={styles.podiumRow}>
              {/* 2nd Place (left) */}
              <PodiumSlot
                entry={topThree[1]}
                size="small"
                badgeColor="rgba(255,255,255,0.15)"
                badgeTextColor="#FFFFFF"
                avatarBorderColor="rgba(255,255,255,0.2)"
                badgeNumber="2"
              />

              {/* 1st Place (center, larger, with trophy badge) */}
              <PodiumSlot
                entry={topThree[0]}
                size="large"
                badgeColor="#FBBF24"
                badgeTextColor="#78350F"
                avatarBorderColor="#FBBF24"
                trophy
              />

              {/* 3rd Place (right) */}
              <PodiumSlot
                entry={topThree[2]}
                size="small"
                badgeColor="#F97316"
                badgeTextColor="#7C2D12"
                avatarBorderColor="#F97316"
                badgeNumber="3"
              />
            </View>
          ) : null}

          {/* List 4-N */}
          <View style={styles.list}>
            {restOfList.map((entry) => (
              <ListRow key={entry.userId} entry={entry} />
            ))}
          </View>
        </ScrollView>
      )}

      {/* Close */}
      <View
        style={[
          styles.closeWrap,
          { paddingBottom: insets.bottom + 16 },
        ]}
      >
        <Pressable
          onPress={handleClose}
          style={({ pressed }) => [
            styles.closeBtn,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.closeBtnText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---- sub-components ----

type PodiumSlotProps = {
  entry: LeaderboardEntry | undefined;
  size: 'small' | 'large';
  badgeColor: string;
  badgeTextColor: string;
  avatarBorderColor: string;
  badgeNumber?: string;
  trophy?: boolean;
};

function PodiumSlot({
  entry,
  size,
  badgeColor,
  badgeTextColor,
  avatarBorderColor,
  badgeNumber,
  trophy,
}: PodiumSlotProps) {
  if (!entry) return <View style={{ width: size === 'large' ? 80 : 64 }} />;
  const avatarSize = size === 'large' ? 80 : 64;
  const badgeSize = size === 'large' ? 36 : 28;

  return (
    <View style={styles.podiumSlot}>
      <View
        style={[
          styles.podiumAvatar,
          {
            width: avatarSize,
            height: avatarSize,
            borderRadius: avatarSize / 2,
            borderColor: avatarBorderColor,
          },
        ]}
      >
        <AvatarImage uri={entry.avatar} />
      </View>
      <View
        style={[
          styles.podiumBadge,
          {
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            backgroundColor: badgeColor,
            marginTop: -badgeSize / 2,
          },
        ]}
      >
        {trophy ? (
          <MaterialIcons name="emoji-events" size={20} color={badgeTextColor} />
        ) : (
          <Text style={[styles.podiumBadgeText, { color: badgeTextColor }]}>
            {badgeNumber}
          </Text>
        )}
      </View>
      <Text
        style={[
          styles.podiumName,
          size === 'large' ? styles.podiumNameLarge : styles.podiumNameSmall,
        ]}
        numberOfLines={1}
      >
        {entry.name}
      </Text>
      <Text
        style={[
          styles.podiumExp,
          size === 'large' ? styles.podiumExpLarge : styles.podiumExpSmall,
        ]}
      >
        {entry.totalMinutes} exp
      </Text>
    </View>
  );
}

function ListRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <View style={styles.listRow}>
      <View style={styles.rankCircle}>
        <Text style={styles.rankText}>{entry.rank}</Text>
      </View>
      <View style={styles.listAvatar}>
        <AvatarImage uri={entry.avatar} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.listName} numberOfLines={1}>
          {entry.name}
        </Text>
      </View>
      <View style={styles.listExpWrap}>
        <Text style={styles.listExpValue}>{entry.totalMinutes}</Text>
        <Text style={styles.listExpLabel}>exp</Text>
      </View>
    </View>
  );
}

function AvatarImage({ uri }: { uri: string | null }) {
  const [errored, setErrored] = useState(false);
  if (!uri || errored) {
    return (
      <View style={styles.avatarFallback}>
        <MaterialIcons name="person" size={24} color="rgba(255,255,255,0.3)" />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={styles.avatarImg}
      contentFit="cover"
      onError={() => setErrored(true)}
    />
  );
}

// ---- styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  centerFlex: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  // Podium
  podiumRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 16,
    marginBottom: 32,
  },
  podiumSlot: {
    alignItems: 'center',
  },
  podiumAvatar: {
    borderWidth: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
  },
  podiumBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  podiumBadgeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  podiumName: {
    color: '#FFFFFF',
    textAlign: 'center',
    fontWeight: '700',
  },
  podiumNameLarge: {
    fontSize: 13,
    maxWidth: 90,
  },
  podiumNameSmall: {
    fontSize: 12,
    maxWidth: 80,
  },
  podiumExp: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
  },
  podiumExpLarge: {
    fontSize: 12,
  },
  podiumExpSmall: {
    fontSize: 11,
  },
  // List
  list: {
    gap: 8,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  rankCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  rankText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '700',
  },
  listAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  listName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  listExpWrap: {
    alignItems: 'flex-end',
  },
  listExpValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  listExpLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    marginTop: 1,
  },
  // Avatar fallback
  avatarFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  // Close
  closeWrap: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  closeBtn: {
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { HowItWorksOverlay } from '@/components/main/how-it-works-overlay';
import { BACKGROUNDS, FRIEND_ICONS } from '@/lib/icons';
import { ItemSprite } from '@/components/ui/item-sprite';
import {
  fetchFriends, fetchFriendFeed, markFriendRead,
  getCachedFriends, getCachedFriendFeed, fetchPairing,
  fetchSharePrivacy, setSharePrivacy, respondFriend,
  type FriendsStatus, type FeedEntry, type PairingStatus, type PendingRequest,
} from '@/lib/friends-api';

/**
 * Friends Cave (mocks 1:1). Full-bleed meadow art; centered title; mail
 * (→ Add Friends page, badge = incoming requests) and the privacy gear at
 * top-right. Empty state centers the Add Friends pill + invite line over the
 * soil; with friends, the pill sits under the title above the cream Messages
 * panel ("Latest memories of your friends" + the Friends List chip).
 *
 * Item art isn't ready — item slots render as blank tiles on purpose.
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

export default function FriendsScreen() {
  const router = useRouter();
  // Narrow screens (iPhone SE) fit 3 item tiles per feed row; wider fit 4.
  const { width, height } = useWindowDimensions();
  const maxTiles = width < 400 ? 3 : 4;
  // Paired-card tile sizing (mock 2026-08-08): tiles fill the full row width
  // edge-to-edge. Inner width = window − panel margins/padding − card padding;
  // ~56pt targets pick the column count, then the size stretches to fill.
  const pairRowWidth = width - 24 - 28 - 24;
  const pairCols = Math.max(4, Math.floor((pairRowWidth + 8) / (56 + 8)));
  const pairTile = Math.floor((pairRowWidth - (pairCols - 1) * 8) / pairCols);
  // Cache-first: paint the last visit instantly, refresh in the background.
  const [status, setStatus] = useState<FriendsStatus>(() => getCachedFriends());
  const [feed, setFeed] = useState<FeedEntry[]>(() => getCachedFriendFeed());
  const [pairing, setPairing] = useState<PairingStatus | null>(null);
  const [howItWorks, setHowItWorks] = useState(false);

  const load = useCallback(() => {
    void fetchFriends().then(setStatus);
    void fetchFriendFeed().then(setFeed);
    void fetchPairing().then(setPairing);
  }, []);
  useFocusEffect(load);

  function onPrivacyGear() {
    void haptics.light();
    void fetchSharePrivacy().then((share) => {
      appAlert(
        'Memory details',
        share
          ? 'Friends can currently read the details behind your memory items.'
          : 'Your memory details are private — friends only see item icons.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: share ? 'Make private' : 'Share with friends',
            onPress: () => {
              void setSharePrivacy(!share).then((ok) => {
                if (ok) void haptics.success();
              });
            },
          },
        ],
      );
    });
  }

  async function onRespond(req: PendingRequest, action: 'accept' | 'decline') {
    void haptics.medium();
    const res = await respondFriend(req.friendshipId, action);
    if (res.ok) {
      if (action === 'accept') void haptics.success();
      load();
    } else if (res.error === 'friend_limit_reached') {
      appAlert('Slots full', 'Your friend slots are full. Burrow Plus holds 99.');
    }
  }


  function onFeedRow(e: FeedEntry) {
    void haptics.light();
    if (e.unread) {
      void markFriendRead(e.friendUserId);
      setFeed((cur) => cur.map((x) => (x.friendUserId === e.friendUserId ? { ...x, unread: false } : x)));
    }
    // No detail screen when the friend hasn't shared details (details null)
    // or this reflect carries no written text (empty/blank entries).
    if (e.details && e.details.some((d) => d.text && d.text.trim().length > 0)) {
      router.push({
        pathname: '/(main)/friend-reflect-detail' as never,
        params: {
          friendName: e.friendName,
          createdAt: e.createdAt,
          detailsJson: JSON.stringify(e.details),
        },
      } as never);
    } else {
      appAlert('This Reflect is Private.', 'Your friend keeps the words to themselves — the items are the message.');
    }
  }

  const pendingCount = status.pending.length;
  const paired = !!pairing?.paired && !!pairing.partner;
  // 2026-07-24 pairing-first: the cave centers on the ONE paired person; the
  // feed shows only their rows once paired.
  const shownFeed = paired
    ? feed.filter((e) => e.friendUserId === pairing?.partner?.userId)
    : feed;

  const addPill = (
    <Pressable
      onPress={() => { void haptics.medium(); router.push('/(main)/friend-add' as never); }}
      style={({ pressed }) => [styles.addPill, pressed && { transform: [{ translateY: 2 }] }]}
    >
      <View style={styles.addPlus}><MaterialIcons name="add" size={19} color="#FFFFFF" /></View>
      <Text style={styles.addPillText}>Pair Friend</Text>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      {/* Top-anchored art: the meadow/mailbox top stays fully visible; any
          overflow crops from the BOTTOM (design note). */}
      <ExpoImage
        source={BACKGROUNDS.friends}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        contentPosition="top"
      />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* header: centered title, mail + gear at right */}
        <View style={styles.headerRow}>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>Memories Cave</Text>
          <View style={styles.headerIcons}>
            <Pressable
              onPress={() => { void haptics.light(); router.push('/(main)/friend-add' as never); }}
              style={styles.iconBtn}
              hitSlop={6}
            >
              <Text style={styles.mailEmoji}>{'💌'}</Text>
              {pendingCount > 0 && (
                <View style={styles.badge}><Text style={styles.badgeText}>{pendingCount}</Text></View>
              )}
            </Pressable>
            <Pressable onPress={onPrivacyGear} style={styles.iconBtn} hitSlop={6}>
              <Image source={FRIEND_ICONS.setting} style={styles.gearIcon} resizeMode="contain" />
            </Pressable>
          </View>
        </View>

        {paired ? (
          <>
            {/* cream messages panel BELOW the banner art (mock 2026-08-08):
                the meadow/mailbox stays fully visible; the feed scrolls
                inside the panel underneath it. */}
            <View style={[styles.panel, { marginTop: Math.max(110, Math.round(height * 0.17)) }]}>
              <View style={styles.panelHeader}>
                <View style={styles.listDot}>
                  <MaterialIcons name="menu" size={13} color="#FFFFFF" />
                </View>
                <Text style={styles.panelTitle}>Latest memories of your paired</Text>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.feedScroll}>
                {shownFeed.length === 0 ? (
                  <Text style={styles.emptyFeedText}>
                    Nothing yet today — their memories will land here.
                  </Text>
                ) : (
                  shownFeed.map((e) => (
                    <Pressable
                      key={`${e.friendUserId}:${e.reflectId}`}
                      onPress={() => onFeedRow(e)}
                      style={styles.pairCard}
                    >
                      <View style={styles.pairCardHeader}>
                        <View style={styles.avatar}><Text style={styles.avatarEmoji}>{'🐰'}</Text></View>
                        <Text style={styles.pairCardName} numberOfLines={1}>{e.friendName}</Text>
                        <View style={styles.pairCardTimeCol}>
                          <Text style={styles.timeText}>{timeAgo(e.createdAt)}</Text>
                          {e.unread && <View style={styles.unreadDot} />}
                        </View>
                      </View>
                      {/* Every item, wrapping — no truncation (mock 2026-08-08). */}
                      <View style={styles.pairCardTiles}>
                        {e.itemIds.map((id, i) => (
                          <ItemSprite key={`${id}:${i}`} itemId={id} size={pairTile} radius={12} />
                        ))}
                      </View>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </View>
          </>
        ) : (
          /* unpaired: incoming invitations take the stage (mock 4, Pending
             Confirmation); otherwise the Pair Friend pill + line (mock 1). */
          <View style={{ flex: 1 }}>
            {pendingCount > 0 ? (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pendingWrap}>
                <Text style={styles.pendingTitle}>Pending Confirmation</Text>
                {status.pending.map((req) => (
                  <View key={req.friendshipId} style={styles.pendingCard}>
                    <View style={styles.pendingAvatar}><Text style={styles.pendingAvatarEmoji}>{'🐰'}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pendingName} numberOfLines={1}>{req.displayName}</Text>
                      <Text style={styles.pendingRel} numberOfLines={1}>{req.relationship ?? 'Wants to pair'}</Text>
                    </View>
                    <Pressable onPress={() => void onRespond(req, 'decline')} style={styles.ignoreBtn}>
                      <Text style={styles.ignoreText}>Ignore</Text>
                    </Pressable>
                    <Pressable onPress={() => void onRespond(req, 'accept')} style={styles.acceptBtn}>
                      <Text style={styles.acceptText}>Accept</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.emptyWrap}>
                {addPill}
                <Text style={styles.emptyInvite}>
                  Pair with some you care and love,{'\n'}then create memories together!
                </Text>
                <Pressable
                  onPress={() => { void haptics.medium(); setHowItWorks(true); }}
                  style={({ pressed }) => [styles.demoBtn, pressed && { opacity: 0.85 }]}
                >
                  <MaterialIcons name="auto-awesome" size={17} color="#FFF6E8" />
                  <Text style={styles.demoBtnText}>How It Works</Text>
                </Pressable>
              </View>
            )}
            {shownFeed.length > 0 && (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.feedScroll, { paddingHorizontal: 14, paddingBottom: 16 }]}
                style={{ maxHeight: 220 }}
              >
                {shownFeed.map((e) => (
                  <Pressable
                    key={`${e.friendUserId}:${e.reflectId}`}
                    onPress={() => onFeedRow(e)}
                    style={styles.feedRow}
                  >
                    <View style={styles.avatar}><Text style={styles.avatarEmoji}>{'🐰'}</Text></View>
                    <Text style={styles.feedName} numberOfLines={1}>{e.friendName}</Text>
                    <View style={styles.tileRow}>
                      {e.itemIds.slice(0, maxTiles).map((id, i) => (
                        <ItemSprite key={`${id}:${i}`} itemId={id} size={38} radius={10} />
                      ))}
                      {e.itemIds.length > maxTiles && (
                        <View style={styles.blankTile}>
                          <Text style={styles.moreText}>+{e.itemIds.length - maxTiles}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.timeText}>{timeAgo(e.createdAt)}</Text>
                    {e.unread && <View style={styles.unreadDot} />}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        )}
      </SafeAreaView>
      {howItWorks && <HowItWorksOverlay onClose={() => setHowItWorks(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#6B4226' },

  headerRow: { height: 52, justifyContent: 'center' },
  title: { fontSize: 30, fontFamily: 'Inter_800ExtraBold', color: '#4A3220', textAlign: 'center', paddingHorizontal: 110 },
  headerIcons: { position: 'absolute', right: 14, top: 0, flexDirection: 'row', gap: 10 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  mailEmoji: { fontSize: 30 },
  gearIcon: { width: 34, height: 34 },
  badge: {
    position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#E5483C', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontFamily: 'Inter_800ExtraBold' },

  addPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 28, paddingHorizontal: 24, paddingVertical: 13,
    shadowColor: '#2B2B2B', shadowOpacity: 0.3, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  addPlus: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#2E8B57', alignItems: 'center', justifyContent: 'center' },
  addPillText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  pillUnderTitle: { marginTop: 6 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, paddingBottom: 60 },
  emptyInvite: {
    fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF',
    textAlign: 'center', lineHeight: 27,
  },
  demoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,246,232,0.18)', borderWidth: 1.5, borderColor: 'rgba(255,246,232,0.55)',
    borderRadius: 22, paddingHorizontal: 18, paddingVertical: 11,
  },
  demoBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF6E8' },
  demoEndBtn: { backgroundColor: '#4A3220', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  demoEndText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_700Bold' },
  demoHint: {
    fontSize: 12.5, fontFamily: 'Inter_500Medium', color: '#8A7A63',
    textAlign: 'center', lineHeight: 18, marginBottom: 4, paddingHorizontal: 8,
  },

  pendingWrap: { paddingHorizontal: 16, paddingTop: 48, paddingBottom: 24, gap: 16 },
  pendingTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center' },
  pendingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFFFF', borderRadius: 26, padding: 14,
    shadowColor: '#2B2B2B', shadowOpacity: 0.25, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  pendingAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#E9F2E4', alignItems: 'center', justifyContent: 'center' },
  pendingAvatarEmoji: { fontSize: 28 },
  pendingName: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  pendingRel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#6B5A45', marginTop: 2 },
  ignoreBtn: { flexShrink: 1, backgroundColor: '#F5EBD3', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  ignoreText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#6B5A45' },
  acceptBtn: { flexShrink: 1, backgroundColor: '#2E8B57', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  acceptText: { fontSize: 14, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },

  panel: {
    flex: 1, marginHorizontal: 12, marginTop: 16, marginBottom: 8,
    backgroundColor: '#F5EBDD', borderRadius: 30, padding: 14,
  },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  listDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#3A2E1A', alignItems: 'center', justifyContent: 'center' },
  panelTitle: { flex: 1, fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  listChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#4A3220', borderRadius: 15, paddingHorizontal: 13, paddingVertical: 9,
    shadowColor: '#D98B4B', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  listChipIcon: { width: 26, height: 26 },
  listChipText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_800ExtraBold' },

  feedScroll: { gap: 10, paddingBottom: 8 },
  // Paired feed card (mock 2026-08-08): header row + full wrapping tile grid.
  pairCard: {
    backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 12, paddingHorizontal: 12,
    gap: 10,
    shadowColor: '#C9A97C', shadowOpacity: 0.5, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  pairCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pairCardName: { flex: 1, fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  pairCardTimeCol: { alignItems: 'flex-end', gap: 5 },
  pairCardTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' },
  emptyFeedText: {
    fontSize: 14, fontFamily: 'Inter_500Medium', color: '#8A7A63',
    textAlign: 'center', lineHeight: 21, paddingVertical: 28, paddingHorizontal: 14,
  },
  feedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: 24, paddingVertical: 12, paddingHorizontal: 12,
    shadowColor: '#5A4A2B', shadowOpacity: 0.15, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#F4F1F8', alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 24 },
  feedName: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', maxWidth: 84 },
  tileRow: { flexDirection: 'row', gap: 5, flex: 1, flexShrink: 1, justifyContent: 'center', overflow: 'hidden' },
  blankTile: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: '#F4F1F8',
    alignItems: 'center', justifyContent: 'center',
  },
  moreText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#8B7FD9' },
  timeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#9A8770' },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#E5483C' },
});

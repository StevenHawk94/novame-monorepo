import { useCallback, useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { HowItWorksOverlay } from '@/components/main/how-it-works-overlay';
import { BACKGROUNDS, FRIEND_ICONS, ICONS } from '@/lib/icons';
import { ItemSprite } from '@/components/ui/item-sprite';
import { UserAvatar } from '@/components/ui/user-avatar';
import { GridBackground } from '@/components/ui/grid-background';
import { DateRangeCalendar } from '@/components/ui/date-range-calendar';
import { OffsetCard } from '@/components/ui/offset-card';
import { GoodVibesPicker } from '@/components/main/good-vibes';
import {
  fetchFriends, fetchFriendFeed, markFriendRead,
  getCachedFriends, getCachedFriendFeed, getCachedPairing, fetchPairing,
  fetchSharePrivacy, setSharePrivacy, respondFriend,
  type FriendsStatus, type FeedEntry, type PairingStatus, type PendingRequest, type MemoryDetailsMode,
} from '@/lib/friends-api';
import { subscribePairingRealtime } from '@/lib/pairing-realtime';

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
  const insets = useSafeAreaInsets();
  // Narrow screens (iPhone SE) fit 3 item tiles per feed row; wider fit 4.
  const { width, height } = useWindowDimensions();
  const maxTiles = width < 400 ? 3 : 4;
  // Paired-card tile sizing (mock 2026-08-08): tiles fill the full row width
  // edge-to-edge. Inner width = window − panel margins/padding − card padding;
  // ~56pt targets pick the column count, then the size stretches to fill.
  const pairRowWidth = width - 24 - 28 - 24;
  // +1 over the ~56pt target: one extra tile per row, slightly smaller.
  const pairCols = Math.max(5, Math.floor((pairRowWidth + 8) / (56 + 8)) + 1);
  const pairTile = Math.floor((pairRowWidth - (pairCols - 1) * 8) / pairCols);
  // Cache-first: paint the last visit instantly, refresh in the background.
  const [status, setStatus] = useState<FriendsStatus>(() => getCachedFriends());
  const [feed, setFeed] = useState<FeedEntry[]>(() => getCachedFriendFeed());
  const [pairing, setPairing] = useState<PairingStatus | null>(() => getCachedPairing());
  const [howItWorks, setHowItWorks] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [vibesOpen, setVibesOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [privacyMode, setPrivacyMode] = useState<MemoryDetailsMode>('custom');
  const [privacySaving, setPrivacySaving] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetchFriends().then(setStatus);
    void fetchPairing().then((nextPairing) => {
      setPairing(nextPairing);
      if (!nextPairing.paired) {
        setFeed([]);
        return;
      }
      void fetchFriendFeed().then(setFeed);
    });
  }, []);
  useFocusEffect(load);

  // The accepting device refreshes synchronously in respondFriend(). The
  // requester can remain on this screen, so listen for the private server
  // invalidation and apply the already-refreshed snapshots immediately.
  useEffect(() => subscribePairingRealtime((snapshot) => {
    setStatus(snapshot.friends);
    setPairing(snapshot.pairing);
    setFeed(snapshot.pairing.paired ? snapshot.feed : []);
  }), []);

  function onPrivacyGear() {
    void haptics.pageOpen();
    setPrivacyOpen(true);
    void fetchSharePrivacy().then(setPrivacyMode);
  }

  async function savePrivacy() {
    if (privacySaving) return;
    setPrivacySaving(true);
    const ok = await setSharePrivacy(privacyMode);
    setPrivacySaving(false);
    if (ok) {
      void haptics.success();
      setPrivacyOpen(false);
      load();
    } else {
      appAlert('Could not save', 'Please check your connection and try again.');
    }
  }

  async function showRange(start: string | null, end: string | null) {
    if (!start) {
      setFeed(await fetchFriendFeed());
      return;
    }
    setFeed(await fetchFriendFeed({ start, end: end ?? start }));
  }

  async function onAccept(req: PendingRequest) {
    if (acceptingId) return;
    setAcceptingId(req.friendshipId);
    void haptics.medium();
    const res = await respondFriend(req.friendshipId);
    if (res.ok) {
      void haptics.success();
      load();
    } else if (res.error === 'already_paired' || res.error === 'requester_already_paired') {
      appAlert('Pairing unavailable', 'One of you is already paired. Refresh to see the latest status.');
      load();
    } else {
      appAlert('Could not accept', 'Please check your connection and try again.');
    }
    setAcceptingId(null);
  }


  function onFeedRow(e: FeedEntry) {
    if (e.unread) {
      void markFriendRead(e.friendUserId);
      setFeed((cur) => cur.map((x) => (x.friendUserId === e.friendUserId ? { ...x, unread: false } : x)));
    }
    // No detail screen when the friend hasn't shared details (details null)
    // or this reflect carries no written text (empty/blank entries).
    if (e.details && e.details.some((d) => d.text && d.text.trim().length > 0)) {
      void haptics.pageOpen();
      router.push({
        pathname: '/(main)/friend-reflect-detail' as never,
        params: {
          friendUserId: e.friendUserId,
          friendName: e.friendName,
          createdAt: e.createdAt,
          detailsJson: JSON.stringify(e.details),
        },
      } as never);
    } else {
      void haptics.light();
      appAlert('This Reflect is Private.', 'Your friend keeps the words to themselves — the items are the message.');
    }
  }

  const pendingCount = status.pending.length;
  const paired = !!pairing?.paired && !!pairing.partner;
  // 2026-07-24 pairing-first: the cave centers on the ONE paired person; the
  // feed shows only their rows once paired.
  const shownFeed = paired
    ? feed.filter((e) => e.friendUserId === pairing?.partner?.userId)
    : [];

  const addPill = (
    <Pressable
      onPress={() => { void haptics.pageOpen(); router.push('/(main)/friend-add' as never); }}
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
        {/* paired tools: history calendar + detail-sharing settings */}
        <View style={[styles.headerRow, !paired && styles.headerRowOverlay, !paired && { top: insets.top }]}>
          <View style={styles.headerIcons}>
            {paired && (
              <Pressable onPress={() => { void haptics.pageOpen(); setCalendarOpen(true); }} style={styles.iconBtn} hitSlop={8}>
                <Image source={ICONS.calendar} style={styles.calendarHeaderIcon} resizeMode="contain" />
              </Pressable>
            )}
            <Pressable onPress={onPrivacyGear} style={styles.iconBtn} hitSlop={6}>
              <Image source={FRIEND_ICONS.privacy} style={styles.gearIcon} resizeMode="contain" />
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
                <Text style={styles.panelTitle}>Latest memories</Text>
                <OffsetCard
                  color="#C9A97C"
                  offset={4}
                  radius={18}
                  onPress={() => {
                    void haptics.pageOpen();
                    setVibesOpen(true);
                  }}
                  cardStyle={styles.vibesButton}
                >
                  <MaterialIcons name="favorite" size={22} color="#FF721F" />
                  <Text style={styles.vibesButtonText}>Good Vibes</Text>
                </OffsetCard>
              </View>

              <ScrollView
                style={styles.feedList}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                  styles.feedScroll,
                  shownFeed.length === 0 && styles.emptyFeedScroll,
                ]}
              >
                {shownFeed.length === 0 ? (
                  <View style={styles.emptyFeed}>
                    <Image
                      source={ICONS.reflectJournalling}
                      style={styles.emptyFeedIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.emptyFeedText}>Your person do not reflect anything yet.</Text>
                  </View>
                ) : (
                  shownFeed.map((e, feedIndex) => (
                    <Pressable
                      key={`${e.friendUserId}:${e.reflectId}`}
                      onPress={() => onFeedRow(e)}
                      style={styles.pairCard}
                    >
                      <GridBackground
                        base={CARD_COLORS[feedIndex % CARD_COLORS.length].base}
                        line={CARD_COLORS[feedIndex % CARD_COLORS.length].line}
                        cell={22}
                        lineWidth={1.4}
                      />
                      <View style={styles.pairCardHeader}>
                        <UserAvatar userId={e.friendUserId} avatarUrl={e.friendAvatarUrl} isDefaultAvatar={e.friendIsDefaultAvatar} size={46} />
                        <Text style={styles.pairCardName} numberOfLines={1}>{e.friendName}</Text>
                        <View style={styles.pairCardTimeCol}>
                          <Text style={styles.timeText}>{timeAgo(e.createdAt)}</Text>
                          {e.unread && <View style={styles.unreadDot} />}
                        </View>
                      </View>
                      {/* Every item, wrapping — no truncation (mock 2026-08-08). */}
                      <View style={styles.pairCardTiles}>
                        {e.itemIds.map((id, i) => (
                          <ItemSprite key={`${id}:${i}`} itemId={id} size={pairTile} radius={12} tileColor="transparent" />
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
                    <UserAvatar userId={req.userId} avatarUrl={req.avatarUrl} isDefaultAvatar={req.isDefaultAvatar} size={56} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pendingName} numberOfLines={1}>{req.displayName}</Text>
                      <Text style={styles.pendingRel} numberOfLines={1}>{req.relationship ?? 'Wants to pair'}</Text>
                    </View>
                    <Pressable
                      onPress={() => void onAccept(req)}
                      disabled={acceptingId !== null}
                      style={[styles.acceptBtn, acceptingId !== null && styles.acceptBtnDisabled]}
                    >
                      <Text style={styles.acceptText}>{acceptingId === req.friendshipId ? 'Accepting…' : 'Accept'}</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.emptyWrap}>
                {addPill}
                {status.sent.length > 0 ? (
                  <View style={styles.sentList}>
                    {status.sent.map((req) => (
                      <View key={req.friendshipId} style={styles.pendingCard}>
                        <UserAvatar userId={req.userId} avatarUrl={req.avatarUrl} isDefaultAvatar={req.isDefaultAvatar} size={46} />
                        <Text style={styles.pendingName} numberOfLines={1}>{req.displayName}</Text>
                        <View style={styles.sentBadge}>
                          <Text style={styles.sentBadgeText}>Pending</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
                <Text style={styles.emptyInvite}>
                  Pair with some you care and love,{'\n'}then create memories together!
                </Text>
                <Pressable
                  onPress={() => { void haptics.pageOpen(); setHowItWorks(true); }}
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
                    <UserAvatar userId={e.friendUserId} avatarUrl={e.friendAvatarUrl} isDefaultAvatar={e.friendIsDefaultAvatar} size={46} />
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
      <DateRangeCalendar
        visible={calendarOpen}
        start={rangeStart}
        end={rangeEnd}
        onChange={(start, end) => { setRangeStart(start); setRangeEnd(end); }}
        onClose={() => setCalendarOpen(false)}
        onDone={(start, end) => void showRange(start, end)}
      />
      <GoodVibesPicker visible={vibesOpen} onClose={() => setVibesOpen(false)} />
      <PrivacySheet
        visible={privacyOpen}
        mode={privacyMode}
        saving={privacySaving}
        onMode={setPrivacyMode}
        onClose={() => setPrivacyOpen(false)}
        onSave={() => void savePrivacy()}
      />
    </View>
  );
}

const CARD_COLORS = [
  { base: '#F8DF91', line: '#E9C76B' },
  { base: '#EFC99B', line: '#DDAF7A' },
  { base: '#F0C8B6', line: '#DDAE99' },
  { base: '#DAD7A8', line: '#C2BF8B' },
] as const;

function PrivacySheet({ visible, mode, saving, onMode, onClose, onSave }: {
  visible: boolean;
  mode: MemoryDetailsMode;
  saving: boolean;
  onMode: (mode: MemoryDetailsMode) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const choices: { mode: MemoryDetailsMode; label: string }[] = [
    { mode: 'all', label: 'Show all details' },
    { mode: 'none', label: 'Hide all details' },
    { mode: 'custom', label: 'Based on each reflection setting' },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.privacyBackdrop}>
        <View style={styles.privacyFrame}>
          <View style={styles.privacyCard}>
            <Text style={styles.privacyTitle}>Memories Details</Text>
            <Text style={styles.privacySubtitle}>Select how you want to share your memories details</Text>
            <View style={styles.privacyChoices}>
              {choices.map((choice) => (
                <Pressable
                  key={choice.mode}
                  onPress={() => onMode(choice.mode)}
                  style={[styles.privacyChoice, mode === choice.mode && styles.privacyChoiceSelected]}
                >
                  <Text style={styles.privacyChoiceText}>{choice.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.privacyHint}>
              If you have specific details you want to show or hide, visit My Logs to edit them one by one.
            </Text>
            <Pressable disabled={saving} onPress={onSave} style={[styles.privacySave, saving && { opacity: 0.55 }]}>
              <Text style={styles.privacySaveText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
          <Pressable onPress={onClose} style={styles.privacyClose}>
            <MaterialIcons name="close" size={34} color="#53351D" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#6B4226' },

  headerRow: { height: 52, justifyContent: 'center' },
  headerRowOverlay: { position: 'absolute', left: 0, right: 0, zIndex: 2 },
  headerIcons: { position: 'absolute', right: 10, top: 0, flexDirection: 'row', gap: 6 },
  iconBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  gearIcon: { width: 44, height: 44 },
  calendarHeaderIcon: { width: 44, height: 44 },

  addPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 28, paddingHorizontal: 24, paddingVertical: 13,
    shadowColor: '#2B2B2B', shadowOpacity: 0.3, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  addPlus: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#2E8B57', alignItems: 'center', justifyContent: 'center' },
  addPillText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  pillUnderTitle: { marginTop: 6 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 },
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

  pendingWrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 24, gap: 16 },
  pendingTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center' },
  sentList: { alignSelf: 'stretch', paddingHorizontal: 16, gap: 12 },
  sentBadge: { backgroundColor: '#F0E7D8', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  sentBadgeText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#8A6B3F' },
  pendingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFFFF', borderRadius: 26, padding: 14,
    shadowColor: '#2B2B2B', shadowOpacity: 0.25, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  pendingName: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  pendingRel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#6B5A45', marginTop: 2 },
  acceptBtn: { flexShrink: 0, minWidth: 92, alignItems: 'center', backgroundColor: '#2E8B57', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 11 },
  acceptBtnDisabled: { opacity: 0.55 },
  acceptText: { fontSize: 14, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },

  panel: {
    flex: 1, marginHorizontal: 12, marginTop: 16, marginBottom: 8,
    backgroundColor: '#F5EBDD', borderRadius: 30, padding: 14,
  },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  listDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#3A2E1A', alignItems: 'center', justifyContent: 'center' },
  panelTitle: { flex: 1, fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  vibesButton: {
    flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#53351D',
    borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10,
  },
  vibesButtonText: { color: '#FFF8E9', fontSize: 14, fontFamily: 'Inter_800ExtraBold' },
  listChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#4A3220', borderRadius: 15, paddingHorizontal: 13, paddingVertical: 9,
    shadowColor: '#D98B4B', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  listChipIcon: { width: 26, height: 26 },
  listChipText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_800ExtraBold' },

  feedList: { flex: 1 },
  feedScroll: { gap: 10, paddingBottom: 8 },
  emptyFeedScroll: { flexGrow: 1, justifyContent: 'center' },
  emptyFeed: { alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  emptyFeedIcon: { width: 76, height: 76 },
  // Paired feed card (mock 2026-08-08): header row + full wrapping tile grid.
  pairCard: {
    backgroundColor: '#F8DF91', borderRadius: 22, paddingVertical: 12, paddingHorizontal: 12,
    overflow: 'hidden',
    gap: 10,
    shadowColor: '#C9A97C', shadowOpacity: 0.5, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  pairCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pairCardName: { flex: 1, fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  pairCardTimeCol: { alignItems: 'flex-end', gap: 5 },
  pairCardTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' },
  emptyFeedText: {
    fontSize: 14, fontFamily: 'Inter_700Bold', color: '#1F1A16',
    textAlign: 'center', lineHeight: 21,
  },
  feedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: 24, paddingVertical: 12, paddingHorizontal: 12,
    shadowColor: '#5A4A2B', shadowOpacity: 0.15, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  feedName: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', maxWidth: 84 },
  tileRow: { flexDirection: 'row', gap: 5, flex: 1, flexShrink: 1, justifyContent: 'center', overflow: 'hidden' },
  blankTile: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: '#F4F1F8',
    alignItems: 'center', justifyContent: 'center',
  },
  moreText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#8B7FD9' },
  timeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#9A8770' },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#E5483C' },
  privacyBackdrop: { flex: 1, backgroundColor: 'rgba(34,24,17,0.64)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  privacyFrame: { width: '100%', maxWidth: 500, alignItems: 'center' },
  privacyCard: { width: '100%', backgroundColor: '#53351D', borderRadius: 30, borderWidth: 10, borderColor: '#FFC99E', padding: 24 },
  privacyTitle: { color: '#FFFFFF', fontSize: 29, fontFamily: 'Inter_800ExtraBold', textAlign: 'center', marginTop: 8 },
  privacySubtitle: { color: '#FFFFFF', fontSize: 17, lineHeight: 24, fontFamily: 'Inter_700Bold', textAlign: 'center', marginTop: 24, paddingHorizontal: 12 },
  privacyChoices: { gap: 13, marginTop: 28 },
  privacyChoice: { minHeight: 62, borderRadius: 17, backgroundColor: '#FFFFFF', borderWidth: 5, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  privacyChoiceSelected: { borderColor: '#77D94D' },
  privacyChoiceText: { color: '#161311', fontSize: 18, fontFamily: 'Inter_800ExtraBold', textAlign: 'center' },
  privacyHint: { color: '#FFFFFF', fontSize: 13, lineHeight: 19, fontFamily: 'Inter_600SemiBold', fontStyle: 'italic', textAlign: 'center', marginVertical: 25, paddingHorizontal: 8 },
  privacySave: { minHeight: 62, borderRadius: 18, backgroundColor: '#FFF8E7', alignItems: 'center', justifyContent: 'center' },
  privacySaveText: { color: '#2A1A10', fontSize: 21, fontFamily: 'Inter_800ExtraBold' },
  privacyClose: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
});

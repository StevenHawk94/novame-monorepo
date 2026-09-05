import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { ScreenOverlay as Modal } from '@/components/ui/screen-overlay';
import { appAlert } from '@/components/ui/app-dialog';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { FeatureGuideModal } from '@/components/main/feature-guide-modal';
import { BACKGROUNDS, FRIEND_ICONS, ICONS } from '@/lib/icons';
import { ItemSprite } from '@/components/ui/item-sprite';
import { UserAvatar } from '@/components/ui/user-avatar';
import { GridBackground } from '@/components/ui/grid-background';
import { DateRangeCalendar } from '@/components/ui/date-range-calendar';
import { OffsetCard } from '@/components/ui/offset-card';
import { GoodVibesPicker } from '@/components/main/good-vibes';
import {
  fetchFriends, fetchFriendFeedPage, fetchMoreFriendFeed, markFriendRead,
  getCachedFriends, getCachedFriendFeedPage, getCachedPairing, fetchPairing,
  fetchGoodVibeDailyStatus, fetchSharePrivacy, localDateStr, setSharePrivacy, respondFriend,
  type FriendsStatus, type FeedEntry, type PairingStatus, type PendingRequest, type MemoryDetailsMode,
} from '@/lib/friends-api';
import { subscribeFriendshipRealtime, subscribePairingRealtime } from '@/lib/pairing-realtime';
import { HomeEntryImage } from '@/components/main/home-entry-gate';
import { getHomeEntryState, markHomeEntryAsset } from '@/lib/home-entry-readiness';
import { useHomeEntry } from '@/lib/use-home-entry';

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
  const homeEntry = useHomeEntry();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Narrow screens (iPhone SE) fit 3 item tiles per feed row; wider fit 4.
  const { width } = useWindowDimensions();
  const maxTiles = width < 400 ? 3 : 4;
  // Paired-card tile sizing (mock 2026-08-08): tiles fill the full row width
  // edge-to-edge. Inner width = window − panel margins/padding − card padding;
  // ~56pt targets pick the column count, then the size stretches to fill.
  const pairRowWidth = width - 24 - 28 - 24;
  // +1 over the ~56pt target: one extra tile per row, slightly smaller.
  const pairCols = Math.max(5, Math.floor((pairRowWidth + 8) / (56 + 8)) + 1);
  const pairTile = Math.floor((pairRowWidth - (pairCols - 1) * 8) / pairCols);
  // Cache-first: paint the last visit instantly, refresh in the background.
  const [initialFeedPage] = useState(() => getCachedFriendFeedPage());
  const [status, setStatus] = useState<FriendsStatus>(() => getCachedFriends());
  const [feed, setFeed] = useState<FeedEntry[]>(initialFeedPage.feed);
  const [feedHasMore, setFeedHasMore] = useState(initialFeedPage.hasMore);
  const [nextFeedCreatedAt, setNextFeedCreatedAt] = useState(initialFeedPage.nextBeforeCreatedAt ?? null);
  const [nextFeedId, setNextFeedId] = useState(initialFeedPage.nextBeforeId ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pairing, setPairing] = useState<PairingStatus | null>(() => getCachedPairing());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [vibesOpen, setVibesOpen] = useState(false);
  const [goodVibeStatus, setGoodVibeStatus] = useState<{
    sentToday: boolean;
    localDate: string;
  } | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [privacyMode, setPrivacyMode] = useState<MemoryDetailsMode>('custom');
  const [privacySaving, setPrivacySaving] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const reflectSheetRef = useRef<BottomSheetModal>(null);
  const [selectedReflection, setSelectedReflection] = useState<FeedEntry | null>(null);

  useEffect(() => {
    if (selectedReflection) reflectSheetRef.current?.present();
  }, [selectedReflection]);

  const renderReflectBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.45}
        pressBehavior="close"
      />
    ),
    [],
  );

  const load = useCallback(async (forceLatest = false) => {
    // Invitations expire after 48 hours. Bypass the normal short cache whenever
    // this screen regains focus so an expired request cannot keep the UI stuck
    // in Pending after the user returns to Paired.
    void fetchGoodVibeDailyStatus().then((dailyStatus) => {
      if (dailyStatus) setGoodVibeStatus(dailyStatus);
    });
    const statusRequest = fetchFriends({ force: true });
    const nextPairing = await fetchPairing({ force: forceLatest });
    const feedRequest = nextPairing.paired
      ? fetchFriendFeedPage(undefined, { force: forceLatest })
      : Promise.resolve(null);
    const [nextStatus, page] = await Promise.all([statusRequest, feedRequest]);
    setStatus(nextStatus);
    setPairing(nextPairing);
    if (!nextPairing.paired || !page) {
      setFeed([]);
      setFeedHasMore(false);
      setNextFeedCreatedAt(null);
      setNextFeedId(null);
      return;
    }
    setFeed(page.feed); setFeedHasMore(page.hasMore);
    setNextFeedCreatedAt(page.nextBeforeCreatedAt ?? null);
    setNextFeedId(page.nextBeforeId ?? null);
  }, []);

  useEffect(() => {
    if (!homeEntry.pending || homeEntry.target !== 'friends') return;
    const attempt = homeEntry.attempt;
    void load(true).finally(() => {
      requestAnimationFrame(() => markHomeEntryAsset('friends-data', attempt));
    });
  }, [homeEntry.pending, homeEntry.target, homeEntry.attempt, load]);

  useFocusEffect(useCallback(() => {
    const entry = getHomeEntryState();
    if (entry.pending && entry.target === 'friends') return;
    void load(false);
  }, [load]));

  // The accepting device refreshes synchronously in respondFriend(). The
  // requester can remain on this screen, so listen for the private server
  // invalidation and apply the already-refreshed snapshots immediately.
  useEffect(() => subscribePairingRealtime((snapshot) => {
    setStatus(snapshot.friends);
    setPairing(snapshot.pairing);
    setFeed(snapshot.pairing.paired ? snapshot.feed : []);
    const cached = getCachedFriendFeedPage();
    setFeedHasMore(snapshot.pairing.paired && cached.hasMore);
    setNextFeedCreatedAt(cached.nextBeforeCreatedAt ?? null);
    setNextFeedId(cached.nextBeforeId ?? null);
  }), []);

  // A newly-created invitation is not a pairing row yet, so it has its own
  // small invalidation event. This updates the pending badge/list immediately
  // without refreshing the feed or changing the normal five-minute cache.
  useEffect(() => subscribeFriendshipRealtime(setStatus), []);

  const nextInvitationExpiryAt = [...status.pending, ...status.sent].reduce((earliest, request) => {
    const expiresAt = request.expiresAt
      ? Date.parse(request.expiresAt)
      : request.createdAt
        ? Date.parse(request.createdAt) + 48 * 60 * 60_000
        : Number.POSITIVE_INFINITY;
    return Number.isFinite(expiresAt) ? Math.min(earliest, expiresAt) : earliest;
  }, Number.POSITIVE_INFINITY);

  // Keep an already-open Paired page correct at the exact expiry boundary.
  // The API performs the authoritative cleanup; this timer only schedules the
  // refresh instead of trying to mutate relationship state on-device.
  useEffect(() => {
    if (!Number.isFinite(nextInvitationExpiryAt)) return undefined;
    const delay = Math.max(0, nextInvitationExpiryAt - Date.now() + 250);
    const timer = setTimeout(() => {
      void fetchFriends({ force: true }).then(setStatus);
    }, delay);
    return () => clearTimeout(timer);
  }, [nextInvitationExpiryAt]);

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
    try {
      const page = await fetchFriendFeedPage(start ? { start, end: end ?? start } : undefined, { force: !!start });
      setFeed(page.feed); setFeedHasMore(page.hasMore);
      setNextFeedCreatedAt(page.nextBeforeCreatedAt ?? null);
      setNextFeedId(page.nextBeforeId ?? null);
    } catch {
      appAlert('Couldn’t load that date range', 'Check your connection and try again. Your current feed is still here.');
    }
  }

  async function loadMoreFeed() {
    if (loadingMore || !feedHasMore || !nextFeedCreatedAt) return;
    setLoadingMore(true);
    const range = rangeStart ? { start: rangeStart, end: rangeEnd ?? rangeStart } : undefined;
    const next = await fetchMoreFriendFeed({
      feed, hasMore: feedHasMore,
      nextBeforeCreatedAt: nextFeedCreatedAt, nextBeforeId: nextFeedId,
    }, range);
    setFeed(next.feed); setFeedHasMore(next.hasMore);
    setNextFeedCreatedAt(next.nextBeforeCreatedAt ?? null);
    setNextFeedId(next.nextBeforeId ?? null);
    setLoadingMore(false);
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
    } else if (res.error === 'invitation_expired') {
      appAlert('Invitation expired', 'This invitation was not accepted within 48 hours. Ask your friend to send a new one.');
      load();
    } else {
      appAlert('Could not accept', 'Please check your connection and try again.');
    }
    setAcceptingId(null);
  }

  async function openGoodVibes() {
    void haptics.pageOpen();
    let dailyStatus = goodVibeStatus;
    if (!dailyStatus || dailyStatus.localDate !== localDateStr()) {
      dailyStatus = await fetchGoodVibeDailyStatus();
      if (dailyStatus) setGoodVibeStatus(dailyStatus);
    }
    if (!dailyStatus) {
      appAlert('Could not check Good Vibes', 'Please check your connection and try again.');
      return;
    }
    if (dailyStatus?.sentToday === true) {
      appAlert('Good Vibes sent', "You've already sent a Good Vibe today. Come back tomorrow!");
      return;
    }
    setVibesOpen(true);
  }


  function onFeedRow(e: FeedEntry) {
    if (e.unread) {
      void markFriendRead(e.friendUserId);
      setFeed((cur) => cur.map((x) => (x.friendUserId === e.friendUserId ? { ...x, unread: false } : x)));
    }
    if (!e.sharesDetails) {
      void haptics.light();
      appAlert('This Reflect is Private.', 'Your friend keeps the words to themselves — the items are the message.');
      return;
    }
    const memories = (e.details ?? []).filter((detail) => detail.text.trim().length > 0);
    if (memories.length === 0) {
      void haptics.light();
      appAlert('No memories created in this reflection.');
      return;
    }
    void haptics.pageOpen();
    setSelectedReflection({ ...e, details: memories });
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
      <HomeEntryImage
        asset="friends-background"
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
            {/* Fill the usable space below the paired tools. Equal 8pt gaps
                above the icons and below them keep the panel aligned to the
                safe area while leaving the maximum room for reflections. */}
            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <View style={styles.listDot}>
                  <MaterialIcons name="menu" size={13} color="#FFFFFF" />
                </View>
                <Text style={styles.panelTitle}>Latest memories</Text>
                <OffsetCard
                  color="#C9A97C"
                  offset={4}
                  radius={18}
                  onPress={() => void openGoodVibes()}
                  cardStyle={styles.vibesButton}
                >
                  <MaterialIcons name="favorite" size={22} color="#FF721F" />
                  <Text style={styles.vibesButtonText}>Good Vibes</Text>
                </OffsetCard>
              </View>

              <ScrollView
                style={styles.feedList}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={160}
                onScroll={({ nativeEvent }) => {
                  const distance = nativeEvent.contentSize.height
                    - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y;
                  if (distance < 180) void loadMoreFeed();
                }}
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
                {loadingMore && <ActivityIndicator style={{ marginVertical: 18 }} color="#80583B" />}
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
                {status.sent.length === 0 ? (
                  <View style={styles.defaultInviteContent}>
                    {addPill}
                    <Text style={styles.emptyInvite}>
                      Pair with some you care and love,{'\n'}then create memories together!
                    </Text>
                  </View>
                ) : (
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
                    <Text style={styles.emptyInvite}>
                      Pair with some you care and love,{'\n'}then create memories together!
                    </Text>
                  </View>
                )}
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
      <DateRangeCalendar
        visible={calendarOpen}
        start={rangeStart}
        end={rangeEnd}
        onChange={(start, end) => { setRangeStart(start); setRangeEnd(end); }}
        onClose={() => setCalendarOpen(false)}
        onDone={(start, end) => void showRange(start, end)}
      />
      <GoodVibesPicker
        visible={vibesOpen}
        onClose={() => setVibesOpen(false)}
        onSent={() => setGoodVibeStatus({ sentToday: true, localDate: localDateStr() })}
      />
      <PrivacySheet
        visible={privacyOpen}
        mode={privacyMode}
        saving={privacySaving}
        onMode={setPrivacyMode}
        onClose={() => setPrivacyOpen(false)}
        onSave={() => void savePrivacy()}
      />
      <BottomSheetModal
        ref={reflectSheetRef}
        index={0}
        snapPoints={['78%']}
        enableDynamicSizing={false}
        enablePanDownToClose
        backdropComponent={renderReflectBackdrop}
        backgroundStyle={styles.reflectSheetBackground}
        handleStyle={styles.reflectSheetHandle}
        handleIndicatorStyle={styles.reflectSheetIndicator}
        onDismiss={() => setSelectedReflection(null)}
      >
        {selectedReflection && (
          <BottomSheetScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.reflectSheetContent, { paddingBottom: Math.max(insets.bottom, 12) + 18 }]}
          >
            <View style={styles.reflectSheetHeader}>
              <UserAvatar
                userId={selectedReflection.friendUserId}
                avatarUrl={selectedReflection.friendAvatarUrl}
                isDefaultAvatar={selectedReflection.friendIsDefaultAvatar}
                size={46}
              />
              <Text style={styles.reflectSheetName} numberOfLines={1}>{selectedReflection.friendName}</Text>
              <Text style={styles.reflectSheetTime}>{timeAgo(selectedReflection.createdAt)}</Text>
            </View>
            <View style={styles.reflectMemories}>
              {selectedReflection.details?.map((detail, index) => (
                <View key={`${detail.itemId}:${index}`} style={styles.reflectMemoryCard}>
                  <ItemSprite itemId={detail.itemId} size={72} radius={14} />
                  <Text style={styles.reflectMemoryText}>{detail.text}</Text>
                </View>
              ))}
            </View>
            <Pressable
              onPress={() => {
                void haptics.pageClose();
                reflectSheetRef.current?.dismiss();
              }}
              style={({ pressed }) => [styles.reflectSheetClose, pressed && { transform: [{ translateY: 2 }] }]}
            >
              <MaterialIcons name="close" size={28} color="#FFFFFF" />
            </Pressable>
          </BottomSheetScrollView>
        )}
      </BottomSheetModal>
      <FeatureGuideModal guide="paired" enabled={!homeEntry.pending} />
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
          <Pressable onPress={() => { void haptics.pageClose(); onClose(); }} style={styles.privacyClose}>
            <MaterialIcons name="close" size={34} color="#53351D" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#6B4226' },

  headerRow: { height: 56, justifyContent: 'center' },
  headerRowOverlay: { position: 'absolute', left: 0, right: 0, zIndex: 2 },
  headerIcons: { position: 'absolute', right: 10, top: 8, flexDirection: 'row', gap: 6 },
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

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  defaultInviteContent: { width: '100%', alignItems: 'center', justifyContent: 'center', gap: 22 },
  emptyInvite: {
    fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF',
    textAlign: 'center', lineHeight: 27,
  },
  pendingWrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 24, gap: 16 },
  pendingTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center' },
  sentList: { alignSelf: 'stretch', paddingHorizontal: 16, gap: 22 },
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
    flex: 1, marginHorizontal: 12, marginTop: 8, marginBottom: 8,
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
  reflectSheetBackground: { backgroundColor: '#F5EBDD' },
  reflectSheetHandle: { paddingTop: 11, paddingBottom: 8 },
  reflectSheetIndicator: { width: 46, height: 5, backgroundColor: '#C6AA8A' },
  reflectSheetContent: { paddingHorizontal: 18, paddingTop: 6 },
  reflectSheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 18 },
  reflectSheetName: { flex: 1, fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#1B1B1B' },
  reflectSheetTime: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#8B765F' },
  reflectMemories: { gap: 12 },
  reflectMemoryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1.5, borderColor: '#E5C8B8',
    padding: 16,
  },
  reflectMemoryText: { flex: 1, fontSize: 16, fontFamily: 'Inter_500Medium', color: '#1B1B1B', lineHeight: 24 },
  reflectSheetClose: {
    width: 58, height: 58, borderRadius: 29, alignSelf: 'center', marginTop: 22,
    backgroundColor: '#53351D', alignItems: 'center', justifyContent: 'center',
  },
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

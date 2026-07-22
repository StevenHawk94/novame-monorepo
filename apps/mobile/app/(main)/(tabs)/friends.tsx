import { useCallback, useState } from 'react';
import {
  Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import {
  fetchFriends, fetchFriendFeed, markFriendRead,
  fetchSharePrivacy, setSharePrivacy,
  addFriend, respondFriend,
  type FriendsStatus, type FeedEntry, type PendingRequest,
} from '@/lib/friends-api';

/**
 * Friends Cave (design: Friends-Added.png / friends.png).
 *
 * Hero: meadow art (color-block placeholder until the illustration lands),
 * "Friends Cave" title, the Add Friends pill, a mail chip with the pending-
 * request badge, and the privacy gear (the ONE switch controlling whether MY
 * memory details are visible to friends — default private).
 *
 * Panel: the Messages feed — one row per friend reflect (avatar, name, item
 * emoji peek, time-ago, unread dot), unread first. Tapping marks it read and
 * expands details when that friend opted in; otherwise the row answers
 * "This Reflect is Private." A Friends List chip flips to the roster view:
 * each friend with their shared-memories box entry.
 */
type PanelView = 'feed' | 'list';

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
  const [status, setStatus] = useState<FriendsStatus>({ inviteCode: null, friends: [], pending: [] });
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [view, setView] = useState<PanelView>('feed');
  const [showPending, setShowPending] = useState(false);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetchFriends().then(setStatus);
    void fetchFriendFeed().then(setFeed);
  }, []);
  useFocusEffect(load);

  async function shareCode() {
    if (!status.inviteCode) return;
    void haptics.light();
    await Share.share({
      message: `Add me on NovaMe! My invite code is ${status.inviteCode}.`,
    });
  }

  async function onAdd() {
    const trimmed = code.trim();
    if (trimmed.length < 4) return;
    void haptics.medium();
    const res = await addFriend(trimmed);
    if (res.ok) {
      Alert.alert('Request sent', `We've sent a friend request to ${res.requestedTo}.`);
      setCode('');
      setAdding(false);
      load();
    } else {
      const msg =
        res.error === 'code_not_found' ? "That code doesn't look right — double check with your friend."
        : res.error === 'already_friends' ? "You're already friends."
        : res.error === 'already_pending' ? 'A request is already pending with them.'
        : res.error === 'cannot_add_self' ? "That's your own code!"
        : res.error === 'friend_limit_reached' ? 'Your friend slots are full. NovaMe Plus holds 99.'
        : res.error === 'target_friend_limit_reached' ? 'Their friend slots are full right now.'
        : 'Something went wrong. Try again.';
      Alert.alert('Hmm', msg);
    }
  }

  async function onRespond(req: PendingRequest, action: 'accept' | 'decline') {
    void haptics.medium();
    const res = await respondFriend(req.friendshipId, action);
    if (res.ok) load();
    else if (res.error === 'friend_limit_reached') {
      Alert.alert('Slots full', 'Your friend slots are full. NovaMe Plus holds 99.');
    }
  }

  function onPrivacyGear() {
    void haptics.light();
    void fetchSharePrivacy().then((share) => {
      Alert.alert(
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

  function onFeedRow(e: FeedEntry) {
    void haptics.light();
    if (e.unread) {
      void markFriendRead(e.friendUserId);
      setFeed((cur) => cur.map((x) => (x.friendUserId === e.friendUserId ? { ...x, unread: false } : x)));
    }
    const key = `${e.friendUserId}:${e.reflectId}`;
    if (e.details && e.details.length > 0) {
      setExpandedKey((cur) => (cur === key ? null : key));
    } else {
      Alert.alert('This Reflect is Private.', 'Your friend keeps the words to themselves — the items are the message.');
    }
  }

  const pendingCount = status.pending.length;

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* ---- hero (meadow placeholder until art lands) ---- */}
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <Text style={styles.heroTitle}>Friends Cave</Text>
            <View style={styles.heroIcons}>
              <Pressable onPress={() => { void haptics.light(); setShowPending((v) => !v); }} style={styles.heroIconBtn} hitSlop={6}>
                <Text style={styles.heroIconEmoji}>{'💌'}</Text>
                {pendingCount > 0 && (
                  <View style={styles.badge}><Text style={styles.badgeText}>{pendingCount}</Text></View>
                )}
              </Pressable>
              <Pressable onPress={onPrivacyGear} style={styles.heroIconBtn} hitSlop={6}>
                <MaterialIcons name="settings" size={20} color="#5A4A32" />
              </Pressable>
            </View>
          </View>
          <Pressable onPress={() => { void haptics.medium(); setAdding((v) => !v); }} style={styles.addPill}>
            <View style={styles.addPlus}><MaterialIcons name="add" size={18} color="#FFFFFF" /></View>
            <Text style={styles.addPillText}>Add Friends</Text>
          </Pressable>
          <Text style={styles.heroArt}>{'🐰🌷📬🌼🐰'}</Text>
        </View>

        {/* ---- brown panel ---- */}
        <View style={styles.panel}>
          <View style={styles.card}>
            {/* add flow */}
            {adding && (
              <View style={styles.addBox}>
                <TextInput
                  value={code}
                  onChangeText={(t) => setCode(t.toUpperCase())}
                  placeholder="Enter a friend's code"
                  placeholderTextColor="#B8A588"
                  autoCapitalize="characters"
                  maxLength={6}
                  style={styles.input}
                />
                <View style={styles.addRow}>
                  <Pressable onPress={shareCode} style={styles.shareBtn}>
                    <MaterialIcons name="ios-share" size={15} color="#7A5A36" />
                    <Text style={styles.shareBtnText}>My code: {status.inviteCode ?? '——'}</Text>
                  </Pressable>
                  <Pressable onPress={onAdd} style={styles.sendBtn}>
                    <Text style={styles.sendBtnText}>Send</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* pending requests */}
            {showPending && (
              <View style={styles.pendingBox}>
                {pendingCount === 0 ? (
                  <Text style={styles.pendingEmpty}>No requests waiting.</Text>
                ) : (
                  status.pending.map((req) => (
                    <View key={req.friendshipId} style={styles.reqRow}>
                      <Text style={styles.reqName}>{req.displayName}</Text>
                      <View style={styles.reqBtns}>
                        <Pressable onPress={() => onRespond(req, 'decline')} style={styles.reqDecline} hitSlop={6}>
                          <MaterialIcons name="close" size={18} color="#9A8770" />
                        </Pressable>
                        <Pressable onPress={() => onRespond(req, 'accept')} style={styles.reqAccept} hitSlop={6}>
                          <MaterialIcons name="check" size={18} color="#FFFFFF" />
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* header row */}
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>
                {view === 'feed' ? 'Latest memories of your friends' : 'Your friends'}
              </Text>
              <Pressable
                onPress={() => { void haptics.light(); setView((v) => (v === 'feed' ? 'list' : 'feed')); }}
                style={styles.listChip}
              >
                <Text style={styles.listChipEmoji}>{'🐶'}</Text>
                <Text style={styles.listChipText}>{view === 'feed' ? 'Friends List' : 'Messages'}</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listScroll}>
              {view === 'feed' ? (
                feed.length === 0 ? (
                  <Text style={styles.emptyText}>
                    {status.friends.length === 0
                      ? 'Invite your friends to share memory items together!'
                      : 'Nothing new from your friends yet — check back later.'}
                  </Text>
                ) : (
                  feed.map((e) => {
                    const key = `${e.friendUserId}:${e.reflectId}`;
                    const expanded = expandedKey === key;
                    return (
                      <Pressable key={key} onPress={() => onFeedRow(e)} style={styles.feedRow}>
                        <View style={styles.feedMain}>
                          <View style={styles.avatar}><Text style={styles.avatarEmoji}>{'🐰'}</Text></View>
                          <Text style={styles.feedName} numberOfLines={1}>{e.friendName}</Text>
                          <View style={styles.emojiRow}>
                            {e.emoji.slice(0, 4).map((em, i) => (
                              <View key={i} style={styles.emojiChip}><Text style={styles.emojiText}>{em}</Text></View>
                            ))}
                            {e.emoji.length > 4 && (
                              <View style={styles.emojiChip}><Text style={styles.moreText}>+{e.emoji.length - 4}</Text></View>
                            )}
                          </View>
                          <Text style={styles.timeText}>{timeAgo(e.createdAt)}</Text>
                          {e.unread && <View style={styles.unreadDot} />}
                        </View>
                        {expanded && e.details && (
                          <View style={styles.detailBox}>
                            {e.details.map((d, i) => (
                              <Text key={i} style={styles.detailText}>
                                {e.emoji[e.itemIds.indexOf(d.itemId)] ?? '✨'}  {d.text}
                              </Text>
                            ))}
                          </View>
                        )}
                      </Pressable>
                    );
                  })
                )
              ) : status.friends.length === 0 ? (
                <Text style={styles.emptyText}>No friends yet — share your code to get started!</Text>
              ) : (
                status.friends.map((f) => (
                  <View key={f.userId} style={styles.friendRow}>
                    <View style={styles.avatar}><Text style={styles.avatarEmoji}>{'🐰'}</Text></View>
                    <Text style={styles.feedName} numberOfLines={1}>{f.displayName}</Text>
                    <View style={{ flex: 1 }} />
                    <Pressable
                      onPress={() => {
                        void haptics.light();
                        router.push({
                          // typedRoutes learns new files on next dev run
                          pathname: '/(main)/friend-memories' as never,
                          params: { friendUserId: f.userId, friendName: f.displayName },
                        } as never);
                      }}
                      style={styles.memBtn}
                    >
                      <Text style={styles.memBtnText}>Memories</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#6B4226' },

  // Hero — sky-to-grass placeholder until the meadow illustration lands.
  hero: { height: 210, backgroundColor: '#BDE3E0', paddingHorizontal: 16, paddingTop: 6 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroTitle: { fontSize: 28, fontFamily: 'Inter_800ExtraBold', color: '#4A3220', flex: 1, textAlign: 'center', marginLeft: 84 },
  heroIcons: { flexDirection: 'row', gap: 8 },
  heroIconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  heroIconEmoji: { fontSize: 20 },
  badge: {
    position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#E5483C', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontFamily: 'Inter_800ExtraBold' },
  addPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 26, paddingHorizontal: 22, paddingVertical: 12,
    marginTop: 14,
    shadowColor: '#2B2B2B', shadowOpacity: 0.25, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  addPlus: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#2E8B57', alignItems: 'center', justifyContent: 'center' },
  addPillText: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  heroArt: { fontSize: 34, textAlign: 'center', marginTop: 18, letterSpacing: 6 },

  panel: { flex: 1, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 },
  card: { flex: 1, backgroundColor: '#F5EBDD', borderRadius: 24, padding: 14 },

  addBox: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, marginBottom: 12 },
  input: {
    borderWidth: 1.5, borderColor: '#E8D5B0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 3, textAlign: 'center', color: '#4A3423',
  },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 10 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  shareBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#7A5A36' },
  sendBtn: { backgroundColor: '#8A6240', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
  sendBtnText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_800ExtraBold' },

  pendingBox: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, marginBottom: 12, gap: 8 },
  pendingEmpty: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#9A8770', textAlign: 'center' },
  reqRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reqName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#2B2B2B' },
  reqBtns: { flexDirection: 'row', gap: 10 },
  reqDecline: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F0EAE0', alignItems: 'center', justifyContent: 'center' },
  reqAccept: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#2E8B57', alignItems: 'center', justifyContent: 'center' },

  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  panelTitle: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', flexShrink: 1 },
  listChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#4A3220', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8,
  },
  listChipEmoji: { fontSize: 15 },
  listChipText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_800ExtraBold' },

  listScroll: { paddingBottom: 12, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#8A7A63', textAlign: 'center', lineHeight: 21, paddingVertical: 30, paddingHorizontal: 16 },

  feedRow: {
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 12, paddingHorizontal: 12,
    shadowColor: '#5A4A2B', shadowOpacity: 0.12, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  feedMain: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F4F1F8', alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 22 },
  feedName: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', maxWidth: 86 },
  emojiRow: { flexDirection: 'row', gap: 4, flex: 1, justifyContent: 'center' },
  emojiChip: { width: 34, height: 34, borderRadius: 9, backgroundColor: '#F4F1F8', alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 19 },
  moreText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#8B7FD9' },
  timeText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#9A8770' },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#E5483C' },

  detailBox: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#F0EAE0', paddingTop: 10, gap: 6 },
  detailText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#4A3B2A', lineHeight: 20 },

  friendRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 12, paddingHorizontal: 12,
  },
  memBtn: { backgroundColor: '#F0885C', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  memBtnText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_800ExtraBold' },
});

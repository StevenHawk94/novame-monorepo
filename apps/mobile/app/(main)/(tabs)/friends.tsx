import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { useTheme } from '@/theme/use-theme';
import { haptics } from '@/lib/haptics';
import {
  fetchFriends, addFriend, respondFriend,
  type FriendsStatus, type FriendCard, type PendingRequest,
} from '@/lib/friends-api';

/**
 * Friends (C11a). The "keep your distance" social tab: each friend's card shows
 * the emoji of what they collected today -- a glimpse of their day without the
 * words behind it. Add friends by a stable invite code; incoming requests wait
 * at the top to accept or decline. Reflections stay private; only item emoji
 * cross between friends.
 */
export default function FriendsScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const [status, setStatus] = useState<FriendsStatus>({ inviteCode: null, friends: [], pending: [] });
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');

  const load = useCallback(() => {
    void fetchFriends().then(setStatus);
  }, []);
  useFocusEffect(load);

  async function copyCode() {
    if (!status.inviteCode) return;
    void haptics.light();
    await Clipboard.setStringAsync(status.inviteCode);
    Alert.alert('Copied', 'Your invite code is on the clipboard.');
  }

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
        : 'Something went wrong. Try again.';
      Alert.alert('Hmm', msg);
    }
  }

  async function onRespond(req: PendingRequest, action: 'accept' | 'decline') {
    void haptics.medium();
    const res = await respondFriend(req.friendshipId, action);
    if (res.ok) load();
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bgPrimary }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.textPrimary }]}>Friends</Text>
          <Pressable onPress={() => {}} hitSlop={8} style={[styles.iconBtn, { backgroundColor: c.bgCard }]}>
            <MaterialIcons name="favorite-border" size={20} color={c.brand.primary} />
          </Pressable>
        </View>

        {/* Invite code card */}
        <View style={[styles.inviteCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <Text style={[styles.inviteLabel, { color: c.textSecondary }]}>Your invite code</Text>
          <Pressable onPress={copyCode} hitSlop={8}>
            <Text style={[styles.inviteCode, { color: c.textPrimary }]}>{status.inviteCode ?? '——————'}</Text>
          </Pressable>
          <View style={styles.inviteActions}>
            <Pressable onPress={copyCode} style={[styles.inviteAction, { borderColor: c.border }]}>
              <MaterialIcons name="content-copy" size={16} color={c.textSecondary} />
              <Text style={[styles.inviteActionText, { color: c.textSecondary }]}>Copy</Text>
            </Pressable>
            <Pressable onPress={shareCode} style={[styles.inviteAction, { borderColor: c.border }]}>
              <MaterialIcons name="ios-share" size={16} color={c.textSecondary} />
              <Text style={[styles.inviteActionText, { color: c.textSecondary }]}>Share</Text>
            </Pressable>
          </View>
        </View>

        {/* Add friend */}
        {adding ? (
          <View style={[styles.addBox, { backgroundColor: c.bgCard, borderColor: c.border }]}>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="Enter a friend's code"
              placeholderTextColor={c.textMuted}
              autoCapitalize="characters"
              maxLength={6}
              style={[styles.input, { color: c.textPrimary, borderColor: c.border }]}
            />
            <View style={styles.addRow}>
              <Pressable onPress={() => { setAdding(false); setCode(''); }} style={styles.addCancel}>
                <Text style={[styles.addCancelText, { color: c.textMuted }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={onAdd} style={[styles.addConfirm, { backgroundColor: c.brand.primary }]}>
                <Text style={styles.addConfirmText}>Send request</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setAdding(true)} style={[styles.addBtn, { backgroundColor: c.brand.primary }]}>
            <MaterialIcons name="add" size={20} color="#FFFFFF" />
            <Text style={styles.addBtnText}>Add Friend</Text>
          </Pressable>
        )}

        {/* Pending requests */}
        {status.pending.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: c.textMuted }]}>Requests</Text>
            {status.pending.map((req) => (
              <View key={req.friendshipId} style={[styles.reqCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
                <Text style={[styles.reqName, { color: c.textPrimary }]}>{req.displayName}</Text>
                <View style={styles.reqBtns}>
                  <Pressable onPress={() => onRespond(req, 'decline')} style={styles.reqDecline}>
                    <MaterialIcons name="close" size={20} color={c.textMuted} />
                  </Pressable>
                  <Pressable onPress={() => onRespond(req, 'accept')} style={[styles.reqAccept, { backgroundColor: c.brand.primary }]}>
                    <MaterialIcons name="check" size={20} color="#FFFFFF" />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Emoji Messages (friends' day at a glance) */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: c.textMuted }]}>Emoji Messages</Text>
          {status.friends.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>
                Add a friend to see a glimpse of their day — the little things they gathered, no words attached.
              </Text>
            </View>
          ) : (
            status.friends.map((f) => (
              <Pressable
                key={f.userId}
                onPress={() => router.push({ pathname: '/(main)/friend-detail', params: { userId: f.userId, name: f.displayName } })}
                style={[styles.friendRow, { backgroundColor: c.bgCard, borderColor: c.border }]}
              >
                <View style={[styles.avatar, { backgroundColor: c.bgCardAlt }]}>
                  <MaterialIcons name="pets" size={20} color={c.brand.primary} />
                </View>
                <Text style={[styles.friendName, { color: c.textPrimary }]}>{f.displayName}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.emojiScroll}>
                  {f.todayEmoji.length === 0 ? (
                    <Text style={[styles.noUpdate, { color: c.textMuted }]}>No update yet today</Text>
                  ) : (
                    f.todayEmoji.map((e, i) => <Text key={i} style={styles.emoji}>{e}</Text>)
                  )}
                </ScrollView>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  scroll: { paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 12, paddingHorizontal: 4 },
  title: { fontSize: 26, fontFamily: 'Inter_800ExtraBold' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  inviteCard: { borderRadius: 16, borderWidth: 1, padding: 16, alignItems: 'center', marginBottom: 12 },
  inviteLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  inviteCode: { fontSize: 30, fontFamily: 'Inter_800ExtraBold', letterSpacing: 6, marginVertical: 6 },
  inviteActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  inviteAction: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8 },
  inviteActionText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 15, marginBottom: 16 },
  addBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  addBox: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16, gap: 12 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: 4, textAlign: 'center' },
  addRow: { flexDirection: 'row', gap: 12 },
  addCancel: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  addCancelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  addConfirm: { flex: 2, alignItems: 'center', borderRadius: 12, paddingVertical: 12 },
  addConfirmText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  section: { marginTop: 8, marginBottom: 4 },
  sectionLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 10, marginLeft: 4 },

  reqCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  reqName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  reqBtns: { flexDirection: 'row', gap: 10 },
  reqDecline: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  reqAccept: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  friendRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10, height: 64 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  friendName: { fontSize: 15, fontFamily: 'Inter_700Bold', width: 80 },
  emojiScroll: { flex: 1 },
  emoji: { fontSize: 24, marginRight: 6 },
  noUpdate: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  empty: { paddingHorizontal: 20, paddingVertical: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 21 },
});

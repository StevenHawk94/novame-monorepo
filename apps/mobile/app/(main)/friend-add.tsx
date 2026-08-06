import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import {
  fetchFriends, getCachedFriends, addFriend, previewFriend,
  type FriendsStatus,
} from '@/lib/friends-api';

// 2026-07-29 pairing flow (mock 3): the invitation proposes a relationship
// and its start date.
const RELATIONSHIPS = ['Partner', 'Best Friend', 'Families', 'Someone Special', 'Others'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Add Friends (mock 2026-08-05, 1:1): brown full screen, vertically centered
 * column — two-bunny art, the one-close-friend copy, Friend ID search, Invite
 * Link, the My Pair ID card, Copy ID — and a white round close at the bottom.
 * Searching opens the Search Result overlay (relationship + since date →
 * Send Invitation). Incoming/outgoing requests live on the Friends tab.
 */
export default function FriendAddScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Cache-first: the Pair ID never changes, so paint it instantly from the
  // cached status; the focus-effect fetch reconciles in the background.
  const [status, setStatus] = useState<FriendsStatus>(() => getCachedFriends());
  const [query, setQuery] = useState('');
  // Search-result card (mock 2): the resolved user + the proposed relationship.
  const [found, setFound] = useState<{ code: string; name: string } | null>(null);
  const [relationship, setRelationship] = useState<string | null>(null);
  const now = new Date();
  const [since, setSince] = useState<{ y: number; m: number; d: number }>({
    y: now.getFullYear(), m: now.getMonth(), d: now.getDate(),
  });
  const [dateOpen, setDateOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    void fetchFriends().then(setStatus);
  }, []);
  useFocusEffect(load);

  async function onSearch() {
    const code = query.trim().toUpperCase();
    if (code.length < 4) return;
    void haptics.medium();
    const res = await previewFriend(code);
    if (res.ok && res.targetName) {
      setFound({ code, name: res.targetName });
      setRelationship(null);
    } else {
      const msg =
        res.error === 'code_not_found' ? "That ID doesn't look right — double check with your friend."
        : res.error === 'already_friends' ? "You're already friends."
        : res.error === 'already_pending' ? 'A request is already pending with them.'
        : res.error === 'cannot_add_self' ? "That's your own ID!"
        : res.error === 'friend_limit_reached' ? 'Your friend slots are full. NovaMe Plus holds 99.'
        : res.error === 'target_friend_limit_reached' ? 'Their friend slots are full right now.'
        : 'Something went wrong. Try again.';
      appAlert('Hmm', msg);
    }
  }

  async function onSendInvitation() {
    if (!found || !relationship || sending) return;
    void haptics.medium();
    setSending(true);
    const iso = `${since.y}-${String(since.m + 1).padStart(2, '0')}-${String(since.d).padStart(2, '0')}`;
    const res = await addFriend(found.code, { relationship, relationshipSince: iso });
    setSending(false);
    if (res.ok) {
      appAlert('Invitation sent', `We've sent your invitation to ${res.requestedTo ?? found.name}.`);
      setFound(null);
      setQuery('');
      load();
    } else {
      const msg =
        res.error === 'already_friends' ? "You're already friends."
        : res.error === 'already_pending' ? 'A request is already pending with them.'
        : 'Something went wrong. Try again.';
      appAlert('Hmm', msg);
    }
  }

  async function onCopyId() {
    if (!status.inviteCode || copied) return;
    void haptics.light();
    await Clipboard.setStringAsync(status.inviteCode);
    void haptics.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function onInviteLink() {
    if (!status.inviteCode) return;
    void haptics.light();
    await Share.share({
      message: `Add me on NovaMe! My Friend ID is ${status.inviteCode} — let's share memory items together.`,
    });
  }

  const closeBottom = insets.bottom + 18;

  return (
    <View style={styles.root}>
      {/* Vertically centered column (mock 1). */}
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Image source={ICONS.friendList} style={styles.bunnies} resizeMode="contain" />
        <Text style={styles.intro}>
          You can add 1 closest friend right now, please add someone important
          that you want to stay closer, even not living together.
        </Text>

        {/* Friend ID search */}
        <View style={styles.searchBox}>
          <TextInput
            style={styles.searchInput}
            placeholder="Enter Friend ID here"
            placeholderTextColor="#A99A85"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="characters"
            onSubmitEditing={() => void onSearch()}
          />
          <Pressable onPress={() => void onSearch()} hitSlop={8}>
            <MaterialIcons name="search" size={28} color="#7A4A2A" />
          </Pressable>
        </View>

        {/* Invite Link */}
        <Pressable
          onPress={() => void onInviteLink()}
          style={({ pressed }) => [styles.creamBtn, pressed && { opacity: 0.85 }]}
        >
          <MaterialIcons name="link" size={24} color="#2E8B57" />
          <Text style={styles.creamBtnText}>Invite Link</Text>
        </Pressable>

        {/* My Pair ID */}
        <View style={styles.idCard}>
          <Text style={styles.idLabel}>My Pair ID</Text>
          <Text style={styles.idValue}>{status.inviteCode ?? '——————'}</Text>
        </View>

        {/* Copy ID */}
        <Pressable
          onPress={() => void onCopyId()}
          style={({ pressed }) => [styles.creamBtn, pressed && { opacity: 0.85 }]}
        >
          <MaterialIcons name={copied ? 'check' : 'content-copy'} size={22} color="#2E8B57" />
          <Text style={styles.creamBtnText}>{copied ? 'Copied!' : 'Copy ID'}</Text>
        </Pressable>
      </ScrollView>

      {/* Round white close (mock: bottom center) */}
      <Pressable
        onPress={() => router.back()}
        style={[styles.closeBtn, { bottom: closeBottom }]}
        hitSlop={8}
      >
        <MaterialIcons name="close" size={28} color="#6B4226" />
      </Pressable>

      {/* Search Result → relationship + since (mock 2) */}
      {found && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Search Result</Text>
            <View style={styles.foundRow}>
              <View style={styles.foundAvatar}><Text style={styles.foundAvatarEmoji}>{'🐰'}</Text></View>
              <Text style={styles.foundName}>{found.name}</Text>
            </View>

            <Text style={styles.modalQ}>What is your relationship with them?</Text>
            <View style={styles.relGrid}>
              {RELATIONSHIPS.map((r) => {
                const on = relationship === r;
                return (
                  <Pressable
                    key={r}
                    onPress={() => { void haptics.light(); setRelationship(r); }}
                    style={[styles.relPill, on && styles.relPillOn]}
                  >
                    <Text style={[styles.relPillText, on && styles.relPillTextOn]} numberOfLines={1}>{r}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.modalQ}>When is the first time you be in the relationship?</Text>
            <Pressable onPress={() => { void haptics.light(); setDateOpen((v) => !v); }} style={styles.dateField}>
              <Text style={styles.dateFieldText}>
                {MONTHS[since.m]} {since.d} {since.y}
              </Text>
              <MaterialIcons name={dateOpen ? 'arrow-drop-up' : 'arrow-drop-down'} size={24} color="#4A3220" />
            </Pressable>
            {dateOpen && (
              <View style={styles.dateWheels}>
                <ScrollView style={styles.wheel} showsVerticalScrollIndicator={false}>
                  {MONTHS.map((mn, i) => (
                    <Pressable key={mn} onPress={() => setSince((c) => ({ ...c, m: i }))} style={[styles.wheelRow, since.m === i && styles.wheelRowOn]}>
                      <Text style={[styles.wheelText, since.m === i && styles.wheelTextOn]}>{mn.slice(0, 3)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <ScrollView style={styles.wheel} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <Pressable key={d} onPress={() => setSince((c) => ({ ...c, d }))} style={[styles.wheelRow, since.d === d && styles.wheelRowOn]}>
                      <Text style={[styles.wheelText, since.d === d && styles.wheelTextOn]}>{d}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <ScrollView style={styles.wheel} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 80 }, (_, i) => now.getFullYear() - i).map((y) => (
                    <Pressable key={y} onPress={() => setSince((c) => ({ ...c, y }))} style={[styles.wheelRow, since.y === y && styles.wheelRowOn]}>
                      <Text style={[styles.wheelText, since.y === y && styles.wheelTextOn]}>{y}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            <Pressable
              onPress={() => void onSendInvitation()}
              disabled={!relationship || sending}
              style={[styles.sendBtn, (!relationship || sending) && { opacity: 0.5 }]}
            >
              <Text style={styles.sendBtnText}>{sending ? 'Sending…' : 'Send Invitation'}</Text>
            </Pressable>
          </View>

          {/* Same round white close, dismissing the result overlay */}
          <Pressable
            onPress={() => setFound(null)}
            style={[styles.closeBtn, { bottom: closeBottom }]}
            hitSlop={8}
          >
            <MaterialIcons name="close" size={28} color="#6B4226" />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#7E5233' },

  scroll: {
    flexGrow: 1, justifyContent: 'center',
    paddingHorizontal: 22, paddingBottom: 110, gap: 15,
  },

  bunnies: { width: 118, height: 88, alignSelf: 'center' },
  intro: {
    fontSize: 17, lineHeight: 25, fontFamily: 'Inter_700Bold', color: '#FFFFFF',
    textAlign: 'center', marginBottom: 8, paddingHorizontal: 4,
  },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: 26, paddingHorizontal: 20, paddingVertical: 6,
  },
  searchInput: { flex: 1, fontSize: 17, fontFamily: 'Inter_500Medium', color: '#4A3220', paddingVertical: 16 },

  creamBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#FBF0CF', borderRadius: 26, paddingVertical: 18,
  },
  creamBtnText: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#4A3220' },

  idCard: { backgroundColor: '#FFFFFF', borderRadius: 26, paddingVertical: 22, alignItems: 'center', gap: 6 },
  idLabel: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  idValue: { fontSize: 34, fontFamily: 'Inter_800ExtraBold', color: '#1B1B1B', letterSpacing: 3 },

  closeBtn: {
    position: 'absolute', alignSelf: 'center',
    width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },

  modalOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: '#7E5233',
    alignItems: 'center', justifyContent: 'center', padding: 18,
  },
  modalCard: { backgroundColor: '#F8E3BF', borderRadius: 30, padding: 20, width: '100%' },
  modalTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', textAlign: 'center', marginBottom: 14 },
  foundRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginBottom: 16,
  },
  foundAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#E9F2E4', alignItems: 'center', justifyContent: 'center' },
  foundAvatarEmoji: { fontSize: 26 },
  foundName: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  modalQ: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#2A2118', marginBottom: 10 },
  relGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  relPill: {
    width: '47%', backgroundColor: '#FFFFFF', borderRadius: 22,
    paddingVertical: 13, alignItems: 'center',
  },
  relPillOn: { backgroundColor: '#4A3220' },
  relPillText: { fontSize: 14.5, fontFamily: 'Inter_700Bold', color: '#161311' },
  relPillTextOn: { color: '#FFFFFF' },
  dateField: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFFFFF', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12,
    alignSelf: 'stretch', maxWidth: 300,
  },
  dateFieldText: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#2A2118' },
  dateWheels: { flexDirection: 'row', gap: 8, height: 150, marginBottom: 12 },
  wheel: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12 },
  wheelRow: { paddingVertical: 9, alignItems: 'center' },
  wheelRowOn: { backgroundColor: '#F0E3D0' },
  wheelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#6B5A45' },
  wheelTextOn: { color: '#161311', fontFamily: 'Inter_800ExtraBold' },
  sendBtn: {
    backgroundColor: '#4A3220', borderRadius: 24, alignItems: 'center',
    paddingVertical: 17, marginTop: 6, marginHorizontal: 20,
  },
  sendBtnText: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
});

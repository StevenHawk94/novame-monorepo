import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { Image as ExpoImage } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { BACKGROUNDS, FRIEND_ICONS } from '@/lib/icons';
import {
  fetchFriends, getCachedFriends, addFriend, previewFriend, respondFriend,
  type FriendsStatus, type PendingRequest,
} from '@/lib/friends-api';

// 2026-07-29 pairing flow (mock 3): the invitation proposes a relationship
// and its start date.
const RELATIONSHIPS = ['Partner', 'Best Friend', 'Families', 'Someone Special', 'Others'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Add Friends (mock 1:1): search by Friend ID, Scan Code / Invite Link, the
 * My Friend ID card, then incoming requests (Ignore / Accept) and outgoing
 * ones (Sent Nh ago / Pending). Search-by-name arrives with the stranger-
 * search backend — the field accepts a Friend ID today.
 */
function sentAgo(iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'Sent just now';
  if (h < 24) return `Sent ${h}h ago`;
  return `Sent ${Math.floor(h / 24)}d ago`;
}

export default function FriendAddScreen() {
  const router = useRouter();
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

  async function onRespond(req: PendingRequest, action: 'accept' | 'decline') {
    void haptics.medium();
    const res = await respondFriend(req.friendshipId, action);
    if (res.ok) load();
    else if (res.error === 'friend_limit_reached') {
      appAlert('Slots full', 'Your friend slots are full. NovaMe Plus holds 99.');
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

  return (
    <View style={styles.root}>
      <ExpoImage
        source={BACKGROUNDS.friends}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        contentPosition="top"
      />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
            <MaterialIcons name="arrow-back" size={22} color="#4A3220" />
          </Pressable>
          <Text style={styles.title}>Add Friends</Text>
          <View style={styles.headerIcons}>
            <Image source={FRIEND_ICONS.setting} style={styles.gearIcon} resizeMode="contain" />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* search */}
          <View style={styles.searchBox}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name or Friend ID"
              placeholderTextColor="#A99A85"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="characters"
              onSubmitEditing={() => void onSearch()}
            />
            <Pressable onPress={() => void onSearch()} hitSlop={8}>
              <MaterialIcons name="search" size={26} color="#4A3220" />
            </Pressable>
          </View>

          {/* scan + invite */}
          <View style={styles.toolRow}>
            <Pressable
              onPress={() => appAlert('Scan Code', 'QR scanning is coming soon — share your Friend ID for now!')}
              style={styles.toolBtn}
            >
              <MaterialIcons name="qr-code-scanner" size={22} color="#2E8B57" />
              <Text style={styles.toolText}>Scan Code</Text>
            </Pressable>
            <Pressable onPress={() => void onInviteLink()} style={styles.toolBtn}>
              <MaterialIcons name="link" size={22} color="#2E8B57" />
              <Text style={styles.toolText}>Invite Link</Text>
            </Pressable>
          </View>

          {/* my id */}
          <View style={styles.idCard}>
            <Text style={styles.idLabel}>My Pair ID</Text>
            <Text style={styles.idValue}>{status.inviteCode ?? '——————'}</Text>
          </View>

          {/* copy id (mock 2) */}
          <Pressable
            onPress={() => void onCopyId()}
            style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.85 }]}
          >
            <MaterialIcons name={copied ? 'check' : 'content-copy'} size={20} color="#6B4A25" />
            <Text style={styles.copyText}>{copied ? 'Copied!' : 'Copy ID'}</Text>
          </Pressable>

          {/* incoming requests */}
          {status.pending.map((req) => (
            <View key={req.friendshipId} style={styles.reqCard}>
              <View style={styles.reqAvatar}><Text style={styles.reqAvatarEmoji}>{'🐰'}</Text></View>
              <View style={styles.reqBody}>
                <Text style={styles.reqName}>{req.displayName}</Text>
                <Text style={styles.reqSub}>{req.relationship ?? 'Wants to share memories'}</Text>
              </View>
              <Pressable onPress={() => void onRespond(req, 'decline')} style={styles.ignoreBtn}>
                <Text style={styles.ignoreText}>Ignore</Text>
              </Pressable>
              <Pressable onPress={() => void onRespond(req, 'accept')} style={styles.acceptBtn}>
                <Text style={styles.acceptText}>Accept</Text>
              </Pressable>
            </View>
          ))}

          {/* outgoing requests */}
          {status.sent.map((req) => (
            <View key={req.friendshipId} style={styles.reqCard}>
              <View style={styles.reqAvatar}><Text style={styles.reqAvatarEmoji}>{'🐰'}</Text></View>
              <View style={styles.reqBody}>
                <Text style={styles.reqName}>{req.displayName}</Text>
                <Text style={styles.reqSub}>{sentAgo(req.createdAt)}</Text>
              </View>
              <View style={styles.pendingChip}>
                <Text style={styles.pendingText}>Pending</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        {/* Search Result → relationship + since (mock 2) */}
        {found && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Search Result</Text>
              <View style={styles.foundRow}>
                <View style={styles.reqAvatar}><Text style={styles.reqAvatarEmoji}>{'🐰'}</Text></View>
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
              <Pressable onPress={() => setFound(null)} style={styles.modalClose} hitSlop={8}>
                <MaterialIcons name="close" size={22} color="#6B5A45" />
              </Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#6B4226' },
  headerRow: { height: 52, justifyContent: 'center' },
  backBtn: {
    position: 'absolute', left: 14, top: 4,
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  title: { fontSize: 28, fontFamily: 'Inter_800ExtraBold', color: '#4A3220', textAlign: 'center' },
  headerIcons: { position: 'absolute', right: 14, top: 4, flexDirection: 'row' },
  gearIcon: { width: 34, height: 34 },

  scroll: { paddingHorizontal: 18, paddingTop: '30%', paddingBottom: 32, gap: 14 },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFDF6', borderRadius: 26, paddingHorizontal: 18, paddingVertical: 4,
  },
  searchInput: { flex: 1, fontSize: 17, fontFamily: 'Inter_500Medium', color: '#4A3220', paddingVertical: 14 },

  toolRow: { flexDirection: 'row', gap: 14 },
  toolBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#F5EBD3', borderRadius: 20, paddingVertical: 15,
  },
  toolText: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#2E5B3E' },

  idCard: { backgroundColor: '#FFFFFF', borderRadius: 24, paddingVertical: 20, alignItems: 'center', gap: 6 },
  idLabel: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  idValue: { fontSize: 30, fontFamily: 'Inter_800ExtraBold', color: '#1B1B1B', letterSpacing: 3 },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#F5EBD3', borderRadius: 24, paddingVertical: 17,
  },
  copyText: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#6B4A25' },

  reqCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFDF6', borderRadius: 22, padding: 14,
  },
  reqAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#E9F2E4', alignItems: 'center', justifyContent: 'center' },
  reqAvatarEmoji: { fontSize: 28 },
  reqBody: { flex: 1 },
  reqName: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  reqSub: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#8A7A63', marginTop: 2 },
  ignoreBtn: { backgroundColor: '#F5EBD3', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  ignoreText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#6B5A45' },
  acceptBtn: { backgroundColor: '#2E8B57', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  acceptText: { fontSize: 14, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  pendingChip: { backgroundColor: '#F5C46B', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
  pendingText: { fontSize: 14, fontFamily: 'Inter_800ExtraBold', color: '#7A4A16' },

  modalOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  modalCard: { backgroundColor: '#F8E3BF', borderRadius: 28, padding: 18, width: '100%' },
  modalTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', textAlign: 'center', marginBottom: 14 },
  foundRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginBottom: 16,
  },
  foundName: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  modalQ: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#2A2118', marginBottom: 10 },
  relGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  relPill: {
    width: '47%', backgroundColor: '#FFFFFF', borderRadius: 22,
    paddingVertical: 13, alignItems: 'center',
  },
  relPillOn: { backgroundColor: '#8A5F3F' },
  relPillText: { fontSize: 14.5, fontFamily: 'Inter_700Bold', color: '#161311' },
  relPillTextOn: { color: '#FFFFFF' },
  dateField: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 2, borderColor: '#8B7FD9',
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
  },
  dateFieldText: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#2A2118' },
  dateWheels: { flexDirection: 'row', gap: 8, height: 150, marginBottom: 12 },
  wheel: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12 },
  wheelRow: { paddingVertical: 9, alignItems: 'center' },
  wheelRowOn: { backgroundColor: '#F0E3D0' },
  wheelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#6B5A45' },
  wheelTextOn: { color: '#161311', fontFamily: 'Inter_800ExtraBold' },
  sendBtn: { backgroundColor: '#4A3220', borderRadius: 22, alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  sendBtnText: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  modalClose: { alignSelf: 'center', marginTop: 10, padding: 6 },
});

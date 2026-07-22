import { useCallback, useState } from 'react';
import {
  Alert, Image, ImageBackground, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { BACKGROUNDS, FRIEND_ICONS } from '@/lib/icons';
import {
  fetchFriends, addFriend, respondFriend,
  type FriendsStatus, type PendingRequest,
} from '@/lib/friends-api';

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
  const [status, setStatus] = useState<FriendsStatus>({ inviteCode: null, friends: [], pending: [], sent: [] });
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    void fetchFriends().then(setStatus);
  }, []);
  useFocusEffect(load);

  async function onSearch() {
    const code = query.trim().toUpperCase();
    if (code.length < 4) return;
    void haptics.medium();
    const res = await addFriend(code);
    if (res.ok) {
      Alert.alert('Request sent', `We've sent a friend request to ${res.requestedTo}.`);
      setQuery('');
      load();
    } else {
      const msg =
        res.error === 'code_not_found' ? "That ID doesn't look right — double check with your friend."
        : res.error === 'already_friends' ? "You're already friends."
        : res.error === 'already_pending' ? 'A request is already pending with them.'
        : res.error === 'cannot_add_self' ? "That's your own ID!"
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

  async function onInviteLink() {
    if (!status.inviteCode) return;
    void haptics.light();
    await Share.share({
      message: `Add me on NovaMe! My Friend ID is ${status.inviteCode} — let's share memory items together.`,
    });
  }

  return (
    <ImageBackground source={BACKGROUNDS.friends} style={styles.root} resizeMode="cover">
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
              onPress={() => Alert.alert('Scan Code', 'QR scanning is coming soon — share your Friend ID for now!')}
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
            <Text style={styles.idLabel}>My Friend ID</Text>
            <Text style={styles.idValue}>{status.inviteCode ?? '——————'}</Text>
          </View>

          {/* incoming requests */}
          {status.pending.map((req) => (
            <View key={req.friendshipId} style={styles.reqCard}>
              <View style={styles.reqAvatar}><Text style={styles.reqAvatarEmoji}>{'🐰'}</Text></View>
              <View style={styles.reqBody}>
                <Text style={styles.reqName}>{req.displayName}</Text>
                <Text style={styles.reqSub}>Wants to share memories</Text>
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
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
});

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import {
  fetchFriends, getCachedFriends, addFriend,
  type FriendsStatus,
} from '@/lib/friends-api';
import { getCachedMeStats } from '@/lib/me-stats';
import { supabase } from '@/lib/supabase';
import { UserAvatar } from '@/components/ui/user-avatar';
import { GridBackground } from '@/components/ui/grid-background';

type ResolvedPartner = {
  code: string;
  name: string;
  userId?: string;
  avatarUrl?: string;
  isDefaultAvatar?: boolean;
};

/**
 * Partner connection is now consent-by-code: either person can enter the
 * other's exact six-character code and both accounts become paired at once.
 * There is no pending request or approval screen.
 */
export default function FriendAddScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<FriendsStatus>(() => getCachedFriends());
  const [myUserId, setMyUserId] = useState<string | undefined>();
  const [entryOpen, setEntryOpen] = useState(false);
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState<ResolvedPartner | null>(null);
  const me = getCachedMeStats();

  const load = useCallback(() => {
    void fetchFriends({ force: true }).then(setStatus);
  }, []);
  useFocusEffect(load);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setMyUserId(data.session?.user?.id));
  }, []);

  async function connectNow() {
    const normalized = code.trim().toUpperCase();
    if (normalized.length !== 6 || pairing) return;
    Keyboard.dismiss();
    void haptics.medium();
    setPairing(true);
    const result = await addFriend(normalized, { relationship: 'Partner' });
    setPairing(false);
    if (!result.ok) {
      appAlert('Wrong code', '');
      return;
    }
    void haptics.success();
    setConnected({
      code: normalized,
      name: result.partner?.displayName || result.pairedName || 'Partner',
      userId: result.partner?.userId,
      avatarUrl: result.partner?.avatarUrl,
      isDefaultAvatar: result.partner?.isDefaultAvatar,
    });
    setEntryOpen(false);
    load();
  }

  async function copyCode() {
    if (!status.inviteCode || copied) return;
    await Clipboard.setStringAsync(status.inviteCode);
    void haptics.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function shareInvite() {
    if (!status.inviteCode) return;
    void haptics.light();
    await Share.share({
      message: `Join my Burrow. Enter my code ${status.inviteCode} and we’ll be connected right away.`,
    });
  }

  if (connected) {
    return (
      <View style={styles.lightRoot}>
        <GridBackground />
        <View style={[styles.successPage, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 22 }]}>
          <View style={styles.successCard}>
            <View style={styles.personColumn}>
              <UserAvatar userId={myUserId} avatarUrl={me?.avatarUrl} isDefaultAvatar={me?.isDefaultAvatar} size={68} />
              <Text style={styles.personName}>{me?.displayName || 'You'}</Text>
            </View>
            <View style={styles.successMiddle}>
              <Text style={styles.successRelationship}>Partner</Text>
              <Text style={styles.successDays}>Connected today</Text>
            </View>
            <View style={styles.personColumn}>
              <UserAvatar userId={connected.userId} avatarUrl={connected.avatarUrl} isDefaultAvatar={connected.isDefaultAvatar} size={68} />
              <Text style={styles.personName}>{connected.name}</Text>
            </View>
          </View>
          <Text style={styles.successTitle}>Success! You’re now connected with {connected.name}</Text>
          <Text style={styles.successBody}>You can now see each other’s shared daily moments, create memories together, and enjoy Bunny Court.</Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => router.back()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <GridBackground base="#7E5233" line="#956B4C" cell={22} lineWidth={1.2} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 26, paddingBottom: insets.bottom + 104 }]}
        showsVerticalScrollIndicator={false}
      >
        <Image source={ICONS.friendList} style={styles.bunnies} contentFit="contain" />
        <Text style={styles.heading}>Share Your Invite Link</Text>
        <Pressable onPress={() => void shareInvite()} style={styles.creamButton}>
          <MaterialIcons name="link" size={25} color="#2E9A62" />
          <Text style={styles.creamButtonText}>Invite Link</Text>
        </Pressable>
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>My Burrow Code</Text>
          <Text style={styles.codeValue}>{status.inviteCode ?? '——————'}</Text>
        </View>
        <Pressable onPress={() => void copyCode()} style={styles.creamButton}>
          <MaterialIcons name={copied ? 'check' : 'content-copy'} size={23} color="#2E9A62" />
          <Text style={styles.creamButtonText}>{copied ? 'Copied!' : 'Copy ID'}</Text>
        </Pressable>
        <Pressable
          onPress={() => { void haptics.pageOpen(); setCode(''); setEntryOpen(true); }}
          hitSlop={10}
        >
          <Text style={styles.haveCode}>I have a code from my partner</Text>
        </Pressable>
      </ScrollView>
      <Pressable
        onPress={() => { void haptics.pageClose(); router.back(); }}
        style={[styles.closeButton, { bottom: insets.bottom + 18 }]}
      >
        <MaterialIcons name="close" size={30} color="#6B4226" />
      </Pressable>

      {entryOpen && (
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.entrySheet}>
            <Pressable
              onPress={() => { Keyboard.dismiss(); setEntryOpen(false); setCode(''); }}
              style={styles.sheetClose}
              hitSlop={10}
            >
              <MaterialIcons name="close" size={28} color="#32215D" />
            </Pressable>
            <Text style={styles.entryTitle}>Enter your partner’s Burrow code</Text>
            <View style={styles.codeBoxes}>
              {Array.from({ length: 6 }).map((_, index) => (
                <View key={index} style={[styles.codeBox, code.length === index && styles.codeBoxActive]}>
                  <Text style={styles.codeCharacter}>{code[index] || ''}</Text>
                </View>
              ))}
              <TextInput
                autoFocus
                value={code}
                onChangeText={(value) => {
                  const nextCode = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
                  setCode(nextCode);
                }}
                autoCapitalize="characters"
                maxLength={6}
                returnKeyType="done"
                blurOnSubmit
                onSubmitEditing={() => {
                  if (code.length === 6) void connectNow();
                }}
                style={styles.hiddenCodeInput}
              />
            </View>
            <Pressable
              onPress={() => void connectNow()}
              disabled={code.length !== 6 || pairing}
              style={[styles.pairButton, (code.length !== 6 || pairing) && styles.disabledButton]}
            >
              {pairing ? <ActivityIndicator color="#FFFFFF" /> : (
                <Text style={styles.pairButtonText}>Connect</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#7E5233' },
  lightRoot: { flex: 1, backgroundColor: '#F8E2C1' },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 34, gap: 24 },
  bunnies: { width: 126, height: 98, alignSelf: 'center', marginBottom: 10 },
  heading: { fontSize: 29, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', marginBottom: 6 },
  creamButton: { minHeight: 72, borderRadius: 32, backgroundColor: '#FFF3CF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  creamButtonText: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#2A2118' },
  codeCard: { minHeight: 138, borderRadius: 32, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', gap: 12 },
  codeLabel: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#18130F' },
  codeValue: { fontSize: 36, letterSpacing: 5, fontFamily: 'Inter_800ExtraBold', color: '#12100E' },
  haveCode: { fontSize: 20, lineHeight: 28, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', textDecorationLine: 'underline', marginTop: 10 },
  closeButton: { position: 'absolute', alignSelf: 'center', width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 4 },
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(55,36,23,0.45)', justifyContent: 'flex-end', paddingHorizontal: 14, paddingBottom: 12 },
  entrySheet: { width: '100%', maxWidth: 430, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 28, paddingHorizontal: 18, paddingTop: 58, paddingBottom: 20 },
  sheetClose: { position: 'absolute', right: 18, top: 16 },
  entryTitle: { fontSize: 25, lineHeight: 32, fontFamily: 'Inter_800ExtraBold', color: '#32215D', textAlign: 'center' },
  codeBoxes: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 30, position: 'relative' },
  codeBox: { width: 42, height: 54, borderRadius: 14, borderWidth: 1.5, borderColor: '#C8C1D2', alignItems: 'center', justifyContent: 'center' },
  codeBoxActive: { borderColor: '#7654A3', borderWidth: 2 },
  codeCharacter: { fontSize: 25, fontFamily: 'Inter_800ExtraBold', color: '#32215D' },
  hiddenCodeInput: { ...StyleSheet.absoluteFillObject, opacity: 0.01, color: 'transparent' },
  pairButton: { minHeight: 58, borderRadius: 29, backgroundColor: '#7051A0', alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  disabledButton: { opacity: 0.42 },
  pairButtonText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  successPage: { flex: 1, paddingHorizontal: 28, alignItems: 'stretch' },
  successCard: { marginTop: '42%', minHeight: 138, borderRadius: 28, backgroundColor: '#FFF8E8', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  personColumn: { width: 82, alignItems: 'center', gap: 8 },
  personName: { fontSize: 14, fontFamily: 'Inter_800ExtraBold', color: '#211A14', textAlign: 'center' },
  successMiddle: { flex: 1, alignItems: 'center', gap: 4 },
  successRelationship: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#1A1511' },
  successDays: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#796854' },
  successTitle: { marginTop: 42, fontSize: 30, lineHeight: 38, fontFamily: 'Inter_800ExtraBold', color: '#241A12', textAlign: 'center' },
  successBody: { marginTop: 24, fontSize: 17, lineHeight: 25, fontFamily: 'Inter_500Medium', color: '#3B3026', textAlign: 'center' },
  primaryButton: { minHeight: 66, borderRadius: 24, backgroundColor: '#4A3220', alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
});

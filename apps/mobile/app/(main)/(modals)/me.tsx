import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as StoreReview from 'expo-store-review';
import Constants from 'expo-constants';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import { PRICING_TIERS } from '@novame/core';
import { PlanBillingSheet, type PlanBillingSheetRef } from '@/components/me/plan-billing-sheet';
import { haptics } from '@/lib/haptics';
import {
  getCachedSubscriptionTier,
  fetchSubscriptionTier,
  clearCachedSubscription,
} from '@/lib/subscription';
import { signOut } from '@/lib/auth';
import { fetchDuoStatus, joinDuo, type DuoStatus } from '@/lib/duo-api';
import { fetchFriends } from '@/lib/friends-api';
import { supabase } from '@/lib/supabase';
import { useRef } from 'react';

const PRIVACY_URL = 'https://novameapp.com/privacy';
const TERMS_URL = 'https://novameapp.com/terms';

/**
 * Settings center (design: menu.png), reached from Home's top-left hamburger.
 * Warm cream page: X close, avatar + name, an Enable Notifications card, the
 * NovaMe Plus banner, then a white list card of settings rows. All v2 logic
 * (Plan & Billing sheet, Duo seats, sign out, legal) is unchanged from the
 * previous night-theme build — this is a reskin plus the design's new rows
 * (Invite Friends, Rate Us, Report Bugs / Help Centers → support).
 *
 * Row icons are emoji placeholders until the sticker icon set covers them —
 * same convention as the Skills pill on the companion sheet.
 */
export default function MeScreen() {
  const insets = useSafeAreaInsets();
  const planBillingSheetRef = useRef<PlanBillingSheetRef>(null);
  const [tier, setTier] = useState(() => getCachedSubscriptionTier());
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [duo, setDuo] = useState<DuoStatus>({ asOwner: null, asMember: null });
  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      setEmail(user?.email ?? '');
      const meta = (user?.user_metadata ?? {}) as { display_name?: string; name?: string };
      setDisplayName(meta.display_name || meta.name || '');
    });
  }, []);

  // Refresh tier on focus (e.g. returning from the paywall).
  useFocusEffect(
    useCallback(() => {
      void supabase.auth.getSession().then(({ data }) => {
        const userId = data.session?.user?.id;
        if (userId) void fetchSubscriptionTier(userId).then((s) => setTier(s.tier)).catch(() => {});
      });
      void fetchDuoStatus().then(setDuo);
    }, []),
  );

  async function shareDuoCode() {
    if (!duo.asOwner) return;
    void haptics.light();
    await Share.share({ message: `Join me on NovaMe Plus! Enter my Duo code: ${duo.asOwner.inviteCode}` });
  }

  async function onJoinDuo() {
    const code = joinCode.trim();
    if (code.length < 4 || joining) return;
    setJoining(true);
    void haptics.medium();
    const res = await joinDuo(code);
    setJoining(false);
    if (res.ok) {
      Alert.alert('Welcome to Plus', "You've joined a Duo plan. Enjoy everything Plus.", [
        { text: 'Great', onPress: () => { setJoinCode(''); void fetchDuoStatus().then(setDuo); } },
      ]);
    } else {
      const msg =
        res.error === 'already_plus' ? "You're already on Plus."
        : res.error === 'code_not_found' ? "That code doesn't look right."
        : res.error === 'seat_taken' ? 'That Duo seat is already taken.'
        : res.error === 'cannot_claim_own' ? "That's your own code!"
        : res.error === 'owner_inactive' ? "The owner's plan isn't active."
        : 'Something went wrong. Try again.';
      Alert.alert('Hmm', msg);
    }
  }

  const goTo = (path: string) => {
    void haptics.light();
    router.push(path as never);
  };

  const openUrl = async (url: string) => {
    void haptics.light();
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      console.warn('[me] openBrowserAsync failed:', e);
    }
  };

  /** Design row "Invite Friends": share your friend code via the system sheet. */
  const onInviteFriends = async () => {
    void haptics.light();
    try {
      const status = await fetchFriends();
      if (status.inviteCode) {
        await Share.share({
          message: `Add me on NovaMe! My friend code is ${status.inviteCode} — let's share memory items together.`,
        });
        return;
      }
    } catch {
      // fall through to the Friends tab, where the full add flow lives
    }
    router.push('/(main)/(tabs)/friends' as never);
  };

  /** Design row "Rate Us on App Store": native in-app review when available. */
  const onRateUs = async () => {
    void haptics.light();
    try {
      if (await StoreReview.hasAction()) {
        await StoreReview.requestReview();
      }
    } catch (e) {
      console.warn('[me] store review failed:', e);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          void haptics.warning();
          clearCachedSubscription();
          await signOut();
          router.replace('/');
        },
      },
    ], { cancelable: true });
  };

  // Defensive: a stale cache may still hold an old tier key (pro/basic/ultra)
  // that no longer exists in PRICING_TIERS. Any non-free unknown maps to plus.
  const safeTier = PRICING_TIERS[tier] ? tier : tier === 'free' ? 'free' : 'plus';
  const isPlus = safeTier !== 'free';
  const appVersion = Constants.expoConfig?.version ?? '';

  return (
    <BottomSheetModalProvider>
      <View style={styles.root}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
          {/* Header: brown X + avatar + name */}
          <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
            <Pressable onPress={() => { void haptics.light(); router.back(); }} style={styles.closeBtn} hitSlop={8}>
              <MaterialIcons name="close" size={22} color="#FFFFFF" />
            </Pressable>
            <View style={styles.userRow}>
              <View style={styles.avatarWrap}>
                <MaterialIcons name="person" size={34} color="#B49B7A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName} numberOfLines={1}>{displayName || 'You'}</Text>
                {email ? <Text style={styles.userEmail} numberOfLines={1}>{email}</Text> : null}
              </View>
            </View>
          </View>

          {/* Enable Notifications card (design) */}
          <View style={styles.notifCard}>
            <Text style={styles.rowEmoji}>{'🔔'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.notifTitle}>Enable Notifications</Text>
              <Text style={styles.notifSub}>Get reminder to collect your memories.</Text>
            </View>
            <Pressable
              onPress={() => goTo('/(main)/(modals)/notification-settings')}
              style={({ pressed }) => [styles.notifBtn, pressed && styles.pressedBtn]}
            >
              <Text style={styles.notifBtnText}>Enable</Text>
            </Pressable>
          </View>

          {/* NovaMe Plus banner (design: brown, white View button) */}
          <View style={styles.plusBanner}>
            <Text style={styles.rowEmoji}>{'🪪'}</Text>
            <View style={{ flex: 1 }}>
              <View style={styles.plusTitleRow}>
                <Text style={styles.plusTitle}>NovaMe</Text>
                <View style={styles.plusChip}><Text style={styles.plusChipText}>Plus</Text></View>
              </View>
              <Text style={styles.plusSub}>
                {isPlus
                  ? "You're on Plus. Every premium feature is yours."
                  : 'Get Plus to unlock all premium features to you and your bff'}
              </Text>
            </View>
            <Pressable
              onPress={() => { void haptics.light(); planBillingSheetRef.current?.present(); }}
              style={({ pressed }) => [styles.plusViewBtn, pressed && styles.pressedBtn]}
            >
              <Text style={styles.plusViewText}>View</Text>
            </Pressable>
          </View>

          {/* Settings list (design rows) */}
          <View style={styles.menuCard}>
            <MenuRow emoji={'🙂'} label="Account Management" onPress={() => goTo('/(main)/(modals)/account-management')} divider />
            <MenuRow emoji={'👛'} label="Plan and Billing" onPress={() => { void haptics.light(); planBillingSheetRef.current?.present(); }} divider />
            <MenuRow emoji={'🐰'} label="Invite Friends" onPress={() => void onInviteFriends()} divider />
            <MenuRow emoji={'⭐'} label="Rate Us on App Store" onPress={() => void onRateUs()} divider />
            <MenuRow emoji={'🐞'} label="Report Bugs" onPress={() => goTo('/(main)/(modals)/support')} divider />
            <MenuRow emoji={'💝'} label="Help Centers" onPress={() => goTo('/(main)/(modals)/support')} />
          </View>

          {/* Duo seat (kept from v2 build — not in the mock, but load-bearing) */}
          {duo.asOwner ? (
            <View style={styles.duoCard}>
              <Text style={styles.duoTitle}>Your Duo plan</Text>
              {duo.asOwner.claimed ? (
                <Text style={styles.duoBody}>
                  {duo.asOwner.memberName} has joined your Plus. Both of you are covered.
                </Text>
              ) : (
                <>
                  <Text style={styles.duoBody}>Share this one-time code with a friend to give them Plus:</Text>
                  <Pressable onPress={shareDuoCode}>
                    <Text style={styles.duoCode}>{duo.asOwner.inviteCode}</Text>
                  </Pressable>
                  <Pressable onPress={shareDuoCode} style={styles.duoShareBtn}>
                    <MaterialIcons name="ios-share" size={16} color="#7A5A36" />
                    <Text style={styles.duoShareText}>Share code</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : duo.asMember ? (
            <View style={styles.duoCard}>
              <Text style={styles.duoTitle}>Plus via Duo</Text>
              <Text style={styles.duoBody}>
                You're on Plus through {duo.asMember.ownerName}'s Duo plan.
              </Text>
            </View>
          ) : safeTier === 'free' ? (
            <View style={styles.duoCard}>
              <Text style={styles.duoTitle}>Join Plus by Duo Plan</Text>
              <Text style={styles.duoBody}>Got a Duo code from a friend? Enter it to unlock Plus.</Text>
              <TextInput
                value={joinCode}
                onChangeText={(t) => setJoinCode(t.toUpperCase())}
                placeholder="Enter Duo code"
                placeholderTextColor="#B8A588"
                autoCapitalize="characters"
                maxLength={8}
                style={styles.duoInput}
              />
              <Pressable
                onPress={onJoinDuo}
                disabled={joinCode.trim().length < 4 || joining}
                style={[styles.duoJoinBtn, { opacity: joinCode.trim().length < 4 ? 0.5 : 1 }]}
              >
                <Text style={styles.duoJoinText}>{joining ? 'Joining...' : 'Join Plus'}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Sign Out */}
          <Pressable onPress={handleSignOut} style={({ pressed }) => [styles.signOutBtn, { opacity: pressed ? 0.85 : 1 }]}>
            <MaterialIcons name="logout" size={20} color="#C25B4E" />
            <Text style={styles.signOutText}>Sign Out</Text>
          </Pressable>

          {/* Legal */}
          <View style={styles.legalRow}>
            <Pressable onPress={() => openUrl(PRIVACY_URL)} hitSlop={8}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </Pressable>
            <Text style={styles.legalDot}>·</Text>
            <Pressable onPress={() => openUrl(TERMS_URL)} hitSlop={8}>
              <Text style={styles.legalLink}>Terms of Service</Text>
            </Pressable>
          </View>
          {appVersion ? <Text style={styles.versionText}>VERSION {appVersion}</Text> : null}
        </ScrollView>

        <PlanBillingSheet ref={planBillingSheetRef} />
      </View>
    </BottomSheetModalProvider>
  );
}

function MenuRow({ emoji, label, onPress, divider }: {
  emoji: string;
  label: string;
  onPress: () => void;
  divider?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, divider && styles.menuDivider, { opacity: pressed ? 0.6 : 1 }]}>
      <Text style={styles.rowEmoji}>{emoji}</Text>
      <Text style={styles.menuLabel}>{label}</Text>
      <MaterialIcons name="chevron-right" size={22} color="#C9BCA5" />
    </Pressable>
  );
}

// Warm cream palette from menu.png: page #F2E6CB, cards #FFFFFF, brown accents
// #4A3423, banner #4A3220, body text #2B2B2B, muted #8A7A63.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2E6CB' },
  scroll: { paddingHorizontal: 20 },
  header: { marginBottom: 18 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#4A3423', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  userName: { color: '#4A3423', fontSize: 24, fontFamily: 'Inter_800ExtraBold' },
  userEmail: { color: '#8A7A63', fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 2 },

  rowEmoji: { fontSize: 24 },
  pressedBtn: { transform: [{ translateY: 1 }], opacity: 0.85 },

  notifCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, marginBottom: 14,
  },
  notifTitle: { color: '#2B2B2B', fontSize: 17, fontFamily: 'Inter_800ExtraBold' },
  notifSub: { color: '#8A7A63', fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 2 },
  notifBtn: { backgroundColor: '#8A6240', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 11 },
  notifBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },

  plusBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#4A3220', borderRadius: 20, padding: 16, marginBottom: 14,
  },
  plusTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plusTitle: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_800ExtraBold' },
  plusChip: { backgroundColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  plusChipText: { color: '#4A3220', fontSize: 13, fontFamily: 'Inter_800ExtraBold' },
  plusSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 3, lineHeight: 18 },
  plusViewBtn: { backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 20, paddingVertical: 11 },
  plusViewText: { color: '#2B2B2B', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },

  menuCard: { backgroundColor: '#FFFFFF', borderRadius: 20, marginBottom: 14, paddingHorizontal: 16 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  menuDivider: { borderBottomWidth: 1, borderBottomColor: '#F0EAE0' },
  menuLabel: { flex: 1, color: '#2B2B2B', fontSize: 16, fontFamily: 'Inter_700Bold' },

  duoCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, marginBottom: 14, borderWidth: 1.5, borderColor: '#E8D5B0' },
  duoTitle: { color: '#4A3423', fontSize: 15, fontFamily: 'Inter_800ExtraBold', marginBottom: 8 },
  duoBody: { color: '#6B5B44', fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 19, marginBottom: 6 },
  duoCode: { color: '#8A6240', fontSize: 26, fontFamily: 'Inter_800ExtraBold', letterSpacing: 4, textAlign: 'center', marginVertical: 6 },
  duoShareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  duoShareText: { color: '#7A5A36', fontSize: 13, fontFamily: 'Inter_700Bold' },
  duoInput: {
    borderWidth: 1.5, borderColor: '#E8D5B0', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 3,
    textAlign: 'center', color: '#4A3423', marginBottom: 10, backgroundColor: '#FBF6EA',
  },
  duoJoinBtn: { backgroundColor: '#8A6240', borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  duoJoinText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 15, borderRadius: 20, backgroundColor: '#FFFFFF', marginBottom: 20,
  },
  signOutText: { color: '#C25B4E', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },

  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  legalLink: { color: '#8A7A63', fontSize: 13, fontFamily: 'Inter_500Medium' },
  legalDot: { color: '#C9BCA5' },
  versionText: { color: '#B8A588', fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'center', marginTop: 12, letterSpacing: 1 },
});

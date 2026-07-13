import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
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
import { supabase } from '@/lib/supabase';
import { useRef } from 'react';

const PRIVACY_URL = 'https://novameapp.com/privacy';
const TERMS_URL = 'https://novameapp.com/terms';

/**
 * Me -- the settings center, reached from Home's top-left hamburger. Rebuilt for
 * v2 from the v1 me page, minus the self-match gauge and journey stats (those
 * belonged to systems v2 replaced). What remains is the account + settings hub:
 * the current plan (with the Plan & Billing sheet and the IAP paywall behind
 * it), account management, notifications, support, sign out, and legal links.
 *
 * The 8-dimension scores live on the Status tab, a separate page -- this one is
 * settings only.
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

  const tierInfo = PRICING_TIERS[tier];
  const appVersion = Constants.expoConfig?.version ?? '';

  return (
    <BottomSheetModalProvider>
      <View style={styles.root}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
            <Pressable onPress={() => { void haptics.light(); router.back(); }} style={styles.closeBtn} hitSlop={8}>
              <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
            </Pressable>
            <View style={styles.userRow}>
              <View style={styles.avatarWrap}>
                <MaterialIcons name="person" size={32} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName} numberOfLines={1}>{displayName || 'You'}</Text>
                <Text style={styles.userEmail} numberOfLines={1}>{email || 'Signed in'}</Text>
              </View>
            </View>
          </View>

          {/* Current Plan */}
          <View style={styles.planCard}>
            <View style={styles.planLeft}>
              <View style={styles.planIcon}>
                <MaterialIcons name="workspace-premium" size={22} color="#FBBF24" />
              </View>
              <View>
                <Text style={styles.planName}>{tierInfo.name} Plan</Text>
                <Text style={styles.planUsage}>{tierInfo.monthlyAnalyses} insights / month</Text>
              </View>
            </View>
            <Pressable
              onPress={() => { void haptics.light(); planBillingSheetRef.current?.present(); }}
              style={({ pressed }) => [styles.planViewBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={styles.planViewText}>View</Text>
            </Pressable>
          </View>

          {/* Menu */}
          <View style={styles.menuCard}>
            <MenuRow icon="manage-accounts" label="Account Management" onPress={() => goTo('/(main)/(modals)/account-management')} divider />
            <MenuRow icon="credit-card" label="Plan and Billing" onPress={() => planBillingSheetRef.current?.present()} divider />
            <MenuRow icon="notifications" label="Notification Settings" onPress={() => goTo('/(main)/(modals)/notification-settings')} divider />
            <MenuRow icon="help" label="Support" onPress={() => goTo('/(main)/(modals)/support')} />
          </View>

          {/* Duo seat */}
          {duo.asOwner ? (
            <View style={styles.duoCard}>
              <Text style={styles.duoTitle}>Your Duo plan</Text>
              {duo.asOwner.claimed ? (
                <Text style={styles.duoClaimed}>
                  {duo.asOwner.memberName} has joined your Plus. Both of you are covered.
                </Text>
              ) : (
                <>
                  <Text style={styles.duoHint}>Share this one-time code with a friend to give them Plus:</Text>
                  <Pressable onPress={shareDuoCode}>
                    <Text style={styles.duoCode}>{duo.asOwner.inviteCode}</Text>
                  </Pressable>
                  <Pressable onPress={shareDuoCode} style={styles.duoShareBtn}>
                    <MaterialIcons name="ios-share" size={16} color="#C084FC" />
                    <Text style={styles.duoShareText}>Share code</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : duo.asMember ? (
            <View style={styles.duoCard}>
              <Text style={styles.duoTitle}>Plus via Duo</Text>
              <Text style={styles.duoClaimed}>
                You're on Plus through {duo.asMember.ownerName}'s Duo plan.
              </Text>
            </View>
          ) : tier === 'free' ? (
            <View style={styles.duoCard}>
              <Text style={styles.duoTitle}>Join Plus by Duo Plan</Text>
              <Text style={styles.duoHint}>Got a Duo code from a friend? Enter it to unlock Plus.</Text>
              <TextInput
                value={joinCode}
                onChangeText={(t) => setJoinCode(t.toUpperCase())}
                placeholder="Enter Duo code"
                placeholderTextColor="rgba(255,255,255,0.3)"
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
            <MaterialIcons name="logout" size={20} color="#F87171" />
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

function MenuRow({ icon, label, onPress, divider }: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  divider?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, divider && styles.menuDivider, { opacity: pressed ? 0.7 : 1 }]}>
      <MaterialIcons name={icon} size={22} color="rgba(255,255,255,0.7)" />
      <Text style={styles.menuLabel}>{label}</Text>
      <MaterialIcons name="chevron-right" size={22} color="rgba(255,255,255,0.3)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F0B2E' },
  scroll: { paddingHorizontal: 20 },
  header: { marginBottom: 20 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarWrap: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  userName: { color: '#FFFFFF', fontSize: 20, fontFamily: 'Inter_700Bold' },
  userEmail: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 2 },

  planCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 16, marginBottom: 16 },
  planLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(251,191,36,0.15)', alignItems: 'center', justifyContent: 'center' },
  planName: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
  planUsage: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  planViewBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 12, backgroundColor: 'rgba(168,85,247,0.2)' },
  planViewText: { color: '#C084FC', fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  menuCard: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, marginBottom: 16, paddingHorizontal: 16 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  menuDivider: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  menuLabel: { flex: 1, color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_500Medium' },

  duoCard: { backgroundColor: 'rgba(168,85,247,0.1)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(168,85,247,0.25)', padding: 16, marginBottom: 16 },
  duoTitle: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  duoHint: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19, marginBottom: 10 },
  duoClaimed: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontFamily: 'Inter_500Medium', lineHeight: 20 },
  duoCode: { color: '#C084FC', fontSize: 26, fontFamily: 'Inter_800ExtraBold', letterSpacing: 4, textAlign: 'center', marginVertical: 6 },
  duoShareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  duoShareText: { color: '#C084FC', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  duoInput: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 3, textAlign: 'center', color: '#FFFFFF', marginBottom: 10 },
  duoJoinBtn: { backgroundColor: '#A855F7', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  duoJoinText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 16, backgroundColor: 'rgba(248,113,113,0.12)', marginBottom: 20 },
  signOutText: { color: '#F87171', fontSize: 15, fontFamily: 'Inter_700Bold' },

  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  legalLink: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontFamily: 'Inter_500Medium' },
  legalDot: { color: 'rgba(255,255,255,0.3)' },
  versionText: { color: 'rgba(255,255,255,0.3)', fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'center', marginTop: 12, letterSpacing: 1 },
});

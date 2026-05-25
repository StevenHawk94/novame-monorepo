import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';

import { MiniGauge } from '@/components/me/mini-gauge';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import {
  PlanBillingSheet,
  type PlanBillingSheetRef,
} from '@/components/me/plan-billing-sheet';
import { haptics } from '@/lib/haptics';
import { PRICING_TIERS } from '@novame/core';

import {
  type CachedMeStats,
  clearCachedMeStats,
  fetchMeStats,
  getCachedMeStats,
} from '@/lib/me-stats';
import { clearCachedSubscription } from '@/lib/subscription';
import { onPurchaseComplete } from '@/lib/iap';
import { clearCachedCharacterState } from '@/lib/character-state';
import { signOut } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * Me modal -- Stage 3.10.1.
 *
 * Pure cache reader. The Home tab pre-warms /api/me-stats ~1.5s after
 * the user lands on Home, so by the time the hamburger is tapped the
 * cache is hot. If the user is somehow faster than the warm-up (very
 * fast tap immediately after sign-in, or network failed) the screen
 * renders "--" placeholders instead of stats -- every other section
 * still works because profile + tier come from the same cache row.
 *
 * Cache invalidation lives outside this file:
 *   - record.tsx publish success -> invalidateMeStats() + refetch
 *   - account-management.tsx (3.10.2) avatar upload -> same pattern
 *   - subscription change (stage 5 IAP) -> same pattern
 *
 * Sign-out clears all three caches (me-stats / subscription /
 * character-state) before signing out, so the next user can't see
 * stale data through MMKV. The onAuthStateChange listener in
 * app/_layout.tsx handles the actual route transition once Supabase
 * fires SIGNED_OUT.
 */

const PRIVACY_URL = 'https://novameapp.com/privacy';
const TERMS_URL = 'https://novameapp.com/terms';

export default function MeModal() {
  const planBillingSheetRef = useRef<PlanBillingSheetRef>(null);

  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<CachedMeStats | null>(() =>
    getCachedMeStats(),
  );
  const [userEmail, setUserEmail] = useState<string>('');
  const [userId, setUserId] = useState<string>('');

  // Email + userId live in supabase auth, not in me-stats cache. Read
  // once on mount. userId drives fetchMeStats() on purchase complete.
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUserEmail(data.session?.user?.email ?? '');
      setUserId(data.session?.user?.id ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Stage 5.IAP.x.bugfix: subscribe to IAP purchase-complete events.
  // When a purchase succeeds while Me modal is open:
  //   1. Optimistically update planTier / planName / monthlyAnalyses
  //      from PRICING_TIERS so the new plan reflects IMMEDIATELY,
  //      without the 1-10s wait for fetchMeStats network round-trip.
  //   2. Then fire fetchMeStats in the background to reconcile any
  //      server-side fields we can't derive locally (usedThisMonth,
  //      etc.) and to confirm the optimistic guess.
  // Industry standard: SWR / React-Query optimistic-update pattern.
  // Prevents the "10s data-disappeared" gap reported during testing,
  // which was caused by invalidateMeStats() clearing the MMKV cache
  // and the 2s polling below then writing setStats(null) before the
  // refetch landed.
  useEffect(() => {
    if (!userId) return;
    const unsubscribe = onPurchaseComplete(({ tier }) => {
      setStats((prev) => {
        if (!prev) return prev;
        const tierInfo = PRICING_TIERS[tier];
        return {
          ...prev,
          planTier: tier,
          planName: tierInfo.name,
          monthlyAnalyses: tierInfo.monthlyAnalyses,
        };
      });
      void fetchMeStats(userId)
        .then((next) => setStats(next))
        .catch(() => {
          // best-effort -- optimistic update above keeps the UI in
          // a sensible state regardless.
        });
    });
    return unsubscribe;
  }, [userId]);

  // Re-read cache on a 2s tick so a background refetch (e.g. record
  // publish success while this modal happens to be open) reflects in
  // the UI without remount. Cheap because mmkv reads are sync + tiny.
  //
  // Defensive: only overwrite when the cache actually has a non-null
  // record. If a sibling code path called invalidateMeStats() (e.g.
  // IAP purchase clears me-stats so it refetches with the new tier),
  // the cache is briefly null during the network round-trip. Writing
  // setStats(null) here would drop the UI to default placeholders
  // ("Wisdom Seeker", default avatar, Free) for 1-10s -- the bug
  // reported in IAP testing. Stale-while-revalidate: keep the old
  // values until a fresh non-null payload lands.
  useEffect(() => {
    const interval = setInterval(() => {
      const next = getCachedMeStats();
      if (next && next.lastFetchedAtMs !== stats?.lastFetchedAtMs) {
        setStats(next);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [stats]);

  // ---- handlers ----

  const handleClose = () => {
    void haptics.light();
    router.back();
  };

  const goTo = (path: string) => {
    void haptics.light();
    router.push(path as never);
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            void haptics.warning();
            clearCachedMeStats();
            clearCachedSubscription();
            clearCachedCharacterState();
            await signOut();
            // Belt and braces. onAuthStateChange in app/_layout.tsx
            // also routes to (auth)/sign-in when SIGNED_OUT fires;
            // replacing to root makes the redirect deterministic even
            // if that listener races.
            router.replace('/');
          },
        },
      ],
      { cancelable: true },
    );
  };

  const openUrl = async (url: string) => {
    void haptics.light();
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      console.warn('[me] openBrowserAsync failed:', e);
    }
  };

  // ---- derived display values ----

  const displayName = stats?.displayName || 'Wisdom Seeker';
  const avatarUrl = stats?.avatarUrl || '';
  const planName = stats?.planName ?? 'Free';
  const usedThisMonth = stats?.usedThisMonth ?? 0;
  const monthlyAnalyses = stats?.monthlyAnalyses ?? 1;
  const betterSelfScore = stats?.betterSelfScore ?? 70;

  const fmt = (n: number | undefined): string =>
    n === undefined ? '--' : n.toLocaleString();

  const appVersion = Constants.expoConfig?.version ?? '';

  return (
    <BottomSheetModalProvider>
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Hello Star header card */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <View style={styles.headerCircle1} />
          <View style={styles.headerCircle2} />

          <Pressable
            onPress={handleClose}
            style={styles.closeBtn}
            hitSlop={8}
          >
            <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
          </Pressable>

          <Text style={styles.helloStar}>Hello Star</Text>

          <View style={styles.userRow}>
            <View style={styles.avatarWrap}>
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={styles.avatar}
                  contentFit="cover"
                />
              ) : (
                <MaterialIcons name="person" size={32} color="#FFFFFF" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={styles.userEmail} numberOfLines={1}>
                {userEmail || 'Signed in'}
              </Text>
            </View>
          </View>
        </View>

        {/* 2. Better Self Match */}
        <Pressable
          onPress={() => { void haptics.light(); goTo('/(main)/(modals)/growth-center'); }}
          style={({ pressed }) => [
            styles.card,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardHeaderLeft}>
              <MaterialIcons name="star" size={18} color="#FBBF24" />
              <Text style={styles.cardHeaderTitle}>Better Self Match</Text>
            </View>
            <View style={styles.cardHeaderRight}>
              <Text style={styles.cardHeaderHint}>Details</Text>
              <MaterialIcons
                name="chevron-right"
                size={20}
                color="rgba(255,255,255,0.4)"
              />
            </View>
          </View>
          <View style={styles.gaugeWrap}>
            <MiniGauge score={betterSelfScore} />
          </View>
        </Pressable>

        {/* 3. Wisdom Stats 2x2 */}
        <View style={styles.card}>
          <Text style={styles.statsHeader}>YOUR WISDOM STATS</Text>
          <View style={styles.statsGrid}>
            <StatItem
              icon="edit-note"
              iconColor="#F97316"
              iconBg="rgba(249,115,22,0.18)"
              value={fmt(stats?.totalWords)}
              label="Words"
            />
            <StatItem
              icon="style"
              iconColor="#A855F7"
              iconBg="rgba(168,85,247,0.18)"
              value={fmt(stats?.totalCards)}
              label="Cards"
            />
            <StatItem
              icon="visibility"
              iconColor="#3B82F6"
              iconBg="rgba(59,130,246,0.18)"
              value={fmt(stats?.peopleImpacted)}
              label="People Impacted"
            />
            <StatItem
              icon="star"
              iconColor="#FBBF24"
              iconBg="rgba(251,191,36,0.18)"
              value={fmt(stats?.totalExp)}
              label="Total EXP"
            />
          </View>
        </View>

        {/* 4. Current Plan */}
        <View style={styles.planCard}>
          <View style={styles.planLeft}>
            <View style={styles.planIcon}>
              <MaterialIcons
                name="workspace-premium"
                size={22}
                color="#FBBF24"
              />
            </View>
            <View>
              <Text style={styles.planName}>{planName} Plan</Text>
              <Text style={styles.planUsage}>
                {usedThisMonth}/{monthlyAnalyses} insights used this month
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => { void haptics.light(); planBillingSheetRef.current?.present(); }}
            style={({ pressed }) => [
              styles.planViewBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={styles.planViewText}>View</Text>
          </Pressable>
        </View>

        {/* 5. Menu */}
        <View style={styles.menuCard}>
          <MenuRow
            icon="manage-accounts"
            label="Account Management"
            onPress={() => goTo('/(main)/(modals)/account-management')}
            divider
          />
          <MenuRow
            icon="credit-card"
            label="Plan and Billing"
            onPress={() => planBillingSheetRef.current?.present()}
            divider
          />
          <MenuRow
            icon="notifications"
            label="Notification Settings"
            onPress={() => goTo('/(main)/(modals)/notification-settings')}
            divider
          />
          <MenuRow
            icon="help"
            label="Support"
            onPress={() => goTo('/(main)/(modals)/support')}
          />
        </View>

        {/* 6. Sign Out */}
        <Pressable
          onPress={handleSignOut}
          style={({ pressed }) => [
            styles.signOutBtn,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <MaterialIcons name="logout" size={20} color="#F87171" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>

        {/* 7. Privacy / Terms + version */}
        <View style={styles.legalRow}>
          <Pressable onPress={() => { void haptics.light(); openUrl(PRIVACY_URL); }} hitSlop={8}>
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </Pressable>
          <Pressable onPress={() => { void haptics.light(); openUrl(TERMS_URL); }} hitSlop={8}>
            <Text style={styles.legalLink}>Terms of Service</Text>
          </Pressable>
        </View>
        {appVersion ? (
          <Text style={styles.versionText}>VERSION {appVersion}</Text>
        ) : null}
      </ScrollView>
      <PlanBillingSheet ref={planBillingSheetRef} />
    </View>
    </BottomSheetModalProvider>
  );
}

// ---- sub-components ----

type StatItemProps = {
  icon: keyof typeof MaterialIcons.glyphMap;
  iconColor: string;
  iconBg: string;
  value: string;
  label: string;
};

function StatItem({ icon, iconColor, iconBg, value, label }: StatItemProps) {
  return (
    <View style={styles.statItem}>
      <View style={[styles.statIconWrap, { backgroundColor: iconBg }]}>
        <MaterialIcons name={icon} size={20} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

type MenuRowProps = {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  divider?: boolean;
};

function MenuRow({ icon, label, onPress, divider }: MenuRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        divider && styles.menuRowDivider,
        { backgroundColor: pressed ? 'rgba(255,255,255,0.04)' : 'transparent' },
      ]}
    >
      <View style={styles.menuRowLeft}>
        <MaterialIcons name={icon} size={22} color="#C084FC" />
        <Text style={styles.menuRowLabel}>{label}</Text>
      </View>
      <MaterialIcons
        name="chevron-right"
        size={22}
        color="rgba(255,255,255,0.3)"
      />
    </Pressable>
  );
}

// ---- styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  scroll: {
    paddingHorizontal: 24,
  },
  // Header
  header: {
    marginHorizontal: -24,
    paddingHorizontal: 24,
    paddingBottom: 28,
    backgroundColor: '#7C3AED',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
  },
  headerCircle1: {
    position: 'absolute',
    top: -32,
    left: -32,
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  headerCircle2: {
    position: 'absolute',
    top: -16,
    right: -16,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  helloStar: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 20,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  userName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  userEmail: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginTop: 2,
  },
  // Card (Better Self + Stats share base)
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    padding: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  cardHeaderHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  gaugeWrap: {
    marginTop: 12,
    alignItems: 'center',
  },
  // Stats
  statsHeader: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statItem: {
    flexBasis: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  statIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  // Plan card
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    padding: 16,
    marginTop: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#FBBF24',
  },
  planLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  planIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  planUsage: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    marginTop: 2,
  },
  planViewBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
  },
  planViewText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '700',
  },
  // Menu
  menuCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    marginTop: 20,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  menuRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  menuRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  menuRowLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  // Sign out
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
  },
  signOutText: {
    color: '#F87171',
    fontSize: 14,
    fontWeight: '700',
  },
  // Legal
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 20,
  },
  legalLink: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  versionText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    letterSpacing: 1.5,
    marginTop: 8,
  },
});

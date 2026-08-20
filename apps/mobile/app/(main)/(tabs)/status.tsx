import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';


import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import { GridBackground } from '@/components/ui/grid-background';
import { ItemSprite } from '@/components/ui/item-sprite';
import { OffsetCard } from '@/components/ui/offset-card';
import {
  fetchCommonItems, fetchInsights, fetchPairing,
  getCachedCommonItems, getCachedInsights, getCachedPairing,
  markConnectionDashboardRefreshed, shouldRefreshConnectionDashboard,
  type CommonItem, type ConnectionInsights, type PairingStatus,
} from '@/lib/friends-api';
import { getCachedMeStats } from '@/lib/me-stats';
import { getBunnyName } from '@/lib/onboarding';
import { supabase } from '@/lib/supabase';
import { UserAvatar } from '@/components/ui/user-avatar';
import { fetchSubscriptionTier, getCachedSubscriptionTier } from '@/lib/subscription';
import { useSubscriptionTier } from '@/lib/use-subscription-tier';

/**
 * Me tab → Connection Board (2026-07-24 重构, mock 1:1). The old Me page
 * (growth stages, dimension tiles) is fully removed; this tab is about the
 * ONE paired relationship:
 *   板块1  title + subtitle + Their Patterns entry
 *   板块2  both members, the relationship, its duration
 *   板块3  up to 8 items BOTH recently reflected (tap → both sides' words)
 *   板块4  Plus daily AI: Emotion / Topic / Care Tips / Boundaries / Hangout
 * Settings stay reachable from Home's menu.
 */
const INSIGHT_SECTIONS: { key: keyof ConnectionInsights; label: string; emoji: string }[] = [
  { key: 'emotion', label: 'Emotion', emoji: '💬' },
  { key: 'topic', label: 'Topic', emoji: '💡' },
  { key: 'careTips', label: 'Care Tip', emoji: '❤️' },
  { key: 'boundaries', label: 'Boundaries', emoji: '🚧' },
  { key: 'hangoutIdeas', label: 'Hangout Ideas', emoji: '🎈' },
];

// The unpaired teaser cards (mock 2026-08-05 v2): what pairing unlocks.
const TEASER_PILLS = [
  { label: 'Vibe Matching Moments', icon: ICONS.vibeMatching },
  { label: 'Emotion Status', icon: ICONS.emotionStatus },
  { label: 'Care Tips', icon: ICONS.careTips },
  { label: 'Topics Ideas', icon: ICONS.topicIdeas },
  { label: 'Boundaries', icon: ICONS.boundary },
  { label: 'Hangout Ideas', icon: ICONS.hangout },
];

// Fixed, pre-blurred fake copy. Free users never receive real AI insight text.
const LOCKED_INSIGHT_PREVIEW = require('../../../assets/connection/connection-board-free.webp');


export default function ConnectionDashboardScreen() {
  const router = useRouter();
  // Cache-first (2026-08-08): the tab paints its last-known state instantly;
  // the focus-effect fetches only reconcile in the background.
  const [pairing, setPairing] = useState<PairingStatus | null>(() => getCachedPairing());
  const [myName, setMyName] = useState('Me');
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myAvatarUrl, setMyAvatarUrl] = useState('');
  const [myIsDefaultAvatar, setMyIsDefaultAvatar] = useState<boolean | undefined>(undefined);
  const [items, setItems] = useState<CommonItem[]>(() => getCachedCommonItems());
  // The cached subscription tier decides the lock INSTANTLY (fetched once at
  // launch + after purchases — industry pattern). A cached 'plus_required'
  // gate from before an upgrade is stale noise: ignore it when the tier says
  // paid, so members never flash 'Unlock Plus' while the fetch reconciles.
  const [isPaid, setIsPaid] = useState(() => getCachedSubscriptionTier() !== 'free');
  const liveTier = useSubscriptionTier();
  const cachedIns = getCachedInsights();
  const [insights, setInsights] = useState<ConnectionInsights | null>(
    cachedIns?.ok ? cachedIns.insights : null,
  );
  const [insightsGate, setInsightsGate] = useState<'ok' | 'plus_required' | 'consent_required' | null>(() => {
    if (!cachedIns) return null;
    if (cachedIns.ok) return 'ok';
    if (cachedIns.error === 'network') return null;
    if (cachedIns.error === 'plus_required' && isPaid) return null; // stale gate
    return cachedIns.error;
  });
  const [openItem, setOpenItem] = useState<CommonItem | null>(null);
  const refreshInFlight = useRef(false);

  useEffect(() => {
    setIsPaid(liveTier !== 'free');
  }, [liveTier]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // Paint from cache immediately, then reconcile pairing + entitlement
      // together. Pair acceptance may have just granted a Duo seat, so the
      // local tier alone is not authoritative enough for this focus pass.
      const cachedPaid = getCachedSubscriptionTier() !== 'free';
      setIsPaid(cachedPaid);
      const previousPartnerId = getCachedPairing()?.partner?.userId ?? null;
      void (async () => {
        const [{ data }, p] = await Promise.all([
          supabase.auth.getSession(),
          fetchPairing(),
        ]);
        if (!active) return;

        let paid = cachedPaid;
        const uid = data.session?.user?.id;
        if (uid) {
          try {
            const freshSubscription = await fetchSubscriptionTier(uid);
            paid = freshSubscription.tier !== 'free';
          } catch {
            // Keep the cache-first state when the background sync is offline.
          }
        }
        if (!active) return;
        setIsPaid(paid);

          setPairing(p);
          if (!p.paired) {
            setItems([]);
            setInsights(null);
            setInsightsGate(null);
            return;
          }
          const partnerChanged = previousPartnerId !== p.partner?.userId;
          const entitlementChanged = paid !== cachedPaid;
          if ((!partnerChanged && !entitlementChanged && !shouldRefreshConnectionDashboard()) || refreshInFlight.current) return;
          refreshInFlight.current = true;
          try {
            const commonPromise = fetchCommonItems().then(setItems);
            if (!paid) {
              setInsightsGate('plus_required');
              await commonPromise;
              return;
            }
            const [, insightResult] = await Promise.all([commonPromise, fetchInsights()]);
            if (insightResult.ok) {
              setInsights(insightResult.insights);
              setInsightsGate('ok');
            } else if (insightResult.error === 'plus_required' || insightResult.error === 'consent_required') {
              setInsightsGate(insightResult.error);
              if (insightResult.error === 'plus_required') {
                // Tier cache says paid but the server disagrees — re-sync it.
                const { data } = await supabase.auth.getSession();
                const uid = data.session?.user?.id;
                if (uid) void fetchSubscriptionTier(uid, { force: true }).catch(() => {});
              }
            }
          } finally {
            markConnectionDashboardRefreshed();
            refreshInFlight.current = false;
          }
      })().catch(() => {
          refreshInFlight.current = false;
        });
      void supabase.auth.getSession().then(({ data }) => {
        setMyUserId(data.session?.user?.id ?? null);
        // Same resolution as the Me page header: profiles.display_name via
        // me-stats (auto-seeded 'user' filtered out) -> onboarding name.
        const cached = getCachedMeStats();
        const profileName =
          cached?.displayName && cached.displayName !== 'user' ? cached.displayName : '';
        const n = profileName || getBunnyName()
          || (data.session?.user?.email?.split('@')[0] as string | undefined);
        if (n) setMyName(n);
        setMyAvatarUrl(cached?.avatarUrl ?? '');
        setMyIsDefaultAvatar(cached?.isDefaultAvatar);
      });
      return () => {
        active = false;
      };
    }, []),
  );


  const partner = pairing?.partner ?? null;
  const insets = useSafeAreaInsets();
  // Narrow-screen type hierarchy (2026-08-08): the title may auto-shrink to
  // fit beside the Their Patterns pill, but only to 80% — and the subtitle
  // steps down with it so the pair never reads the same size.
  const { width: winW } = useWindowDimensions();
  const narrow = winW < 380;
  const hasInsights = !!insights && INSIGHT_SECTIONS.some(({ key }) => {
    const value = insights[key];
    return typeof value === 'string' && value.trim().length > 0;
  });

  return (
    <View style={st.root}>
      {/* 板块1: header — the brown block owns the status-bar area too */}
      <View style={[st.header, { paddingTop: insets.top + 10 }]}>
        <View style={{ flex: 1 }}>
          <Text
            style={[st.title, narrow && { fontSize: 19 }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            Connection Board
          </Text>
          <Text style={[st.subtitle, narrow && { fontSize: 11.5 }]} numberOfLines={2}>Everything new about them at a glance.</Text>
        </View>
        {/* Always shown (mock); display-only until a partner exists. */}
        <OffsetCard
          color="#C96F2A"
          offset={4}
          radius={20}
          disabled={!partner}
          onPress={() => {
            if (!partner) return;
            void haptics.light();
            router.push({
              pathname: '/(main)/their-patterns',
            } as never);
          }}
          cardStyle={st.hubPill}
        >
          <Image source={ICONS.personalVibe} style={st.hubPillIcon} resizeMode="contain" />
          <Text style={st.hubPillText}>Weekly Recap</Text>
        </OffsetCard>
      </View>

      {!pairing || !partner ? (
        /* Unpaired (mock 2026-08-05): grid ground, cream lock card with the
           six teaser pills previewing what pairing unlocks. */
        <View style={{ flex: 1 }}>
          <GridBackground />
          {/* Display-only until paired: no tap targets anywhere (mock v2). */}
          <ScrollView
            contentContainerStyle={st.unpairedScroll}
            showsVerticalScrollIndicator={false}
          >
            <View style={st.pairLockCard}>
              <MaterialIcons name="lock" size={56} color="#5D3A1F" />
              <Text style={st.pairLockText}>Pair with someone now to{'\n'}unlock your connection board</Text>
              <View style={st.teaserGrid}>
                {TEASER_PILLS.map((t) => (
                  <View key={t.label} style={st.teaserPill}>
                    <Image source={t.icon} style={st.teaserIcon} resizeMode="contain" />
                    <Text style={st.teaserPillText} numberOfLines={2}>{t.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <GridBackground />
          <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
            {/* 板块2: the relationship */}
            <View style={st.relCard}>
            <View style={st.relSide}>
              <UserAvatar userId={myUserId} avatarUrl={myAvatarUrl} isDefaultAvatar={myIsDefaultAvatar} size={56} />
              <Text style={st.relName} numberOfLines={1}>{myName}</Text>
            </View>
            <View style={st.relMid}>
              <Text style={st.relTitle}>{pairing.relationship || 'Paired'}</Text>
              <Text style={st.relDays}>For {pairing.pairedDays ?? 0} days</Text>
            </View>
            <View style={st.relSide}>
              <UserAvatar userId={partner.userId} avatarUrl={partner.avatarUrl} isDefaultAvatar={partner.isDefaultAvatar} size={56} />
              <Text style={st.relName} numberOfLines={1}>{partner.displayName}</Text>
            </View>
          </View>

          {/* 板块3: recent moments both people have reflected */}
          <View style={st.sectionPillWrap}>
            <View style={st.sectionPill}>
              <Text style={st.sectionPillText}>Vibe Matching Moments</Text>
            </View>
          </View>
          <View style={st.itemsCard}>
            {items.length === 0 ? (
              <Text style={st.itemsEmpty}>
                Keep reflecting, and vibe matching moments{`\n`}will be displayed here.
              </Text>
            ) : (
              <View style={st.itemsGrid}>
                {items.map((it) => (
                  <Pressable key={it.itemId} onPress={() => { void haptics.light(); setOpenItem(it); }}>
                    <ItemSprite itemId={it.itemId} size={64} radius={14} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* 板块4: a little bit to know */}
          <View style={st.sectionPillWrap}>
            <View style={st.sectionPill}>
              <Text style={st.sectionPillText} numberOfLines={1}>
                What's new with {partner.displayName}
              </Text>
            </View>
          </View>

          {!isPaid || insightsGate === 'plus_required' ? (
            /* Free tier: fixed pre-blurred artwork only (real insights are
               never fetched), with one real paywall button per card. */
            INSIGHT_SECTIONS.map(({ key, label, emoji }) => (
              <View key={key} style={st.insightCard}>
                <View style={st.insightBadge}>
                  <Text style={st.insightBadgeText}>{emoji} {label}</Text>
                </View>
                <View style={st.lockedInsightPreview}>
                  <Image
                    source={LOCKED_INSIGHT_PREVIEW}
                    style={st.lockedInsightImage}
                    resizeMode="contain"
                  />
                  <Pressable
                    onPress={() => { void haptics.light(); router.push('/(main)/(modals)/subscription-paywall' as never); }}
                    style={st.plusBtn}
                  >
                    <MaterialIcons name="lock" size={17} color="#FFFFFF" />
                    <Text style={st.copyBtnText}>Join Plus to Access Details</Text>
                  </Pressable>
                </View>
              </View>
            ))
          ) : insightsGate === 'consent_required' ? (
            <View style={st.lockCard}>
              <MaterialIcons name="privacy-tip" size={22} color="#8A5F3F" />
              <Text style={st.lockText}>Turn on AI features in settings to unlock daily guidance.</Text>
            </View>
          ) : hasInsights ? (
            INSIGHT_SECTIONS.map(({ key, label, emoji }) => {
              const text = insights?.[key];
              if (!text) return null;
              return (
                <View key={key} style={st.insightCard}>
                  <View style={st.insightBadge}>
                    <Text style={st.insightBadgeText}>{emoji} {label}</Text>
                  </View>
                  <Text style={st.insightText}>“{text}”</Text>
                </View>
              );
            })
          ) : (
            <View style={st.emptyInsightCard}>
              <Image source={ICONS.connectionNew} style={st.emptyInsightIcon} resizeMode="contain" />
              <Text style={st.emptyInsightText}>
                {partner.displayName} hasn't reflected anything yet. Once they do, the connection insight will show up here.
              </Text>
            </View>
          )}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      )}

      {/* 板块3 detail: both sides' latest words for one item */}
      {openItem && (
        <View style={st.detailOverlay}>
          <View style={st.detailCard}>
            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              <ItemSprite itemId={openItem.itemId} size={72} radius={16} />
            </View>
            <Text style={st.detailWho}>You</Text>
            <Text style={st.detailText}>{openItem.mine.text}</Text>
            <Text style={[st.detailWho, { marginTop: 14 }]}>{partner?.displayName ?? 'Partner'}</Text>
            <Text style={st.detailText}>
              {openItem.partner.text ?? 'Their words are private — but you both hold this one.'}
            </Text>
            <Pressable onPress={() => setOpenItem(null)} style={st.detailClose} hitSlop={8}>
              <MaterialIcons name="close" size={24} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8D9B8' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#7A4A3A', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18,
  },
  title: { fontSize: 23, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  subtitle: { fontSize: 13.5, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.9)', marginTop: 3 },
  hubPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F0885C', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 9,
  },
  hubPillIcon: { width: 30, height: 30 },
  hubPillText: { fontSize: 13.5, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },
  unpairedScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 20 },

  relCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF6E4',
    borderRadius: 22, padding: 16,
  },
  relSide: { alignItems: 'center', width: 84, gap: 6 },
  relName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#3A2A1A', maxWidth: 84 },
  relMid: { flex: 1, alignItems: 'center', gap: 4 },
  relTitle: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: '#161311', textAlign: 'center' },
  relDays: { fontSize: 13.5, fontFamily: 'Inter_600SemiBold', color: '#8A6240' },

  sectionPillWrap: { alignItems: 'center', marginTop: 18, marginBottom: 12 },
  sectionPill: { backgroundColor: '#7A4A3A', borderRadius: 18, paddingHorizontal: 20, paddingVertical: 11 },
  sectionPillText: { fontSize: 15.5, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  itemsCard: { backgroundColor: '#FFF6E4', borderRadius: 22, padding: 16, minHeight: 90, justifyContent: 'center' },
  itemsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  itemsEmpty: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#8A6240', textAlign: 'center', lineHeight: 21 },

  lockCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF6E4', borderRadius: 22, padding: 18, marginBottom: 14,
  },
  lockText: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#5A4432', lineHeight: 21 },

  emptyInsightCard: {
    minHeight: 260, backgroundColor: '#FFF6E4', borderRadius: 22,
    paddingHorizontal: 28, paddingVertical: 34, marginBottom: 14,
    alignItems: 'center', justifyContent: 'center', gap: 18,
  },
  emptyInsightIcon: { width: 48, height: 48 },
  emptyInsightText: {
    maxWidth: 300, fontSize: 14, fontFamily: 'Inter_500Medium',
    color: '#2A2118', lineHeight: 21, textAlign: 'center',
  },

  insightCard: { backgroundColor: '#FFF6E4', borderRadius: 22, padding: 16, marginBottom: 14 },
  insightBadge: {
    alignSelf: 'flex-start', backgroundColor: '#F7DE8B', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 10,
  },
  insightBadgeText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#4A3423' },
  insightText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#2A2118', lineHeight: 23, marginBottom: 14 },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#B97D5E', borderRadius: 16, paddingVertical: 14,
  },
  copyBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  pairLockCard: {
    marginHorizontal: 18, borderRadius: 32,
    backgroundColor: '#FBF3DF', alignItems: 'center', justifyContent: 'center',
    gap: 22, paddingVertical: 32, paddingHorizontal: 20,
  },
  pairLockText: {
    fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B',
    textAlign: 'center', lineHeight: 29,
  },
  teaserGrid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    columnGap: 8, rowGap: 14, marginTop: 8,
  },
  teaserPill: {
    width: '48%', backgroundColor: '#FFFFFF', borderRadius: 18,
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingVertical: 14, paddingHorizontal: 10, minHeight: 64,
    shadowColor: '#C9A97C', shadowOpacity: 0.8, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  teaserIcon: { width: 26, height: 26 },
  teaserPillText: { flex: 1, fontSize: 13.5, fontFamily: 'Inter_700Bold', color: '#161311' },
  lockedInsightPreview: {
    width: '100%', aspectRatio: 500 / 300, position: 'relative',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 12,
  },
  lockedInsightImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  plusBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    width: '88%', backgroundColor: '#8A6240', borderRadius: 16, paddingVertical: 14,
  },

  detailOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  detailCard: { backgroundColor: '#FDF9F1', borderRadius: 24, padding: 22, width: '100%' },
  detailWho: { fontSize: 13, fontFamily: 'Inter_800ExtraBold', color: '#8A6240', marginBottom: 4 },
  detailText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#2A2118', lineHeight: 22 },
  detailClose: {
    alignSelf: 'center', marginTop: 18, width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#43301F', alignItems: 'center', justifyContent: 'center',
  },
});

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { FeatureGuideModal } from '@/components/main/feature-guide-modal';
import { GridBackground } from '@/components/ui/grid-background';
import { OffsetCard } from '@/components/ui/offset-card';
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  fetchInsights, fetchPairing, getCachedInsights, getCachedPairing,
  markConnectionDashboardRefreshed, shouldRefreshConnectionDashboard,
  shouldShowConnectionResumeLoading,
  type ConnectionInsightCard, type ConnectionInsights, type ConnectionModuleKey,
  type PairingStatus,
} from '@/lib/friends-api';
import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import { getCachedMeStats } from '@/lib/me-stats';
import { getBunnyName } from '@/lib/onboarding';
import { subscribeConnectionRealtime } from '@/lib/pairing-realtime';
import { fetchSubscriptionTier, getCachedSubscriptionTier } from '@/lib/subscription';
import { supabase } from '@/lib/supabase';
import { useSubscriptionTier } from '@/lib/use-subscription-tier';

type SectionDefinition = {
  title: string;
  icon: typeof ICONS.connect1;
  modules: ConnectionModuleKey[];
  preset: string;
};

const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    title: 'What You May Have Missed',
    icon: ICONS.connect1,
    modules: ['worth_knowing'],
    preset: 'Important moments, changes, and quiet wins worth following up on will appear here.',
  },
  {
    title: 'Their World Lately',
    icon: ICONS.connect2,
    modules: ['recent_vibe', 'what_theyre_into'],
    preset: 'Get a clearer feel for their recent vibe and what’s been capturing their attention.',
  },
  {
    title: 'Ways In',
    icon: ICONS.connect3,
    modules: ['how_to_show_up', 'talk_about', 'try_together'],
    preset: 'Find thoughtful ways to check in, start a conversation, or spend time together.',
  },
  {
    title: 'Between You Lately',
    icon: ICONS.connect4,
    modules: ['shared_rhythm'],
    preset: 'See the funny, cozy, or chaotic little patterns unfolding between your lives.',
  },
];

const TEASER_ROWS = [
  { label: 'Catch what you missed', icon: ICONS.connect1 },
  { label: 'Understand their world lately', icon: ICONS.connect2 },
  { label: 'Find a natural way in', icon: ICONS.connect3 },
  { label: 'See what’s unfolding between you', icon: ICONS.connect4 },
];

function validInsights(value: ConnectionInsights | null): ConnectionInsights | null {
  return value?.schemaVersion === 2 && value.modules ? value : null;
}

function cardsForSection(
  insights: ConnectionInsights | null,
  definition: SectionDefinition,
): ConnectionInsightCard[] {
  if (!insights) return [];
  return definition.modules.flatMap((key) => (
    Array.isArray(insights.modules[key]) ? insights.modules[key] : []
  ));
}

function InsightContentCard({ card }: { card: ConnectionInsightCard }) {
  return (
    <View style={st.insightCard}>
      <View style={st.insightBadge}>
        <Text style={st.insightBadgeText}>{card.label}</Text>
      </View>
      {!!card.headline && <Text style={st.insightHeadline}>{card.headline}</Text>}
      <Text style={st.insightText}>{card.body}</Text>
      {!!card.supportingText && <Text style={st.supportingText}>{card.supportingText}</Text>}
      {!!card.action && (
        <View style={st.actionRow}>
          <MaterialIcons name="chat-bubble-outline" size={18} color="#8C523D" />
          <Text style={st.actionText}>{card.action}</Text>
        </View>
      )}
    </View>
  );
}

export default function ConnectionDashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const narrow = width < 380;
  const cachedResult = getCachedInsights();
  const cachedInsightValue = cachedResult?.ok ? validInsights(cachedResult.insights) : null;
  const cachedPaid = getCachedSubscriptionTier() !== 'free';

  const [pairing, setPairing] = useState<PairingStatus | null>(() => getCachedPairing());
  const [isPaid, setIsPaid] = useState(cachedPaid);
  const [insights, setInsights] = useState<ConnectionInsights | null>(cachedInsightValue);
  const [insightsGate, setInsightsGate] = useState<'ok' | 'plus_required' | null>(() => {
    if (!cachedResult) return null;
    if (cachedResult.ok) return 'ok';
    if (cachedResult.error === 'network') return null;
    if (cachedResult.error === 'plus_required' && cachedPaid) return null;
    return cachedResult.error;
  });
  const [refreshingLatest, setRefreshingLatest] = useState(false);
  const [myName, setMyName] = useState('Me');
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myAvatarUrl, setMyAvatarUrl] = useState('');
  const [myIsDefaultAvatar, setMyIsDefaultAvatar] = useState<boolean | undefined>();
  const liveTier = useSubscriptionTier();
  const refreshInFlight = useRef(false);

  useEffect(() => setIsPaid(liveTier !== 'free'), [liveTier]);

  const refreshInsights = useCallback(async (resume = false): Promise<boolean> => {
    if (refreshInFlight.current) {
      if (resume) setRefreshingLatest(false);
      return false;
    }
    refreshInFlight.current = true;
    if (resume) setRefreshingLatest(true);
    try {
      const result = await fetchInsights({ resume });
      if (result.ok) {
        setInsights(validInsights(result.insights));
        setInsightsGate('ok');
        return result.refreshPending !== true;
      } else if (result.error === 'plus_required') {
        setInsightsGate(result.error);
      }
      return false;
    } finally {
      if (resume) setRefreshingLatest(false);
      refreshInFlight.current = false;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const resumeAfterAbsence = shouldShowConnectionResumeLoading();
      if (resumeAfterAbsence && getCachedPairing()?.paired && cachedPaid) {
        setRefreshingLatest(true);
      }
      const previousPartnerId = getCachedPairing()?.partner?.userId ?? null;
      void (async () => {
        const [{ data }, nextPairing] = await Promise.all([
          supabase.auth.getSession(),
          fetchPairing(),
        ]);
        if (!active) return;
        const uid = data.session?.user?.id;
        let paid = getCachedSubscriptionTier() !== 'free';
        if (uid) {
          try {
            paid = (await fetchSubscriptionTier(uid)).tier !== 'free';
          } catch {
            // Cache remains authoritative while offline.
          }
        }
        if (!active) return;
        setIsPaid(paid);
        setPairing(nextPairing);
        if (!nextPairing.paired) {
          setInsights(null);
          setInsightsGate(null);
          setRefreshingLatest(false);
          return;
        }
        if (!paid) {
          setInsightsGate('plus_required');
          setRefreshingLatest(false);
          return;
        }
        const partnerChanged = previousPartnerId !== nextPairing.partner?.userId;
        if (partnerChanged || resumeAfterAbsence || shouldRefreshConnectionDashboard()) {
          const refreshCompleted = await refreshInsights(resumeAfterAbsence);
          if (!active) return;
          if (refreshCompleted) markConnectionDashboardRefreshed();
        } else {
          setRefreshingLatest(false);
        }
      })().catch(() => {
        if (active) setRefreshingLatest(false);
      });

      void supabase.auth.getSession().then(({ data }) => {
        if (!active) return;
        setMyUserId(data.session?.user?.id ?? null);
        const cached = getCachedMeStats();
        const profileName = cached?.displayName && cached.displayName !== 'user'
          ? cached.displayName : '';
        const name = profileName || getBunnyName()
          || (data.session?.user?.email?.split('@')[0] as string | undefined);
        if (name) setMyName(name);
        setMyAvatarUrl(cached?.avatarUrl ?? '');
        setMyIsDefaultAvatar(cached?.isDefaultAvatar);
      });
      return () => { active = false; };
    }, [cachedPaid, refreshInsights]),
  );

  useEffect(() => subscribeConnectionRealtime(() => {
    if (getCachedSubscriptionTier() !== 'free') {
      void refreshInsights(false).then((completed) => {
        if (completed) markConnectionDashboardRefreshed();
      });
    }
  }), [refreshInsights]);

  const partner = pairing?.partner ?? null;
  const hasAnyContent = SECTION_DEFINITIONS.some((section) => (
    cardsForSection(insights, section).length > 0
  ));

  return (
    <View style={st.root}>
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
          <Text style={[st.subtitle, narrow && { fontSize: 11.5 }]} numberOfLines={2}>
            The little things tell a bigger story.
          </Text>
        </View>
        <OffsetCard
          color="#C96F2A"
          offset={4}
          radius={20}
          disabled={!partner}
          onPress={() => {
            if (!partner) return;
            void haptics.pageOpen();
            router.push('/(main)/their-patterns' as never);
          }}
          cardStyle={st.hubPill}
        >
          <Image source={ICONS.calendar} style={st.hubPillIcon} resizeMode="contain" />
          <Text style={st.hubPillText}>History</Text>
        </OffsetCard>
      </View>

      <View style={{ flex: 1 }}>
        <GridBackground />
        {!pairing || !partner ? (
          <ScrollView contentContainerStyle={st.unpairedScroll} showsVerticalScrollIndicator={false}>
            <View style={st.pairLockCard}>
              <MaterialIcons name="lock" size={58} color="#714329" />
              <Text style={st.pairLockText}>
                Pair with someone now to{`\n`}unlock connection dashboard
              </Text>
              <View style={st.teaserList}>
                {TEASER_ROWS.map((row) => (
                  <View key={row.label} style={st.teaserRow}>
                    <Image source={row.icon} style={st.teaserIcon} resizeMode="contain" />
                    <Text style={st.teaserText}>{row.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
            <View style={st.relCard}>
              <View style={st.relSide}>
                <UserAvatar
                  userId={myUserId}
                  avatarUrl={myAvatarUrl}
                  isDefaultAvatar={myIsDefaultAvatar}
                  size={56}
                />
                <Text style={st.relName} numberOfLines={1}>{myName}</Text>
              </View>
              <View style={st.relMid}>
                <Text style={st.relTitle}>{pairing.relationship || 'Paired'}</Text>
                <Text style={st.relDays}>For {pairing.pairedDays ?? 0} days</Text>
              </View>
              <View style={st.relSide}>
                <UserAvatar
                  userId={partner.userId}
                  avatarUrl={partner.avatarUrl}
                  isDefaultAvatar={partner.isDefaultAvatar}
                  size={56}
                />
                <Text style={st.relName} numberOfLines={1}>{partner.displayName}</Text>
              </View>
            </View>

            {!isPaid || insightsGate === 'plus_required' ? (
              <Pressable
                style={st.plusCard}
                onPress={() => {
                  void haptics.pageOpen();
                  router.push('/(main)/(modals)/subscription-paywall' as never);
                }}
              >
                <MaterialIcons name="lock" size={22} color="#FFFFFF" />
                <View style={{ flex: 1 }}>
                  <Text style={st.plusTitle}>Unlock your Connection details</Text>
                  <Text style={st.plusText}>Join Plus to see thoughtful patterns as they emerge.</Text>
                </View>
                <MaterialIcons name="chevron-right" size={26} color="#FFFFFF" />
              </Pressable>
            ) : !hasAnyContent ? (
              <Text style={st.emptyIntro}>
                These spaces will fill in naturally when their reflections offer enough context.
              </Text>
            ) : null}

            {SECTION_DEFINITIONS.map((section) => {
              const cards = isPaid && insightsGate !== 'plus_required'
                ? cardsForSection(insights, section)
                : [];
              return (
                <View key={section.title}>
                  <View style={st.sectionPillWrap}>
                    <View style={st.sectionPill}>
                      <Text style={st.sectionPillText}>{section.title}</Text>
                    </View>
                  </View>
                  {cards.length > 0 ? cards.map((card, index) => (
                    <InsightContentCard key={`${section.title}-${card.label}-${index}`} card={card} />
                  )) : (
                    <View style={st.presetCard}>
                      <Image source={section.icon} style={st.presetIcon} resizeMode="contain" />
                      <Text style={st.presetText}>{section.preset}</Text>
                    </View>
                  )}
                </View>
              );
            })}
            <View style={{ height: 28 }} />
          </ScrollView>
        )}
      </View>

      {refreshingLatest && pairing?.paired && partner && (
        <View style={st.loadingOverlay} pointerEvents="auto">
          <View style={st.loadingCard}>
            <ActivityIndicator size="large" color="#8C523D" />
            <Text style={st.loadingTitle}>Updating the latest moments...</Text>
            <Text style={st.loadingText}>Looking at their newest reflection for anything worth adding.</Text>
          </View>
        </View>
      )}
      <FeatureGuideModal
        guide="connection"
        enabled={!!pairing?.paired && !!partner && !refreshingLatest}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8D9B8' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#7A4A3A', paddingHorizontal: 18, paddingBottom: 18,
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
  unpairedScroll: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  pairLockCard: {
    backgroundColor: '#FFF6E4', borderRadius: 28, paddingHorizontal: 20,
    paddingVertical: 36, alignItems: 'center', gap: 18,
  },
  pairLockText: {
    fontSize: 18, lineHeight: 25, textAlign: 'center',
    fontFamily: 'Inter_800ExtraBold', color: '#161311',
  },
  teaserList: { width: '100%', gap: 12, marginTop: 8 },
  teaserRow: {
    minHeight: 70, borderRadius: 20, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: '#FFFFFF',
    shadowColor: '#B98964', shadowOpacity: 0.75, shadowRadius: 0, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  teaserIcon: { width: 42, height: 42 },
  teaserText: { flex: 1, fontSize: 16, fontFamily: 'Inter_700Bold', color: '#161311' },
  relCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF6E4',
    borderRadius: 22, padding: 16,
  },
  relSide: { alignItems: 'center', width: 84, gap: 6 },
  relName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#3A2A1A', maxWidth: 84 },
  relMid: { flex: 1, alignItems: 'center', gap: 4 },
  relTitle: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: '#161311', textAlign: 'center' },
  relDays: { fontSize: 13.5, fontFamily: 'Inter_600SemiBold', color: '#8A6240' },
  plusCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#7A4A3A', borderRadius: 22, padding: 17, marginTop: 16,
  },
  plusTitle: { fontSize: 15.5, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  plusText: { fontSize: 12.5, lineHeight: 18, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.9)', marginTop: 3 },
  emptyIntro: {
    fontSize: 16, lineHeight: 23, textAlign: 'center', color: '#5D351D',
    fontFamily: 'Inter_700Bold', paddingHorizontal: 22, marginTop: 28, marginBottom: 2,
  },
  sectionPillWrap: { alignItems: 'center', marginTop: 22, marginBottom: 14 },
  sectionPill: { backgroundColor: '#8C523D', borderRadius: 16, paddingHorizontal: 26, paddingVertical: 11, minWidth: '62%' },
  sectionPillText: { fontSize: 15, textAlign: 'center', fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  presetCard: {
    minHeight: 145, borderRadius: 26, paddingHorizontal: 25, paddingVertical: 18,
    backgroundColor: '#FFF6E4', alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  presetIcon: { width: 48, height: 48 },
  presetText: {
    maxWidth: 330, fontSize: 15.5, lineHeight: 23, textAlign: 'center',
    fontFamily: 'Inter_500Medium', color: '#2A2118',
  },
  insightCard: { backgroundColor: '#FFF6E4', borderRadius: 26, padding: 20, marginBottom: 14 },
  insightBadge: {
    alignSelf: 'flex-start', backgroundColor: '#F8D88B', borderRadius: 13,
    paddingHorizontal: 12, paddingVertical: 7, marginBottom: 14,
  },
  insightBadgeText: { fontSize: 13.5, fontFamily: 'Inter_700Bold', color: '#7A462A' },
  insightHeadline: { fontSize: 18, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', color: '#2A2118', marginBottom: 8 },
  insightText: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_500Medium', color: '#2A2118' },
  supportingText: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_500Medium', color: '#785E49', marginTop: 9 },
  actionRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderTopWidth: 1, borderTopColor: 'rgba(122,74,58,0.16)', marginTop: 14, paddingTop: 13,
  },
  actionText: { flex: 1, fontSize: 14.5, lineHeight: 21, fontFamily: 'Inter_600SemiBold', color: '#5B3B29' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject, zIndex: 50, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(24,16,12,0.55)', paddingHorizontal: 28,
  },
  loadingCard: {
    width: '100%', maxWidth: 360, borderRadius: 28, backgroundColor: '#FFF6E4',
    paddingHorizontal: 28, paddingVertical: 34, alignItems: 'center',
    shadowColor: '#000000', shadowOpacity: 0.28, shadowRadius: 24, shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  loadingTitle: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#4E301D', marginTop: 18, textAlign: 'center' },
  loadingText: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_500Medium', color: '#7B6250', marginTop: 8, textAlign: 'center' },
});

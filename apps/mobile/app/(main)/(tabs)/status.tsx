import { useCallback, useState } from 'react';
import {
  Image, Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { Image as ExpoImage } from 'expo-image';

import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import { ItemSprite } from '@/components/ui/item-sprite';
import {
  fetchCommonItems, fetchInsights, fetchPairing,
  type CommonItem, type ConnectionInsights, type PairingStatus,
} from '@/lib/friends-api';
import { supabase } from '@/lib/supabase';
import { getCachedSubscriptionTier } from '@/lib/subscription';

/**
 * Me tab → Connection Dashboard (2026-07-24 重构, mock 1:1). The old Me page
 * (growth stages, dimension tiles) is fully removed; this tab is about the
 * ONE paired relationship:
 *   板块1  title + subtitle + Memories Hub entry (shared memory box)
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

// Free users see the insight cards with STANDARD placeholder copy behind a
// blur — never the real content (which is not even fetched for free tiers).
const MOCK_INSIGHTS: Record<string, string> = {
  emotion: 'They seemed lighter today — a small win at work put a spring in their step and they kept humming that one song.',
  topic: 'Ask them about the little café they discovered on their walk — they clearly want to tell someone about it.',
  careTips: 'A short voice note tonight would land better than a long text. Keep it warm and easy.',
  boundaries: 'Maybe skip the schedule talk today — it came up twice and felt heavy both times.',
  hangoutIdeas: 'A 20-minute watch-together of that show you both dropped last month. Low effort, high laughs.',
};

function Initial({ name, size = 56 }: { name: string; size?: number }) {
  return (
    <View style={[st.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[st.avatarText, { fontSize: size * 0.42 }]}>
        {(name || '?').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

export default function ConnectionDashboardScreen() {
  const router = useRouter();
  const [pairing, setPairing] = useState<PairingStatus | null>(null);
  const [myName, setMyName] = useState('Me');
  const [items, setItems] = useState<CommonItem[]>([]);
  const [insights, setInsights] = useState<ConnectionInsights | null>(null);
  const [insightsGate, setInsightsGate] = useState<'ok' | 'plus_required' | 'consent_required' | null>(null);
  const [openItem, setOpenItem] = useState<CommonItem | null>(null);
  const isPaid = getCachedSubscriptionTier() !== 'free';

  useFocusEffect(
    useCallback(() => {
      void fetchPairing().then((p) => {
        setPairing(p);
        if (p.paired) {
          void fetchCommonItems().then(setItems);
          void fetchInsights().then((r) => {
            if (r.ok) {
              setInsights(r.insights);
              setInsightsGate('ok');
            } else if (r.error === 'plus_required' || r.error === 'consent_required') {
              setInsightsGate(r.error);
            }
          });
        }
      });
      void supabase.auth.getSession().then(({ data }) => {
        const n = (data.session?.user?.user_metadata?.display_name
          ?? data.session?.user?.email?.split('@')[0]) as string | undefined;
        if (n) setMyName(n);
      });
    }, []),
  );

  async function copySend(text: string) {
    void haptics.light();
    try {
      await Clipboard.setStringAsync(text);
      await Share.share({ message: text });
    } catch {
      // user dismissed the share sheet — the text is on the clipboard anyway
    }
  }

  const partner = pairing?.partner ?? null;
  const insets = useSafeAreaInsets();
  // Narrow-screen type hierarchy (2026-08-08): the title may auto-shrink to
  // fit beside the Memories Hub pill, but only to 80% — and the subtitle
  // steps down with it so the pair never reads the same size.
  const { width: winW } = useWindowDimensions();
  const narrow = winW < 380;

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
            Connection Dashboard
          </Text>
          <Text style={[st.subtitle, narrow && { fontSize: 11.5 }]} numberOfLines={2}>Connecting Through Daily Moments</Text>
        </View>
        {/* Always shown (mock); display-only until a partner exists. */}
        <Pressable
          disabled={!partner}
          onPress={() => {
            if (!partner) return;
            void haptics.light();
            router.push({
              pathname: '/(main)/friend-memories',
              params: { friendUserId: partner.userId, friendName: partner.displayName },
            } as never);
          }}
          style={st.hubPill}
        >
          <Image source={ICONS.friendList} style={{ width: 26, height: 26 }} resizeMode="contain" />
          <Text style={st.hubPillText}>Memories Hub</Text>
        </Pressable>
      </View>

      {!pairing || !partner ? (
        /* Unpaired (mock 2026-08-05): grid ground, cream lock card with the
           six teaser pills previewing what pairing unlocks. */
        <View style={{ flex: 1 }}>
          <ExpoImage
            source={ICONS.obGridBg}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          {/* Display-only until paired: no tap targets anywhere (mock v2). */}
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={st.pairLockCard}>
              <MaterialIcons name="lock" size={56} color="#5D3A1F" />
              <Text style={st.pairLockText}>Pair with someone now to{'\n'}unlock connection dashboard</Text>
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
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          {/* 板块2: the relationship */}
          <View style={st.relCard}>
            <View style={st.relSide}>
              <Initial name={myName} />
              <Text style={st.relName} numberOfLines={1}>{myName}</Text>
            </View>
            <View style={st.relMid}>
              <Text style={st.relTitle}>{pairing.relationship || 'Paired'}</Text>
              <Text style={st.relDays}>For {pairing.pairedDays ?? 0} days</Text>
            </View>
            <View style={st.relSide}>
              <Initial name={partner.displayName} />
              <Text style={st.relName} numberOfLines={1}>{partner.displayName}</Text>
            </View>
          </View>

          {/* 板块3: latest items both reflect */}
          <View style={st.sectionPillWrap}>
            <View style={st.sectionPill}>
              <Text style={st.sectionPillText}>Latest Items Both Reflect</Text>
            </View>
          </View>
          <View style={st.itemsCard}>
            {items.length === 0 ? (
              <Text style={st.itemsEmpty}>
                Nothing in common yet — keep reflecting, the overlap will appear here.
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
              <Text style={st.sectionPillText}>A little bit to know</Text>
            </View>
          </View>

          {!isPaid || insightsGate === 'plus_required' ? (
            /* Free tier: standard placeholder copy behind a blur (the real
               insights are never fetched), one paywall button per card. */
            INSIGHT_SECTIONS.map(({ key, label, emoji }) => (
              <View key={key} style={st.insightCard}>
                <View style={st.insightBadge}>
                  <Text style={st.insightBadgeText}>{emoji} {label}</Text>
                </View>
                <Text style={[st.insightText, st.insightBlurred]}>
                  “{MOCK_INSIGHTS[key] ?? ''}”
                </Text>
                <Pressable
                  onPress={() => { void haptics.light(); router.push('/(main)/(modals)/subscription-paywall' as never); }}
                  style={st.plusBtn}
                >
                  <MaterialIcons name="lock" size={17} color="#FFFFFF" />
                  <Text style={st.copyBtnText}>Join Plus to Access Details</Text>
                </Pressable>
              </View>
            ))
          ) : insightsGate === 'consent_required' ? (
            <View style={st.lockCard}>
              <MaterialIcons name="privacy-tip" size={22} color="#8A5F3F" />
              <Text style={st.lockText}>Turn on AI features in settings to unlock daily guidance.</Text>
            </View>
          ) : insights ? (
            INSIGHT_SECTIONS.map(({ key, label, emoji }) => {
              const text = insights[key];
              if (!text) return null;
              return (
                <View key={key} style={st.insightCard}>
                  <View style={st.insightBadge}>
                    <Text style={st.insightBadgeText}>{emoji} {label}</Text>
                  </View>
                  <Text style={st.insightText}>“{text}”</Text>
                  <Pressable onPress={() => void copySend(text)} style={st.copyBtn}>
                    <MaterialIcons name="content-copy" size={18} color="#FFFFFF" />
                    <Text style={st.copyBtnText}>Copy and Send Message</Text>
                  </Pressable>
                </View>
              );
            })
          ) : (
            <View style={st.lockCard}>
              <MaterialIcons name="hourglass-empty" size={22} color="#8A5F3F" />
              <Text style={st.lockText}>
                {partner.displayName} hasn't reflected yet — these cards fill in
                the moment their first reflect lands.
              </Text>
            </View>
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
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
    backgroundColor: '#F0885C', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10,
  },
  hubPillText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  relCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF6E4',
    borderRadius: 22, padding: 16,
  },
  relSide: { alignItems: 'center', width: 84, gap: 6 },
  avatar: { backgroundColor: '#8A5F3F', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold' },
  relName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#3A2A1A', maxWidth: 84 },
  relMid: { flex: 1, alignItems: 'center', gap: 4 },
  relTitle: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: '#161311', textAlign: 'center' },
  relDays: { fontSize: 13.5, fontFamily: 'Inter_600SemiBold', color: '#8A6240' },

  sectionPillWrap: { alignItems: 'center', marginTop: 18, marginBottom: 12 },
  sectionPill: { backgroundColor: '#7A4A3A', borderRadius: 18, paddingHorizontal: 20, paddingVertical: 11 },
  sectionPillText: { fontSize: 15.5, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  itemsCard: { backgroundColor: '#FFF6E4', borderRadius: 22, padding: 16 },
  itemsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  itemsEmpty: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#8A6240', textAlign: 'center', lineHeight: 21 },

  lockCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF6E4', borderRadius: 22, padding: 18, marginBottom: 14,
  },
  lockText: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#5A4432', lineHeight: 21 },

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
    marginHorizontal: 18, marginTop: 20, borderRadius: 32,
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
  insightBlurred: {
    color: 'transparent',
    textShadowColor: 'rgba(42,33,24,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 7,
  },
  plusBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#8A6240', borderRadius: 16, paddingVertical: 14,
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

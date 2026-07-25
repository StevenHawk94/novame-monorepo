import { useCallback, useState } from 'react';
import {
  Image, Pressable, ScrollView, Share, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

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
      await Share.share({ message: text });
    } catch {
      // user dismissed the share sheet — nothing to do
    }
  }

  const partner = pairing?.partner ?? null;

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      {/* 板块1: header */}
      <View style={st.header}>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>Connection Dashboard</Text>
          <Text style={st.subtitle}>Connecting Through Daily Moments</Text>
        </View>
        <Pressable
          onPress={() => {
            void haptics.light();
            if (partner) {
              router.push({
                pathname: '/(main)/friend-memories',
                params: { friendUserId: partner.userId, friendName: partner.displayName },
              } as never);
            } else {
              router.push('/(main)/friend-add' as never);
            }
          }}
          style={st.hubPill}
        >
          <Image source={ICONS.sharedMemories} style={{ width: 22, height: 22 }} resizeMode="contain" />
          <Text style={st.hubPillText}>Memories Hub</Text>
        </Pressable>
      </View>

      {!pairing || !partner ? (
        <View style={st.emptyWrap}>
          <Text style={st.emptyTitle}>No one paired yet</Text>
          <Text style={st.emptyBody}>
            Pair with someone you care and love — this page becomes your window into their days.
          </Text>
          <Pressable
            onPress={() => { void haptics.medium(); router.push('/(main)/friend-add' as never); }}
            style={st.pairBtn}
          >
            <MaterialIcons name="add-circle" size={22} color="#2E7A3E" />
            <Text style={st.pairBtnText}>Pair Friend</Text>
          </Pressable>
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
            <Pressable
              onPress={() => { void haptics.light(); router.push('/(main)/(modals)/subscription-paywall' as never); }}
              style={st.lockCard}
            >
              <MaterialIcons name="lock" size={22} color="#8A5F3F" />
              <Text style={st.lockText}>
                Daily Emotion, Topics, Care Tips, Boundaries and Hangout Ideas about{' '}
                {partner.displayName} come with NovaMe Plus.
              </Text>
            </Pressable>
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
                Nothing to read yet today — guidance appears once {partner.displayName} reflects.
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
    </SafeAreaView>
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

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 36 },
  emptyTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#4A3423' },
  emptyBody: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#7A5A42', textAlign: 'center', lineHeight: 22 },
  pairBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF',
    borderRadius: 26, paddingHorizontal: 22, paddingVertical: 14, marginTop: 6,
  },
  pairBtnText: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#161311' },

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

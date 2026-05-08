/**
 * Cards selection modal — Stage 5.AIR.2
 *
 * Entry: order-detail Continue Card Selection button (when order
 * status === 'pending_selection'). Receives ?orderId= in route
 * params and is responsible for letting the user pick exactly 48
 * wisdom_cards from their collection to compose the printed deck.
 *
 * Design decision (a): the 48-count constraint is on TOTAL CARDS,
 * not on distinct keywords. A user with 50 wisdom_cards across 12
 * keywords can pick any 48 — including multiple from the same
 * keyword. This is the more forgiving UX path: a user does not need
 * to have collected all 48 keywords before they can use this
 * feature.
 *
 * Data source: fetchWisdoms returns the user's wisdoms with the
 * generated wisdom_card joined in. We filter to wisdoms that have
 * a card and group by card.keyword_id for tab navigation. No new
 * server endpoint needed.
 *
 * Submit: PATCH /api/orders { orderId, status: 'paid',
 * selectedCardIds: [48 ids] }. The server validates status
 * transitions; once status='paid' the selection is locked in (any
 * further PATCH requests would be rejected by status validation in
 * a future hardening pass — for now the protection is that the
 * modal only opens when status='pending_selection').
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { ALL_KEYWORD_SLUGS, slugToId, idToSlug } from '@novame/core';
import { supabase } from '@/lib/supabase';
import { fetchWisdoms, type WisdomCardEmbed } from '@/lib/wisdoms-api';
import { updateOrder } from '@/lib/orders-api';

const REQUIRED_COUNT = 48;

type CardItem = WisdomCardEmbed & {
  // Always non-null after grouping (we filter wisdoms that lack a card).
  id: string;
  keyword_id: string | null;
};

export default function CardsSelectModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ orderId?: string }>();
  const orderId = params.orderId;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [allCards, setAllCards] = useState<CardItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeKeywordSlug, setActiveKeywordSlug] = useState<string | null>(
    null,
  );

  // ---- Load all of user's wisdom_cards ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const userId = sess.session?.user?.id;
        if (!userId) {
          if (!cancelled) setLoading(false);
          return;
        }
        // 200 covers a heavy-user case (a typical user with 48
        // keyword unlock has ~50-150 wisdoms). If we ever exceed
        // this we add a paging UI; not worth the complexity yet.
        const res = await fetchWisdoms(userId, { limit: 200, offset: 0 });
        if (cancelled) return;
        const cards: CardItem[] = (res.wisdoms || [])
          .map((w) => w.card)
          .filter((c): c is WisdomCardEmbed => !!c && !!c.id) as CardItem[];
        setAllCards(cards);
        // Default-select the first keyword that actually has cards
        const firstWithCards = ALL_KEYWORD_SLUGS.find((slug) => {
          const id = slugToId(slug);
          return cards.some((c) => c.keyword_id === id);
        });
        if (firstWithCards) setActiveKeywordSlug(firstWithCards);
      } catch (e) {
        console.warn('[cards-select] fetch failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Group cards by keyword_id for tab content ----
  const cardsByKeywordId = useMemo(() => {
    const map = new Map<string, CardItem[]>();
    for (const card of allCards) {
      const kid = card.keyword_id ?? '__none__';
      const list = map.get(kid) ?? [];
      list.push(card);
      map.set(kid, list);
    }
    return map;
  }, [allCards]);

  // ---- Build a deduped, ordered list of (slug, count) for the tab bar ----
  const keywordTabs = useMemo(() => {
    return ALL_KEYWORD_SLUGS.map((slug) => {
      const id = slugToId(slug);
      const list = id ? cardsByKeywordId.get(id) ?? [] : [];
      return { slug, id, count: list.length };
    });
  }, [cardsByKeywordId]);

  const activeCards = useMemo(() => {
    if (!activeKeywordSlug) return [];
    const id = slugToId(activeKeywordSlug);
    if (!id) return [];
    return cardsByKeywordId.get(id) ?? [];
  }, [activeKeywordSlug, cardsByKeywordId]);

  const toggleSelection = (cardId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        if (next.size >= REQUIRED_COUNT) {
          Alert.alert(
            'Limit reached',
            `Your deck holds exactly ${REQUIRED_COUNT} cards. Tap a selected card to swap it.`,
          );
          return prev;
        }
        next.add(cardId);
      }
      return next;
    });
  };

  const onSubmit = async () => {
    if (!orderId) {
      Alert.alert('Error', 'Order context lost. Please go back and try again.');
      return;
    }
    if (selectedIds.size !== REQUIRED_COUNT) {
      Alert.alert(
        'Pick more cards',
        `You have selected ${selectedIds.size} cards. Choose ${REQUIRED_COUNT - selectedIds.size} more to complete your deck.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      await updateOrder({
        orderId,
        status: 'paid',
        selectedCardIds: Array.from(selectedIds),
      });
      // Success -> back out to order-detail, which will re-fetch
      // the order on focus (see order-detail useEffect).
      Alert.alert(
        'Deck complete',
        'Your 48 cards are locked in. We will print and ship within a few business days.',
        [
          {
            text: 'OK',
            onPress: () => {
              if (router.canGoBack()) router.back();
            },
          },
        ],
      );
    } catch (e) {
      console.error('[cards-select] submit failed:', e);
      Alert.alert(
        'Submit failed',
        e instanceof Error ? e.message : 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const goBack = () => {
    if (selectedIds.size > 0) {
      Alert.alert(
        'Discard selection?',
        'Your card picks will not be saved. You can come back and try again later.',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              if (router.canGoBack()) router.back();
            },
          },
        ],
      );
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/assets');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Pick Your Deck</Text>
          <Text style={styles.headerSub}>
            {selectedIds.size} / {REQUIRED_COUNT} selected
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#A855F7" />
        </View>
      ) : allCards.length === 0 ? (
        <View style={styles.empty}>
          <MaterialIcons
            name="auto-awesome"
            size={42}
            color="rgba(255,255,255,0.35)"
          />
          <Text style={styles.emptyTitle}>No wisdom cards yet</Text>
          <Text style={styles.emptyBody}>
            Share a wisdom from the Record tab and a card will appear in
            your collection. Come back here once you have at least
            {' ' + REQUIRED_COUNT} cards.
          </Text>
        </View>
      ) : (
        <>
          {/* Keyword tab strip */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabStrip}
          >
            {keywordTabs.map(({ slug, count }) => {
              const isActive = slug === activeKeywordSlug;
              const isLocked = count === 0;
              return (
                <Pressable
                  key={slug}
                  onPress={() => {
                    if (isLocked) return;
                    setActiveKeywordSlug(slug);
                  }}
                  disabled={isLocked}
                  style={({ pressed }) => [
                    styles.tab,
                    isActive && styles.tabActive,
                    isLocked && styles.tabLocked,
                    pressed && !isLocked && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      isActive && styles.tabTextActive,
                      isLocked && styles.tabTextLocked,
                    ]}
                  >
                    {slug}
                  </Text>
                  {!isLocked ? (
                    <View
                      style={[
                        styles.tabCountWrap,
                        isActive && styles.tabCountWrapActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.tabCount,
                          isActive && styles.tabCountActive,
                        ]}
                      >
                        {count}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Card grid for the active tab */}
          <FlatList
            data={activeCards}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
            contentContainerStyle={{
              paddingTop: 12,
              paddingBottom: 120 + insets.bottom,
              gap: 12,
            }}
            ListEmptyComponent={
              <View style={styles.tabEmpty}>
                <Text style={styles.tabEmptyText}>
                  No cards under this keyword yet.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelected = selectedIds.has(item.id);
              return (
                <Pressable
                  onPress={() => toggleSelection(item.id)}
                  style={({ pressed }) => [
                    styles.cardCell,
                    isSelected && styles.cardCellSelected,
                    pressed && { opacity: 0.92 },
                  ]}
                >
                  <View style={styles.cardCellHeader}>
                    <Text style={styles.cardCellKw} numberOfLines={1}>
                      {item.keyword_id
                        ? idToSlug(item.keyword_id) ?? 'Wisdom'
                        : 'Wisdom'}
                    </Text>
                    {isSelected ? (
                      <View style={styles.checkBadge}>
                        <MaterialIcons
                          name="check"
                          size={14}
                          color="#FFFFFF"
                        />
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.cardCellQuote} numberOfLines={4}>
                    {item.quote_short ||
                      item.insight_full?.slice(0, 100) ||
                      '...'}
                  </Text>
                  {item.wisdom_score ? (
                    <View style={styles.cardCellFooter}>
                      <MaterialIcons
                        name="star"
                        size={12}
                        color="#FBBF24"
                      />
                      <Text style={styles.cardCellScore}>
                        {item.wisdom_score}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            }}
          />

          {/* Submit footer */}
          <View
            style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}
          >
            <Pressable
              onPress={onSubmit}
              disabled={
                submitting ||
                selectedIds.size !== REQUIRED_COUNT
              }
              style={({ pressed }) => [
                styles.cta,
                (submitting || selectedIds.size !== REQUIRED_COUNT) && {
                  opacity: 0.5,
                },
                pressed &&
                  !submitting &&
                  selectedIds.size === REQUIRED_COUNT && { opacity: 0.85 },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.ctaText}>
                  {selectedIds.size === REQUIRED_COUNT
                    ? 'Submit Deck'
                    : `Pick ${REQUIRED_COUNT - selectedIds.size} more`}
                </Text>
              )}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F0B2E' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  headerSub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  emptyBody: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  tabStrip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tabActive: {
    backgroundColor: 'rgba(168,85,247,0.18)',
    borderColor: 'rgba(168,85,247,0.4)',
  },
  tabLocked: { opacity: 0.35 },
  tabText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  tabTextActive: { color: '#C084FC' },
  tabTextLocked: { color: 'rgba(255,255,255,0.4)' },
  tabCountWrap: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  tabCountWrapActive: { backgroundColor: 'rgba(168,85,247,0.3)' },
  tabCount: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    fontWeight: '800',
  },
  tabCountActive: { color: '#C084FC' },
  cardCell: {
    flex: 1,
    minHeight: 140,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cardCellSelected: {
    borderColor: '#A855F7',
    backgroundColor: 'rgba(168,85,247,0.1)',
  },
  cardCellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardCellKw: {
    flex: 1,
    color: '#C084FC',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'capitalize',
  },
  checkBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A855F7',
  },
  cardCellQuote: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    flex: 1,
  },
  cardCellFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  cardCellScore: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '700',
  },
  tabEmpty: {
    paddingHorizontal: 32,
    paddingVertical: 32,
    alignItems: 'center',
  },
  tabEmptyText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(15,11,46,0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  cta: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: '#A855F7',
  },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});

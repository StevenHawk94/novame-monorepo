/**
 * Cards selection modal — Stage 5.AIR.2 (UI v2 with bugfix.A)
 *
 * Entry: order-detail Continue Card Selection button (when order
 * status === 'pending_selection'). Receives ?orderId= and lets the
 * user pick exactly 48 wisdom_cards from their collection to compose
 * the printed deck.
 *
 * Design decision (a): the 48-count constraint is on TOTAL CARDS,
 * not on distinct keywords. A user with 50 wisdom_cards across 12
 * keywords can pick any 48 — including multiple from the same
 * keyword.
 *
 * UI v2 changes from initial 5.AIR.2 (per testing feedback):
 *   1. Keyword tab strip is now a fixed-rectangle button per keyword
 *      (80x96), each containing the keyword's front-art thumbnail +
 *      name + count badge. Matches the visual language of the
 *      Collection grid so users recognize cards at a glance.
 *      Locked tabs (no cards yet) are dimmed with a lock overlay.
 *   2. Long-press a card cell to open a preview modal with the full
 *      FlippableCard (front-art + insight). Preview includes
 *      Add/Remove deck buttons so the user can decide after seeing
 *      both sides. Single-tap on the cell still does the immediate
 *      add/remove (faster path for users who recognize quotes).
 *
 * Data source: fetchWisdoms(userId, limit=200). Filters wisdoms with
 * a card joined and groups by card.keyword_id. No new server
 * endpoint needed.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';

import { ALL_KEYWORD_SLUGS, slugToId, idToSlug } from '@novame/core';
import { supabase } from '@/lib/supabase';
import { fetchWisdoms, type WisdomCardEmbed } from '@/lib/wisdoms-api';
import { updateOrder } from '@/lib/orders-api';
import { getCachedAssetUri } from '@/lib/asset-cache';
import { FlippableCard } from '@/components/cards/FlippableCard';
import { getStandardCardWidth } from '@/lib/card-dimensions';
import { haptics } from '@/lib/haptics';

const REQUIRED_COUNT = 48;
// Stage 5.AIR.2.bugfix.B: R2 cards live at the bucket root, NOT in a
// /cards/ subdirectory. The bucket path is just /{filename}.webp.
// (collection-view.tsx had the same wrong /cards/ prefix in its
// fallback path but it never showed because by the time users
// reach Collection their assets are already in MMKV cache and the
// fallback branch is dead code. cards-select hits the fallback on
// first paint because tab thumbnails request keyword art the user
// may not have viewed before.)
const CARD_FALLBACK_URL = (filename: string) =>
  `https://media.novameapp.com/${filename}`;

type CardItem = WisdomCardEmbed & {
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
  const [previewCard, setPreviewCard] = useState<CardItem | null>(null);

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
        const res = await fetchWisdoms(userId, { limit: 200, offset: 0 });
        if (cancelled) return;
        const cards: CardItem[] = (res.wisdoms || [])
          .map((w) => w.card)
          .filter((c): c is WisdomCardEmbed => !!c && !!c.id) as CardItem[];
        setAllCards(cards);
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

  // ---- Group cards by keyword_id ----
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
    void haptics.light();
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
    void haptics.light();
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
          {/* Keyword tab strip — fixed-rectangle buttons with thumbnail + name + count */}
          <View style={styles.tabStripWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabStrip}
            >
              {keywordTabs.map(({ slug, count }) => (
                <KeywordTab
                  key={slug}
                  slug={slug}
                  count={count}
                  isActive={slug === activeKeywordSlug}
                  isLocked={count === 0}
                  onPress={() => setActiveKeywordSlug(slug)}
                />
              ))}
            </ScrollView>
          </View>

          {/* Hint banner — shown when 0 selected */}
          {selectedIds.size === 0 ? (
            <View style={styles.hintBanner}>
              <MaterialIcons
                name="touch-app"
                size={14}
                color="rgba(192,132,252,0.85)"
              />
              <Text style={styles.hintBannerText}>
                Tap to add. Long-press to preview both sides.
              </Text>
            </View>
          ) : null}

          {/* Card grid for the active tab */}
          <FlatList
            data={activeCards}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
            contentContainerStyle={{
              paddingTop: 8,
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
                  onPress={() => { void haptics.light(); toggleSelection(item.id); }}
                  onLongPress={() => setPreviewCard(item)}
                  delayLongPress={250}
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
                  {/* Stage 6: wisdom_score UI removed. The score is no
                      longer rendered anywhere -- it has been deleted
                      from the AI prompt + DB insert (lib/generate-card.js).
                      Legacy wisdoms still have a wisdom_score column
                      value but the app no longer surfaces it. */}
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

          {/* Long-press preview modal */}
          <PreviewModal
            card={previewCard}
            isSelected={previewCard ? selectedIds.has(previewCard.id) : false}
            onClose={() => setPreviewCard(null)}
            onToggle={() => {
              if (previewCard) toggleSelection(previewCard.id);
            }}
          />
        </>
      )}
    </View>
  );
}

// ---- Keyword tab (fixed-rectangle button with art thumbnail) ----

function KeywordTab({
  slug,
  count,
  isActive,
  isLocked,
  onPress,
}: {
  slug: string;
  count: number;
  isActive: boolean;
  isLocked: boolean;
  onPress: () => void;
}) {
  // Stage 5.AIR.2.bugfix.C: R2 stores keyword art under the keyword
  // ID (e.g. 'mind-clarity-front.webp'), NOT the slug
  // ('Clarity-front.webp' -- which 404s). Convert via slugToId.
  // (collection-view.tsx has the same bug in its fallback branch
  // but never hits it because by the time users reach Collection
  // the asset-cache has already downloaded the file under its
  // real ID-based filename, so the cache hit short-circuits the
  // wrong fallback URL. cards-select hits the fallback fresh on
  // first visit.)
  const id = slugToId(slug);
  const filename = id ? `${id}-front.webp` : null;
  const cached = filename ? getCachedAssetUri(filename) : null;
  const src = filename
    ? cached
      ? { uri: cached }
      : { uri: CARD_FALLBACK_URL(filename) }
    : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={isLocked}
      style={({ pressed }) => [
        tabStyles.tile,
        isActive && tabStyles.tileActive,
        isLocked && tabStyles.tileLocked,
        pressed && !isLocked && { opacity: 0.85 },
      ]}
    >
      <View style={tabStyles.imgWrap}>
        {src ? (
          <Image
            source={src}
            style={[
              tabStyles.img,
              isLocked && { opacity: 0.3 },
            ]}
            contentFit="contain"
          />
        ) : null}
        {isLocked ? (
          <View style={tabStyles.lockOverlay}>
            <MaterialIcons
              name="lock"
              size={14}
              color="rgba(255,255,255,0.55)"
            />
          </View>
        ) : null}
        {!isLocked && count > 0 ? (
          <View
            style={[
              tabStyles.countBadge,
              isActive && tabStyles.countBadgeActive,
            ]}
          >
            <Text style={tabStyles.countText}>{count}</Text>
          </View>
        ) : null}
      </View>
      <Text
        style={[
          tabStyles.label,
          isActive && tabStyles.labelActive,
          isLocked && tabStyles.labelLocked,
        ]}
        numberOfLines={1}
      >
        {slug}
      </Text>
    </Pressable>
  );
}

// ---- Long-press preview modal with FlippableCard + add/remove ----

function PreviewModal({
  card,
  isSelected,
  onClose,
  onToggle,
}: {
  card: CardItem | null;
  isSelected: boolean;
  onClose: () => void;
  onToggle: () => void;
}) {
  const insets = useSafeAreaInsets();

  if (!card) return null;

  const kwId = card.keyword_id ?? 'mind-clarity';
  const category = kwId.split('-')[0] || 'mind';
  const frontFilename = `${kwId}-front.webp`;
  const backFilename = `${category}-back.webp`;

  // Card width: leave 32px margin each side, cap at 320 so big-screen
  // phones don't blow up the card disproportionately.
  const screenWidth = Dimensions.get('window').width;
  const cardWidth = getStandardCardWidth(screenWidth);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={previewStyles.backdrop} onPress={onClose}>
        {/* Inner pressable absorbs taps so backdrop only catches outside-card taps. */}
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            previewStyles.sheet,
            {
              paddingTop: insets.top + 24,
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={previewStyles.closeBtn}
          >
            <MaterialIcons name="close" size={22} color="#FFFFFF" />
          </Pressable>

          <Text style={previewStyles.title}>
            {idToSlug(kwId) ?? 'Wisdom'}
          </Text>
          <Text style={previewStyles.subtitle}>
            Tap card to flip. Long-press hint: both sides.
          </Text>

          <View style={previewStyles.cardWrap}>
            <FlippableCard
              frontFilename={frontFilename}
              backFilename={backFilename}
              quoteShort={card.quote_short ?? ''}
              insightFull={card.insight_full ?? ''}
              width={cardWidth}
            />
          </View>

          <Pressable
            onPress={() => {
              void haptics.light();
              onToggle();
              onClose();
            }}
            style={({ pressed }) => [
              previewStyles.actionBtn,
              isSelected
                ? previewStyles.actionBtnRemove
                : previewStyles.actionBtnAdd,
              pressed && { opacity: 0.85 },
            ]}
          >
            <MaterialIcons
              name={isSelected ? 'remove-circle-outline' : 'add-circle-outline'}
              size={18}
              color="#FFFFFF"
            />
            <Text style={previewStyles.actionBtnText}>
              {isSelected ? 'Remove from Deck' : 'Add to Deck'}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---- Styles: main layout ----

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
  emptyTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  emptyBody: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  tabStripWrap: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  tabStrip: {
    paddingHorizontal: 16,
    gap: 10,
  },
  hintBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(168,85,247,0.06)',
  },
  hintBannerText: {
    color: 'rgba(192,132,252,0.85)',
    fontSize: 12,
    fontWeight: '600',
  },
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
  tabEmptyText: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
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

// ---- Styles: keyword tab tile ----

const tabStyles = StyleSheet.create({
  tile: {
    width: 76,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  tileActive: {
    backgroundColor: 'rgba(168,85,247,0.18)',
    borderColor: 'rgba(168,85,247,0.5)',
  },
  tileLocked: { opacity: 0.4 },
  imgWrap: {
    width: 64,
    aspectRatio: 1024 / 1536, // 2:3 keyword card ratio
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  img: { width: '100%', height: '100%' },
  lockOverlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderWidth: 1.5,
    borderColor: '#A855F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeActive: { backgroundColor: '#A855F7', borderColor: '#FFFFFF' },
  countText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  label: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'capitalize',
    textAlign: 'center',
  },
  labelActive: { color: '#C084FC' },
  labelLocked: { color: 'rgba(255,255,255,0.4)' },
});

// ---- Styles: long-press preview modal ----

const previewStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1A1640',
    borderRadius: 22,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    zIndex: 10,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    textTransform: 'capitalize',
    marginBottom: 4,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginBottom: 20,
  },
  cardWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    width: '100%',
  },
  actionBtnAdd: { backgroundColor: '#A855F7' },
  actionBtnRemove: { backgroundColor: 'rgba(239,68,68,0.85)' },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});

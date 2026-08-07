/**
 * "How It Works" walkthrough (mock 2026-08-07, 3 screens over the Friends
 * page, tab bar stays visible):
 *   1. the paired feed — sample rows with VARIED item counts that rotate
 *      daily; header (avatar + name + time) on top, tiles span the full
 *      card width (as many per line as fit), 2 lines max, and an
 *      overflowing row ends in a "+N" tile that opens the details screen
 *   2. detail bubbles — icon + vivid text
 *   3. insights teaser — the six Connection pills
 * Next / Next / Done. Pure display; all data is local sample content.
 */
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import { ItemSprite } from '@/components/ui/item-sprite';

const TILE = 40;
const TILE_GAP = 6;

// Pool of meaningful, style-diverse sample moments (all ids exist in the v3
// catalog). Rows slice this pool with different lengths so the sheet shows
// short days and packed days side by side.
const POOL = [
  'nature_weather.sunset', 'nature_weather.beach', 'food_drink.ramen', 'actions_activities.movie',
  'food_drink.cake', 'plants.wildflower', 'animals.cat', 'musical_instruments.guitar',
  'food_drink.coffee', 'stationery_office.book', 'actions_activities.camping', 'nature_weather.rainbow',
  'food_drink.ice_cream', 'actions_activities.picnic', 'animals.dog', 'actions_activities.baking',
  'food_drink.sushi', 'actions_activities.hiking', 'emotions_expressions.happy', 'actions_activities.swimming',
  'food_drink.pizza',
];

const ROW_META = [
  { label: '5m ago', unread: true },
  { label: '3h ago', unread: false },
  { label: '8h ago', unread: false },
  { label: '1d ago', unread: false },
  { label: '2d ago', unread: false },
];

// Varied sizes: a packed day (overflows into +N), medium days, quiet days.
const ROW_SIZES = [16, 7, 4, 2, 3];

const DETAILS: { itemId: string; text: string }[] = [
  { itemId: 'food_drink.ramen', text: 'Late-night ramen run! Wish you were here to steal my egg like always.' },
  { itemId: 'actions_activities.movie', text: 'Then we watched a silly rom-com. You would have hated it. I loved it.' },
  { itemId: 'nature_weather.sunset', text: 'The sky went full peach tonight. Took a mental photo for you.' },
];

const TEASERS = [
  { label: 'Vibe Matching Moments', icon: ICONS.vibeMatching },
  { label: 'Emotion Status', icon: ICONS.emotionStatus },
  { label: 'Care Tips', icon: ICONS.careTips },
  { label: 'Topics Ideas', icon: ICONS.topicIdeas },
  { label: 'Boundaries', icon: ICONS.boundary },
  { label: 'Hangout Ideas', icon: ICONS.hangout },
];

function dayOfYear(): number {
  const now = new Date();
  return Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
}

export function HowItWorksOverlay({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const { width } = useWindowDimensions();

  // Tiles span the full card width (mock 2): screen − overlay margins (16×2)
  // − card padding (18×2) − row padding (12×2). As many per line as fit.
  const tilesWidth = width - 32 - 36 - 24;
  const perLine = Math.max(4, Math.floor((tilesWidth + TILE_GAP) / (TILE + TILE_GAP)));
  const maxShown = perLine * 2; // 2 lines max

  // Daily rotation: the pool offset shifts with the date, so the sample
  // rows read differently every day.
  const rows = useMemo(() => {
    const offset = dayOfYear();
    let cursor = offset;
    return ROW_SIZES.map((size, i) => {
      const items = Array.from({ length: size }, (_, k) => POOL[(cursor + k) % POOL.length]);
      cursor += size + 1;
      return { ...ROW_META[i], items, key: `row-${i}` };
    });
  }, []);

  function next() {
    void haptics.light();
    if (step >= 2) onClose();
    else setStep(step + 1);
  }

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <View style={styles.card}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {step === 0 && (
            <>
              <Text style={styles.title}>Check your paired&apos;s memories items from their daily reflection.</Text>
              {rows.map((row) => {
                const overflow = row.items.length > maxShown;
                const shown = overflow ? row.items.slice(0, maxShown - 1) : row.items;
                const rest = row.items.length - shown.length;
                return (
                  <Pressable key={row.key} style={styles.feedRow} onPress={next}>
                    <View style={styles.rowHeader}>
                      <View style={styles.avatar}><Text style={styles.avatarEmoji}>{'🐰'}</Text></View>
                      <Text style={styles.feedName}>Mom</Text>
                      <View style={styles.timeCol}>
                        <Text style={styles.timeText}>{row.label}</Text>
                        {row.unread && <View style={styles.unreadDot} />}
                      </View>
                    </View>
                    <View style={styles.tileWrap}>
                      {shown.map((id, k) => (
                        <ItemSprite key={`${row.key}-${k}`} itemId={id} size={TILE} radius={10} />
                      ))}
                      {overflow && (
                        <View style={styles.moreTile}>
                          <Text style={styles.moreTileText}>+{rest}</Text>
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </>
          )}

          {step === 1 && (
            <>
              <Text style={styles.title}>Understand their Life Moment with Vivid Details</Text>
              {DETAILS.map((d) => (
                <View key={d.text} style={styles.detailCard}>
                  <View style={styles.detailIconBox}>
                    <ItemSprite itemId={d.itemId} size={54} radius={12} />
                  </View>
                  <Text style={styles.detailText}>{d.text}</Text>
                </View>
              ))}
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.title}>Discover details that you usually overlook.</Text>
              <View style={styles.teaserGrid}>
                {TEASERS.map((t) => (
                  <View key={t.label} style={styles.teaserPill}>
                    <Image source={t.icon} style={styles.teaserIcon} resizeMode="contain" />
                    <Text style={styles.teaserText} numberOfLines={2}>{t.label}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>

        <Pressable onPress={next} style={({ pressed }) => [styles.nextBtn, pressed && { opacity: 0.85 }]}>
          <Text style={styles.nextText}>{step === 2 ? 'Done' : 'Next'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(42,33,24,0.35)',
    paddingHorizontal: 16,
    paddingTop: 90,
    paddingBottom: 16,
  },
  card: {
    flex: 1,
    backgroundColor: '#FBF3DF',
    borderRadius: 30,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 16,
  },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 16 },
  title: {
    fontSize: 24, lineHeight: 33, fontFamily: 'Inter_800ExtraBold', color: '#5A3A1B',
    textAlign: 'center', marginBottom: 24, paddingHorizontal: 4,
  },

  feedRow: {
    backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 12, paddingHorizontal: 12,
    marginBottom: 12, gap: 10,
    shadowColor: '#C9A97C', shadowOpacity: 0.6, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F4F1F8', alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 23 },
  feedName: { flex: 1, fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  tileWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP,
    justifyContent: 'flex-start',
  },
  moreTile: {
    width: TILE, height: TILE, borderRadius: 10, backgroundColor: '#EFE6D2',
    alignItems: 'center', justifyContent: 'center',
  },
  moreTileText: { fontSize: 13, fontFamily: 'Inter_800ExtraBold', color: '#6B4A2F' },
  timeCol: { alignItems: 'flex-end', gap: 5 },
  timeText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#9A8A76' },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#E5484D' },

  detailCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1.5, borderColor: '#E4D2B4',
    padding: 14, marginBottom: 14,
  },
  detailIconBox: { borderRadius: 12 },
  detailText: { flex: 1, fontSize: 15.5, lineHeight: 23, fontFamily: 'Inter_500Medium', color: '#2B2B2B' },

  teaserGrid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    columnGap: 10, rowGap: 14, marginTop: 6,
  },
  teaserPill: {
    width: '47%', backgroundColor: '#FFFFFF', borderRadius: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 13, paddingHorizontal: 11, minHeight: 60,
    shadowColor: '#C9A97C', shadowOpacity: 0.7, shadowRadius: 0, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  teaserIcon: { width: 28, height: 28 },
  teaserText: { flex: 1, fontSize: 13.5, fontFamily: 'Inter_700Bold', color: '#161311' },

  nextBtn: {
    alignSelf: 'center', backgroundColor: '#7A4A32', borderRadius: 26,
    paddingVertical: 15, paddingHorizontal: 64,
  },
  nextText: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
});

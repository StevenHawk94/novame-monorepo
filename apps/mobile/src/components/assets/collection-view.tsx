/**
 * Collection sub-tab — Stage 3.9.B.1
 *
 * 48-keyword achievement grid. Reuses the user-wisdoms feed (already
 * fetched for Growth > My Logs in 3.9.A.2.4) to compute per-keyword
 * counts: own published cards only — saved-from-others are NOT
 * counted here, matching the "Your Achievement" framing.
 *
 * Visual:
 *   - Purple gradient banner at top
 *   - X/48 Collected statistic
 *   - 4 category sections (Mind / Heart / Action / Connection),
 *     each a 4-column grid of 12 keywords
 *   - Collected keywords show the front art with an x{N} count
 *     badge in the corresponding category color
 *   - Uncollected keywords are greyed out with a lock overlay
 *
 * Tap a collected keyword → opens the keyword-detail modal route
 * (3.9.B.2) which renders a FlippableCard carousel of the user's
 * cards in that keyword.
 */
import { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';

import { slugToId } from '@novame/core';
import { getCachedAssetUri } from '@/lib/asset-cache';
import type { AssetsTabSharedState } from '@/lib/assets-tab-shared';

type Category = {
  id: 'mind' | 'heart' | 'action' | 'connection';
  label: string;
  color: string;
  keywords: string[];
};

const CATEGORIES: Category[] = [
  {
    id: 'mind',
    label: 'The Mind',
    color: '#60A5FA',
    keywords: [
      'Clarity', 'Grounding', 'Focus', 'Curiosity',
      'Stillness', 'Objectivity', 'Adaptability', 'Unlearning',
      'Vision', 'Acceptance', 'Humor', 'Intuition',
    ],
  },
  {
    id: 'heart',
    label: 'The Heart',
    color: '#F472B6',
    keywords: [
      'Resilience', 'Boundaries', 'Self-Compassion', 'Courage',
      'Vulnerability', 'Empathy', 'Gratitude', 'Patience',
      'Forgiveness', 'Release', 'Balance', 'Joy',
    ],
  },
  {
    id: 'action',
    label: 'The Action',
    color: '#FBBF24',
    keywords: [
      'Initiative', 'Consistency', 'Discipline', 'Decisiveness',
      'Purpose', 'Rest', 'Resourcefulness', 'Accountability',
      'Boldness', 'Endurance', 'Communication', 'Momentum',
    ],
  },
  {
    id: 'connection',
    label: 'The Connection',
    color: '#34D399',
    keywords: [
      'Sovereignty', 'Authenticity', 'Inspiration', 'Generosity',
      'Trust', 'Reciprocity', 'Collaboration', 'Leadership',
      'Harmony', 'Legacy', 'Respect', 'Loyalty',
    ],
  },
];

function kwToSlug(catId: string, keyword: string): string {
  return `${catId}-${keyword.toLowerCase().replace(/\s+/g, '-')}`;
}

type Props = {
  shared: AssetsTabSharedState;
};

export function CollectionView({ shared }: Props) {
  const counts = shared.counts;
  const collectedCount = shared.collectedKw;

  const onSelectKeyword = (slug: string, name: string, color: string) => {
    router.push({
      pathname: '/(main)/(modals)/keyword-detail',
      params: { slug, name, color },
    });
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Banner */}
      <LinearGradient
        colors={['#7C3AED', '#9333EA', '#A855F7']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.banner}
      >
        <Text style={styles.bannerTitle}>Your Collection</Text>
        <Text style={styles.bannerSubtitle}>
          Every card reflects a part of who you're becoming.
        </Text>
      </LinearGradient>

      {/* Stat */}
      <View style={styles.statRow}>
        <Text style={styles.statText}>{collectedCount}/48 Collected</Text>
      </View>

      {/* Categories */}
      {CATEGORIES.map((cat) => (
        <CategorySection
          key={cat.id}
          category={cat}
          counts={counts}
          onSelectKeyword={onSelectKeyword}
        />
      ))}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

function CategorySection({
  category,
  counts,
  onSelectKeyword,
}: {
  category: Category;
  counts: Record<string, number>;
  onSelectKeyword: (slug: string, name: string, color: string) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.dot, { backgroundColor: category.color }]} />
        <Text style={styles.sectionTitle}>{category.label.toUpperCase()}</Text>
        <View style={styles.divider} />
      </View>

      <View style={styles.grid}>
        {category.keywords.map((kw) => {
          const slug = kwToSlug(category.id, kw);
          const count = counts[slug] ?? 0;
          const collected = count > 0;
          return (
            <KeywordCell
              key={slug}
              slug={slug}
              keyword={kw}
              count={count}
              collected={collected}
              color={category.color}
              onPress={() =>
                collected && onSelectKeyword(slug, kw, category.color)
              }
            />
          );
        })}
      </View>
    </View>
  );
}

function KeywordCell({
  slug,
  keyword,
  count,
  collected,
  color,
  onPress,
}: {
  slug: string;
  keyword: string;
  count: number;
  collected: boolean;
  color: string;
  onPress: () => void;
}) {
  // Resolve front-art URL via the asset-cache the same way step-8 +
  // FlippableCard do. If the asset isn't cached yet we fall back to
  // the R2 URL so the network image still loads.
  // Stage 5.AIR.2.bugfix.C: R2 stores by keyword ID (mind-clarity)
  // not slug (Clarity). The cache hit usually saves us, but the
  // fallback URL was always wrong; if cache ever misses (e.g. fresh
  // install) Collection would silently render empty. Fix in lockstep
  // with cards-select.
  const id = slugToId(slug);
  const filename = id ? `${id}-front.webp` : `${slug}-front.webp`;
  const cached = getCachedAssetUri(filename);
  const src = cached
    ? { uri: cached }
    : { uri: `https://media.novameapp.com/${filename}` };

  return (
    <Pressable
      onPress={onPress}
      disabled={!collected}
      style={({ pressed }) => [
        styles.cell,
        {
          borderColor: collected ? `${color}66` : 'rgba(255,255,255,0.06)',
          opacity: collected ? 1 : 0.5,
        },
        pressed && collected && { opacity: 0.85, transform: [{ scale: 0.96 }] },
      ]}
    >
      <View style={styles.cellArt}>
        <Image
          source={src}
          style={[
            styles.cellImage,
            !collected && {
              opacity: 0.3,
            },
          ]}
          contentFit="contain"
        />
        {!collected ? (
          <View style={styles.lockOverlay}>
            <View style={styles.lockCircle}>
              <MaterialIcons name="lock" size={14} color="rgba(255,255,255,0.55)" />
            </View>
          </View>
        ) : null}
        {collected ? (
          <View style={[styles.countBadge, { backgroundColor: `${color}D9` }]}>
            <Text style={styles.countText}>×{count}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.cellLabel}>
        <Text
          style={[
            styles.cellLabelText,
            collected ? { color: 'rgba(255,255,255,0.85)' } : { color: 'rgba(255,255,255,0.3)' },
          ]}
          numberOfLines={1}
        >
          {keyword}
        </Text>
      </View>
    </Pressable>
  );
}

const CELL_GAP = 8;
const HORIZONTAL_PAD = 16;

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  banner: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    marginHorizontal: HORIZONTAL_PAD,
    marginTop: 4,
    borderRadius: 16,
  },
  bannerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 4,
  },
  bannerSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '500',
  },
  statRow: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  statText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: HORIZONTAL_PAD,
    marginBottom: 22,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginRight: 8,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -CELL_GAP / 2,
  },
  cell: {
    width: '25%',
    paddingHorizontal: CELL_GAP / 2,
    marginBottom: CELL_GAP,
  },
  cellArt: {
    width: '100%',
    aspectRatio: 10 / 15,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    overflow: 'hidden',
    position: 'relative',
  },
  cellImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  lockOverlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  countText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  cellLabel: {
    paddingTop: 4,
    alignItems: 'center',
  },
  cellLabelText: {
    fontSize: 9,
    fontWeight: '800',
  },
});

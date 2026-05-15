/**
 * Discover filter modal — Stage 3.9.A.2 polish
 *
 * Lets the user pick one or more keyword tags to narrow the Discover
 * question feed. Selections are passed back to the Discover tab via
 * the `selected` route param (comma-separated string), since modal
 * routes can't return values directly. The Discover tab parses the
 * param on focus and re-fetches.
 *
 * Layout:
 *   - Header with back + "Filter" title + Reset button
 *   - 4 sections (Mind / Heart / Action / Connection) each with its
 *     keyword chips. Tapping toggles selection.
 *   - Footer button "Apply (N)" returns to Discover with the param.
 */
import { useMemo, useState } from 'react';
import { haptics } from '@/lib/haptics';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// 48 keywords grouped by category — display labels (NOT slugs).
// Server stores question_tag as the display label (e.g. 'Clarity'),
// so we send these strings as-is in the keywords query param.
const CATEGORIES: { title: string; keywords: string[] }[] = [
  {
    title: 'Mind',
    keywords: [
      'Clarity', 'Grounding', 'Focus', 'Curiosity',
      'Stillness', 'Objectivity', 'Adaptability', 'Unlearning',
      'Vision', 'Acceptance', 'Humor', 'Intuition',
    ],
  },
  {
    title: 'Heart',
    keywords: [
      'Resilience', 'Boundaries', 'Self-Compassion', 'Courage',
      'Vulnerability', 'Empathy', 'Gratitude', 'Patience',
      'Forgiveness', 'Release', 'Balance', 'Joy',
    ],
  },
  {
    title: 'Action',
    keywords: [
      'Initiative', 'Consistency', 'Discipline', 'Decisiveness',
      'Purpose', 'Rest', 'Resourcefulness', 'Accountability',
      'Boldness', 'Endurance', 'Communication', 'Momentum',
    ],
  },
  {
    title: 'Connection',
    keywords: [
      'Sovereignty', 'Authenticity', 'Inspiration', 'Generosity',
      'Trust', 'Reciprocity', 'Collaboration', 'Leadership',
      'Harmony', 'Legacy', 'Respect', 'Loyalty',
    ],
  },
];

function parseInitial(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

export default function DiscoverFilterModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ selected?: string }>();
  const [selected, setSelected] = useState<Set<string>>(() =>
    parseInitial(params.selected),
  );

  const total = selected.size;

  const toggle = (kw: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  const reset = () => setSelected(new Set());

  const apply = () => {
    void haptics.light();
    void haptics.light();
    const csv = Array.from(selected).join(',');
    // Replace the modal with the discover tab carrying the filter
    // param so the back gesture doesn't loop us.
    router.replace({
      pathname: '/(main)/(tabs)/discover',
      params: { filter: csv },
    });
  };

  const goBack = () => {
    void haptics.light();
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/discover');
  };

  const buttonLabel = useMemo(
    () => (total === 0 ? 'Show all' : `Apply (${total})`),
    [total],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          style={({ pressed }) => [
            styles.iconBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.title}>Filter</Text>
        <Pressable
          onPress={reset}
          hitSlop={12}
          disabled={total === 0}
          style={({ pressed }) => [
            styles.resetBtn,
            pressed && { opacity: 0.7 },
            total === 0 && { opacity: 0.4 },
          ]}
        >
          <Text style={styles.resetText}>Reset</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 96 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {CATEGORIES.map((cat) => (
          <View key={cat.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{cat.title}</Text>
            <View style={styles.chipWrap}>
              {cat.keywords.map((kw) => {
                const active = selected.has(kw);
                return (
                  <Pressable
                    key={kw}
                    onPress={() => { void haptics.light(); toggle(kw); }}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        active && styles.chipTextActive,
                      ]}
                    >
                      {kw}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>

      <View
        style={[
          styles.footer,
          { paddingBottom: insets.bottom + 12 },
        ]}
      >
        <Pressable
          onPress={apply}
          style={({ pressed }) => [
            styles.applyBtn,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.applyText}>{buttonLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1A0F3D',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  resetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  resetText: {
    color: '#A855F7',
    fontSize: 14,
    fontWeight: '700',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chipActive: {
    backgroundColor: 'rgba(168,85,247,0.18)',
    borderColor: 'rgba(168,85,247,0.55)',
  },
  chipText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(26,15,61,0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  applyBtn: {
    backgroundColor: '#A855F7',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  applyText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});

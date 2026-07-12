import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { useTheme } from '@/theme/use-theme';
import { fetchSkills, getCachedSkills, DIMENSION_COLOR, type Skill } from '@/lib/skills-api';

/**
 * Skills -- the lessons the user has collected (C9).
 *
 * Cards grouped: own lessons ("learned") and, if any, ones taught by friends.
 * Secret-rarity cards glow (a brighter border + a spark). Skills are paid-only
 * to generate, so a free user sees an explainer rather than an empty void.
 */
export default function SkillsScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const [skills, setSkills] = useState<Skill[]>(() => getCachedSkills());

  useFocusEffect(
    useCallback(() => {
      void fetchSkills().then(setSkills);
    }, []),
  );

  const own = useMemo(() => skills.filter((s) => s.source === 'self'), [skills]);
  const taught = useMemo(() => skills.filter((s) => s.source === 'friend'), [skills]);

  function renderCard(sk: Skill) {
    const dimColor = DIMENSION_COLOR[sk.dimension] ?? c.brand.primary;
    const isSecret = sk.rarity === 'secret';
    return (
      <View
        key={sk.skillId}
        style={[
          styles.card,
          {
            backgroundColor: c.bgCard,
            borderColor: isSecret ? c.brand.purpleLight : c.border,
            borderWidth: isSecret ? 2 : 1,
          },
        ]}
      >
        <View style={styles.cardTop}>
          <View style={[styles.dimDot, { backgroundColor: dimColor }]} />
          <Text style={[styles.cardDim, { color: c.textMuted }]}>
            {sk.dimension[0].toUpperCase() + sk.dimension.slice(1)}
          </Text>
          {isSecret && (
            <View style={styles.secretTag}>
              <MaterialIcons name="auto-awesome" size={12} color={c.brand.purpleLight} />
              <Text style={[styles.secretText, { color: c.brand.purpleLight }]}>Secret</Text>
            </View>
          )}
        </View>
        <Text style={[styles.cardTitle, { color: c.textPrimary }]}>{sk.title}</Text>
        <Text style={[styles.cardBody, { color: c.textSecondary }]}>{sk.body}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bgPrimary }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.textPrimary }]}>Skills</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          Lessons you've drawn from your reflections
        </Text>
      </View>

      {skills.length === 0 ? (
        <View style={styles.empty}>
          <MaterialIcons name="school" size={44} color={c.textMuted} />
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>
            As you reflect, the lessons you arrive at are saved here as skills you can carry forward.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.sectionLabel, { color: c.textMuted }]}>
            Learned · {own.length}
          </Text>
          {own.map(renderCard)}

          {taught.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: c.textMuted, marginTop: 20 }]}>
                Taught by friends · {taught.length}
              </Text>
              {taught.map(renderCard)}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 8, paddingBottom: 12, paddingHorizontal: 4 },
  title: { fontSize: 26, fontFamily: 'Inter_800ExtraBold' },
  subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 4 },

  scroll: { paddingVertical: 8, paddingBottom: 32 },
  sectionLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 10, marginLeft: 4 },

  card: { borderRadius: 16, padding: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  dimDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  cardDim: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1 },
  secretTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  secretText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  cardTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', marginBottom: 6 },
  cardBody: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 16 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },
});

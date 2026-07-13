import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { GUESS_REPLY_TEMPLATES } from '@novame/domain';
import { useTheme } from '../../src/theme/use-theme';
import { haptics } from '../../src/lib/haptics';
import { fetchGuessInbox, replyGuess, type InboxGuess } from '../../src/lib/guess-api';

/**
 * Guesses inbox (C11c). The guesses friends have made about your days -- each a
 * short private note only you see. React with one fixed template (no free-form
 * reply, keeping the distance playful). Once replied, the choice shows and locks.
 */
export default function GuessesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const [inbox, setInbox] = useState<InboxGuess[]>([]);
  const [replyingId, setReplyingId] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetchGuessInbox().then(setInbox);
  }, []);
  useFocusEffect(load);

  async function onReply(guessId: string, templateId: number) {
    void haptics.medium();
    const res = await replyGuess(guessId, templateId);
    if (res.ok) {
      setReplyingId(null);
      load();
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: c.bgPrimary, paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
        <MaterialIcons name="arrow-back" size={24} color={c.textSecondary} />
      </Pressable>
      <Text style={[styles.h1, { color: c.textPrimary }]}>Guesses about you</Text>
      <Text style={[styles.sub, { color: c.textSecondary }]}>
        What your friends imagined your days were like.
      </Text>

      {inbox.length === 0 ? (
        <View style={styles.empty}>
          <MaterialIcons name="lightbulb-outline" size={44} color={c.textMuted} />
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>
            When a friend guesses your day, it'll show up here for you to react to.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {inbox.map((g) => {
            const replied = g.replyTemplateId != null;
            const isReplying = replyingId === g.guessId;
            return (
              <View key={g.guessId} style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.border }]}>
                <Text style={[styles.from, { color: c.brand.primary }]}>{g.fromName} guessed</Text>
                <Text style={[styles.body, { color: c.textPrimary }]}>"{g.body}"</Text>

                {replied ? (
                  <View style={[styles.repliedBox, { backgroundColor: c.bgCardAlt }]}>
                    <Text style={[styles.repliedText, { color: c.textSecondary }]}>
                      You replied: {GUESS_REPLY_TEMPLATES[g.replyTemplateId as number]}
                    </Text>
                  </View>
                ) : isReplying ? (
                  <View style={styles.templates}>
                    {GUESS_REPLY_TEMPLATES.map((t, i) => (
                      <Pressable
                        key={i}
                        onPress={() => onReply(g.guessId, i)}
                        style={[styles.templateChip, { borderColor: c.border }]}
                      >
                        <Text style={[styles.templateText, { color: c.textPrimary }]}>{t}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Pressable onPress={() => setReplyingId(g.guessId)} style={[styles.reactBtn, { backgroundColor: c.brand.primary }]}>
                    <Text style={styles.reactText}>React</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  back: { alignSelf: 'flex-start', paddingVertical: 8 },
  h1: { fontSize: 24, fontFamily: 'Inter_700Bold', marginTop: 8 },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 6, marginBottom: 16, lineHeight: 20 },

  list: { paddingBottom: 32, gap: 12 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16 },
  from: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  body: { fontSize: 16, fontFamily: 'Inter_500Medium', lineHeight: 22, marginBottom: 12 },

  reactBtn: { alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
  reactText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  templates: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  templateChip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  templateText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  repliedBox: { borderRadius: 12, padding: 12 },
  repliedText: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 16 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },
});

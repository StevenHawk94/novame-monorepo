import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { OffsetCard } from '@/components/ui/offset-card';
import { generateCustomTasks } from '@/lib/quests-api';

// Quests family theme (2026-07-23): dark-brown ground, white offset cards.
const BG = '#4C331B';
const OFFSET = '#33220F';
const CARD = '#FFFFFF';
const TEXT = '#4A3B2A';
const MUTED = '#9A8A76';
const CREAM = '#FFF6E8';
const CREAM_MUTED = 'rgba(255,246,232,0.75)';
const ORANGE = '#F2A03D';

const MAX_GOAL = 500;

/**
 * Custom Goal (Plus) — PRD §5.2: the user describes a concrete goal, the AI
 * proposes ~20 daily tasks, and quest-pick takes over for choose-7 → start.
 * Free users hit the server's Plus gate and are routed to the paywall; the
 * screen itself stays reachable so the feature is discoverable.
 */
export default function QuestCustomScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [goal, setGoal] = useState('');
  const [generating, setGenerating] = useState(false);

  const canGenerate = goal.trim().length >= 4 && !generating;

  async function onGenerate() {
    if (!canGenerate) return;
    void haptics.medium();
    setGenerating(true);
    const res = await generateCustomTasks(goal.trim());
    setGenerating(false);
    if (res.ok) {
      router.replace({
        pathname: '/(main)/quest-pick',
        params: {
          themeKey: 'custom',
          title: 'My Custom Plan',
          tasksJson: JSON.stringify(res.tasks),
        },
      });
      return;
    }
    if (res.error === 'plus_required') {
      Alert.alert(
        'A Plus feature',
        'AI-built plans come with NovaMe Plus.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'See Plus',
            onPress: () => router.push('/(main)/(modals)/subscription-paywall' as never),
          },
        ],
      );
      return;
    }
    Alert.alert(
      res.error === 'ai_unavailable' ? 'The planner is busy' : 'Something went wrong',
      'Please try again in a moment.',
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Custom Goal</Text>
          <Text style={styles.sub}>
            Tell me what you want to work on — I'll draft 20 daily tasks, and you pick 7.
          </Text>
        </View>

        <OffsetCard color={OFFSET} offset={4} radius={16} style={{ flex: 1 }} cardStyle={{ flex: 1 }}>
          <TextInput
            style={styles.input}
            placeholder="e.g. Run my first 5k in a month, sleep before midnight, finish my thesis chapter…"
            placeholderTextColor={MUTED}
            value={goal}
            onChangeText={(t) => setGoal(t.slice(0, MAX_GOAL))}
            multiline
            autoFocus
            textAlignVertical="top"
          />
        </OffsetCard>
        <Text style={styles.counter}>{goal.length} / {MAX_GOAL}</Text>

        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.closeX} hitSlop={10}>
            <MaterialIcons name="close" size={24} color={TEXT} />
          </Pressable>
          <Pressable
            onPress={onGenerate}
            disabled={!canGenerate}
            style={[styles.genBtn, { backgroundColor: canGenerate ? ORANGE : 'rgba(255,246,232,0.25)' }]}
          >
            {generating ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.genText}>Generate my plan</Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingHorizontal: 16 },
  header: { paddingHorizontal: 4, paddingBottom: 12 },
  title: { fontSize: 26, fontFamily: 'Inter_800ExtraBold', color: CREAM },
  sub: { fontSize: 14, fontFamily: 'Inter_500Medium', color: CREAM_MUTED, marginTop: 6, lineHeight: 20 },

  input: {
    flex: 1, padding: 16,
    fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 24, color: TEXT,
  },
  counter: { fontSize: 13, fontFamily: 'Inter_500Medium', color: CREAM_MUTED, marginTop: 8, paddingHorizontal: 4 },

  bottomBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12 },
  closeX: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: CARD,
    alignItems: 'center', justifyContent: 'center',
  },
  genBtn: { flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  genText: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
});

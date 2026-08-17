import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { matchItems } from '@novame/engine';

import {
  MemoryEditSheet,
  RC,
  ReflectResultView,
  ReflectTopBar,
} from '@/components/main/reflect-shared';
import { appAlert } from '@/components/ui/app-dialog';
import { ItemSprite } from '@/components/ui/item-sprite';
import { KeyboardDismissView } from '@/components/ui/keyboard-dismiss-view';
import { fetchBags } from '@/lib/bags-api';
import { setReflectBubble } from '@/lib/bubble-store';
import {
  fetchPairing,
  getCachedPairing,
  notifySharedBoxChanged,
} from '@/lib/friends-api';
import { haptics } from '@/lib/haptics';
import { BACKGROUNDS } from '@/lib/icons';
import { mergedItemDictionary } from '@/lib/remote-items';
import { fetchReflectFeed } from '@/lib/reflect-feed-api';
import {
  getReflectStateToday,
  submitReflect,
  type ReflectError,
  type ReflectSnapshot,
} from '@/lib/reflect-api';
import { getCachedSubscriptionTier } from '@/lib/subscription';

const ERROR_MESSAGE: Record<ReflectError, string> = {
  daily_limit: "You've reflected 3 times today. Rest up — come back tomorrow.",
  companion_not_ready: 'Your companion isn’t set up yet. Finish onboarding first.',
  too_long: 'That’s a little long. Trim it under 5,000 characters.',
  empty: 'Write a few words first.',
  network: 'Couldn’t save that. Check your connection and try again.',
};

type Phase = 'write' | 'result';

/** Shared Memories is the third Reflect path and the Ours create destination. */
export default function SharedMemoryCreateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ friendUserId?: string }>();
  const routeFriendId = typeof params.friendUserId === 'string' ? params.friendUserId : '';
  const cachedPartnerId = getCachedPairing()?.partner?.userId ?? '';

  const [friendUserId, setFriendUserId] = useState(routeFriendId || cachedPartnerId);
  const [pairLoading, setPairLoading] = useState(!routeFriendId && !cachedPartnerId);
  const [phase, setPhase] = useState<Phase>('write');
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [liveMatched, setLiveMatched] = useState<{ itemId: string; displayName: string }[]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [result, setResult] = useState<ReflectSnapshot | null>(null);
  const [remaining, setRemaining] = useState(() => getReflectStateToday().reflectsRemaining);
  const isPaid = getCachedSubscriptionTier() !== 'free';

  useEffect(() => {
    if (routeFriendId) {
      setFriendUserId(routeFriendId);
      setPairLoading(false);
      return;
    }
    let active = true;
    void fetchPairing().then((pairing) => {
      if (!active) return;
      setFriendUserId(pairing.paired ? pairing.partner?.userId ?? '' : '');
      setPairLoading(false);
    });
    return () => { active = false; };
  }, [routeFriendId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLiveMatched(matchItems(text, mergedItemDictionary()).map((match) => ({
        itemId: match.itemId,
        displayName: match.displayName,
      })));
    }, 250);
    return () => clearTimeout(timer);
  }, [text]);

  const shownMatches = liveMatched.filter((match) => !removedIds.has(match.itemId));
  const missingFreeNotes = !isPaid && shownMatches.some((match) => !(notes[match.itemId] ?? '').trim());
  const atLimit = remaining <= 0;

  function removeMatch(itemId: string) {
    void haptics.light();
    setRemovedIds((current) => new Set(current).add(itemId));
  }

  async function create() {
    if (submitting) return;
    if (!friendUserId) {
      appAlert('Pair with someone first', 'Shared Memories are created together with your paired person.');
      return;
    }
    if (shownMatches.length === 0) {
      appAlert('No items matched', 'Mention the things you remember together, such as coffee, a movie, or flowers.');
      return;
    }
    if (missingFreeNotes) {
      setEditOpen(true);
      appAlert('Add memory details', 'Free members add a description for every memory item before saving.');
      return;
    }

    const itemNotes: Record<string, string> = {};
    for (const match of shownMatches) {
      const note = (notes[match.itemId] ?? '').trim();
      if (note) itemNotes[match.itemId] = note;
    }

    void haptics.medium();
    setSubmitting(true);
    const response = await submitReflect({
      promptId: 9,
      body: text,
      friendUserId,
      mode: 'typing',
      removedItemIds: [...removedIds],
      itemNotes,
      visibleToFriend: true,
    });
    setSubmitting(false);

    if (!response.ok) {
      if (response.error === 'daily_limit') setRemaining(0);
      appAlert('Could not save that', ERROR_MESSAGE[response.error]);
      return;
    }

    setResult(response.snapshot);
    setRemaining(response.snapshot.reflectsRemaining);
    if (response.snapshot.bubble) setReflectBubble(response.snapshot.bubble);
    notifySharedBoxChanged(friendUserId);
    void fetchReflectFeed();
    void fetchBags();
    void haptics.success();
    setPhase('result');
  }

  return (
    <View style={styles.screen}>
      <ExpoImage source={BACKGROUNDS.reflect} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={styles.scrim} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <KeyboardDismissView style={[styles.root, { paddingTop: insets.top + 10 }]}>
          {phase !== 'result' && <ReflectTopBar remaining={remaining} onBack={() => router.back()} />}

          {phase === 'result' && result ? (
            <View style={{ flex: 1, paddingBottom: insets.bottom + 12 }}>
              <ReflectResultView result={result} onFinished={() => router.back()} />
            </View>
          ) : pairLoading ? (
            <View style={styles.centerState}><ActivityIndicator color="#FFFFFF" /></View>
          ) : !friendUserId ? (
            <View style={styles.centerState}>
              <Text style={styles.stateTitle}>Pair with someone first</Text>
              <Text style={styles.stateBody}>Then you can turn moments you shared together into memories for both of you.</Text>
            </View>
          ) : atLimit ? (
            <View style={styles.centerState}>
              <Text style={styles.stateTitle}>That’s three for today</Text>
              <Text style={styles.stateBody}>{ERROR_MESSAGE.daily_limit}</Text>
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.title}>Shared Memories</Text>
              <TextInput
                style={styles.input}
                placeholder="Simply type anything you remember together, and we’ll turn it into memory items for both of you."
                placeholderTextColor="#9A9A9A"
                value={text}
                onChangeText={(value) => setText(value.slice(0, 5000))}
                multiline
                autoFocus
                textAlignVertical="top"
              />

              <Text style={styles.matchLabel}>Items matched from your memory</Text>
              <View style={styles.matchBar}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchRow}>
                  {shownMatches.length === 0 ? (
                    <Text style={styles.matchEmpty}>Items will appear as you write…</Text>
                  ) : shownMatches.map((match) => (
                    <ItemSprite key={match.itemId} itemId={match.itemId} size={44} radius={12} />
                  ))}
                </ScrollView>
                <Pressable
                  onPress={() => { void haptics.light(); setEditOpen(true); }}
                  disabled={shownMatches.length === 0}
                  style={[styles.editButton, shownMatches.length === 0 && styles.disabled]}
                  hitSlop={8}
                >
                  <MaterialIcons name="edit" size={20} color="#FFFFFF" />
                </Pressable>
              </View>

              {!isPaid && shownMatches.length > 0 && (
                <Text style={styles.freeNote}>Add a description for each item before saving.</Text>
              )}

              <Pressable
                onPress={() => void create()}
                disabled={text.trim().length < 4 || submitting}
                style={({ pressed }) => [
                  styles.createButton,
                  (text.trim().length < 4 || submitting) && styles.disabled,
                  pressed && { transform: [{ translateY: 2 }] },
                  { marginBottom: insets.bottom + 12 },
                ]}
              >
                {submitting ? <ActivityIndicator color={RC.ink} /> : <Text style={styles.createText}>Create</Text>}
              </Pressable>
            </View>
          )}
        </KeyboardDismissView>
      </KeyboardAvoidingView>

      {editOpen && (
        <MemoryEditSheet
          items={shownMatches}
          notes={notes}
          onChangeNote={(itemId, value) => setNotes((current) => ({ ...current, [itemId]: value }))}
          onRemove={removeMatch}
          onDone={() => setEditOpen(false)}
          isPaid={isPaid}
          requireNotes={!isPaid}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#5A2E2A' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: RC.scrim },
  root: { flex: 1, paddingHorizontal: 18 },
  form: { flex: 1 },
  title: { color: '#FFFFFF', fontSize: 24, fontFamily: 'Inter_800ExtraBold', marginBottom: 12 },
  centerState: { flex: 1, minHeight: 360, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 10 },
  stateTitle: { color: '#FFFFFF', fontSize: 24, fontFamily: 'Inter_800ExtraBold', textAlign: 'center' },
  stateBody: { color: 'rgba(255,255,255,0.9)', fontSize: 16, fontFamily: 'Inter_500Medium', textAlign: 'center', lineHeight: 23 },
  input: {
    flex: 1, minHeight: 150, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18,
    fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 24, color: '#2A2118',
  },
  matchLabel: { color: '#FFFFFF', textAlign: 'center', fontSize: 15, fontFamily: 'Inter_700Bold', marginTop: 12, marginBottom: 8 },
  matchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 10, paddingLeft: 12, paddingRight: 10, minHeight: 60, maxHeight: 64, marginBottom: 8 },
  matchRow: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  matchEmpty: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#B7AEA6' },
  editButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#43301F', alignItems: 'center', justifyContent: 'center' },
  freeNote: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginBottom: 12 },
  createButton: {
    backgroundColor: RC.yellow, borderRadius: 24, paddingVertical: 17, alignItems: 'center',
    shadowColor: RC.yellowDrop, shadowOpacity: 1, shadowRadius: 0,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  disabled: { opacity: 0.45 },
  createText: { color: '#5A4419', fontSize: 19, fontFamily: 'Inter_800ExtraBold' },
});

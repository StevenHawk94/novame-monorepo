import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { ItemSprite } from '@/components/ui/item-sprite';
import { ItemSheet, type ItemSheetRef } from '@/components/main/item-sheet';
import { useWindowDimensions } from 'react-native';
import { FRIEND_ICONS } from '@/lib/icons';
import { ITEM_DICTIONARY, matchItems } from '@novame/engine';
import { PROMPT_CATEGORIES } from '@/lib/guided-catalog.g';
import { itemsForGuidedCategory } from '@/lib/guided-prompts';
import {
  createSharedMemories, fetchSharedBox, type SharedBoxItem, getCachedFriends,
} from '@/lib/friends-api';
import { KeyboardDismissView } from '@/components/ui/keyboard-dismiss-view';
import { UserAvatar } from '@/components/ui/user-avatar';

// Same strip as Bags: "all" + the 11 guided prompt categories.
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  ...PROMPT_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
];

/**
 * Shared memories (mocks 1:1). Grid view: memory-book header ("Your memories
 * with {name}"), avatar, the orange Create New button, the Bags-style
 * category strip, then a 6-across grid of item tiles — tapping one opens the
 * same ItemSheet as Bags. Create view: the brown room with a white paper
 * card — a free write whose matched items preview live under the input,
 * exactly like Reflect's typing flow.
 */
type Mode = 'grid' | 'create';

export default function FriendMemoriesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { friendUserId, friendName } = useLocalSearchParams<{
    friendUserId: string;
    friendName?: string;
  }>();
  const name = typeof friendName === 'string' && friendName ? friendName : 'your friend';
  const cachedFriend = getCachedFriends().friends.find((f) => f.userId === friendUserId);

  const { width } = useWindowDimensions();
  const memTile = Math.floor((width - 32) / 6) - 6;
  const [mode, setMode] = useState<Mode>('grid');
  const [items, setItems] = useState<SharedBoxItem[]>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const itemSheetRef = useRef<ItemSheetRef>(null);

  // Category strip (same behavior as Bags): capsule fixed on the ScrollView,
  // tapped chip centers into view on small screens.
  const [category, setCategory] = useState<string>('all');
  const catScrollRef = useRef<ScrollView>(null);
  const chipLayout = useRef<Record<string, { x: number; width: number }>>({});
  const categoryIds = useMemo(
    () => (category === 'all' ? null : new Set(itemsForGuidedCategory(category))),
    [category],
  );
  const shown = categoryIds === null ? items : items.filter((it) => categoryIds.has(it.itemId));

  // Live match while typing (same as Reflect free write): debounce 250ms,
  // run the shared engine locally — zero server calls.
  const [liveMatched, setLiveMatched] = useState<{ itemId: string }[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      const matches = matchItems(text, ITEM_DICTIONARY);
      setLiveMatched(matches.map((m) => ({ itemId: m.itemId })));
    }, 250);
    return () => clearTimeout(t);
  }, [text]);

  const load = useCallback(() => {
    if (typeof friendUserId === 'string' && friendUserId) {
      void fetchSharedBox(friendUserId).then(setItems);
    }
  }, [friendUserId]);
  useFocusEffect(load);

  async function onCreate() {
    if (typeof friendUserId !== 'string' || !friendUserId) return;
    const trimmed = text.trim();
    if (trimmed.length < 4 || submitting) return;
    void haptics.medium();
    setSubmitting(true);
    const res = await createSharedMemories(friendUserId, trimmed);
    setSubmitting(false);
    if (!res.ok) {
      appAlert('Could not save that', 'Please try again.');
      return;
    }
    setText('');
    setMode('grid');
    if (res.createdCount === 0) {
      appAlert(
        'No items matched',
        "We couldn't find any memory items in that text — try mentioning the things themselves (the coffee, the movie, the flowers…).",
      );
    } else {
      void haptics.success();
      load();
    }
  }

  // ---- CREATE (mock: brown room, white paper, Create button, X) ----
  if (mode === 'create') {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <KeyboardDismissView style={[styles.createRoot, { paddingTop: insets.top + 26 }]}>
          <View style={styles.paperWrap}>
            <Image source={FRIEND_ICONS.memory} style={styles.paperBook} resizeMode="contain" />
            <View style={styles.paper}>
              <TextInput
                style={styles.paperInput}
                placeholder="Simply type anything you remember with your friend, and we will do the rest to create a bunch of memories items for you two."
                placeholderTextColor="#9A9A9A"
                value={text}
                onChangeText={(t) => setText(t.slice(0, 3000))}
                multiline
                autoFocus
                textAlignVertical="top"
              />
            </View>
          </View>

          {/* Live match bar — same pattern as Reflect's free write */}
          <Text style={styles.matchLabel}>Items matched from your memory</Text>
          <View style={styles.matchBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchRow}>
              {liveMatched.length === 0 ? (
                <Text style={styles.matchEmpty}>Items will appear as you write…</Text>
              ) : (
                liveMatched.map((m) => (
                  <ItemSprite key={m.itemId} itemId={m.itemId} size={44} radius={12} />
                ))
              )}
            </ScrollView>
          </View>

          <Pressable
            onPress={() => void onCreate()}
            disabled={text.trim().length < 4 || submitting}
            style={({ pressed }) => [
              styles.createBtn,
              { opacity: text.trim().length < 4 ? 0.6 : 1 },
              pressed && { transform: [{ translateY: 2 }] },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#1B1B1B" />
            ) : (
              <Text style={styles.createBtnText}>Create</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => { void haptics.light(); setMode('grid'); }}
            style={[styles.createClose, { marginBottom: insets.bottom + 14 }]}
            hitSlop={10}
          >
            <MaterialIcons name="close" size={26} color="#4A3220" />
          </Pressable>
        </KeyboardDismissView>
      </KeyboardAvoidingView>
    );
  }

  // ---- GRID (mock: header + filter bar + 6-across blank tiles) ----
  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Image source={FRIEND_ICONS.memory} style={styles.headerBook} resizeMode="contain" />
        <Text style={styles.headerTitle} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
          Your memories{'\n'}with {name}
        </Text>
        <UserAvatar userId={typeof friendUserId === 'string' ? friendUserId : null} avatarUrl={cachedFriend?.avatarUrl} isDefaultAvatar={cachedFriend?.isDefaultAvatar} size={46} />
        <Pressable
          onPress={() => { void haptics.light(); setMode('create'); }}
          style={({ pressed }) => [styles.newBtn, pressed && { transform: [{ translateY: 2 }] }]}
        >
          <Text style={styles.newBtnText}>Create New</Text>
        </Pressable>
      </View>

      {/* Category strip — identical to Bags (capsule fixed on the ScrollView,
          content scrolls inside; tapped chip centers into view). */}
      <ScrollView
        ref={catScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catStripScroll}
        contentContainerStyle={styles.catStrip}
      >
        {CATEGORIES.map((cat) => {
          const active = cat.key === category;
          return (
            <Pressable
              key={cat.key}
              onLayout={(e) => { chipLayout.current[cat.key] = e.nativeEvent.layout; }}
              onPress={() => {
                void haptics.light();
                setCategory(cat.key);
                const l = chipLayout.current[cat.key];
                if (l) {
                  const viewport = width - 32; // root paddingHorizontal
                  catScrollRef.current?.scrollTo({
                    x: Math.max(0, l.x + l.width / 2 - viewport / 2),
                    animated: true,
                  });
                }
              }}
              style={[styles.catChip, active && styles.catChipActive]}
            >
              {cat.key === 'all' ? (
                <MaterialIcons name="apps" size={22} color={active ? '#FFF6DE' : '#B99C6B'} />
              ) : (
                <Text style={[styles.catLabel, active && styles.catLabelActive]} numberOfLines={2}>
                  {cat.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {shown.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>{'🎁'}</Text>
          <Text style={styles.emptyText}>
            {items.length === 0
              ? `Nothing here yet — create a shared memory, or pick "I have done something with my friend" when you reflect.`
              : 'Nothing in this category yet.'}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.gridScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.grid}>
            {shown.map((it) => (
              <Pressable
                key={it.id}
                onPress={() => itemSheetRef.current?.present(it.itemId)}
                style={styles.cell}
              >
                <ItemSprite itemId={it.itemId} size={memTile} radius={14} tileColor="#EFEDF6" />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      <Pressable
        onPress={() => { void haptics.light(); router.back(); }}
        style={[styles.gridBack, { bottom: insets.bottom + 14 }]}
        hitSlop={10}
      >
        <MaterialIcons name="close" size={24} color="#FFFFFF" />
      </Pressable>

      <ItemSheet ref={itemSheetRef} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FDEDEE', paddingHorizontal: 16 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 14 },
  headerBook: { width: 52, height: 52 },
  headerTitle: { flex: 1, fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#4A3220', lineHeight: 26 },
  newBtn: {
    backgroundColor: '#F0885C', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13,
    shadowColor: '#C9552F', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  newBtnText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_800ExtraBold' },

  // Category strip — same visual system as Bags (capsule on the ScrollView).
  catStrip: {
    flexGrow: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 10, paddingVertical: 8,
  },
  catStripScroll: {
    flexGrow: 0,
    backgroundColor: '#FFF8E3', borderRadius: 30, borderWidth: 1.5, borderColor: '#3E2C1A',
    marginBottom: 16, overflow: 'hidden',
  },
  catChip: { minWidth: 52, height: 46, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  catChipActive: { backgroundColor: '#4A3423' },
  catLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#8A6B3F', textAlign: 'center' },
  catLabelActive: { color: '#FFF6DE' },

  gridScroll: { paddingBottom: 90 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', columnGap: 4 },
  cell: { width: '15.5%', aspectRatio: 0.85, marginBottom: 10 },
  tile: { flex: 1, borderRadius: 14, backgroundColor: '#EFEDF6' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 80 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#8A7A63', textAlign: 'center', lineHeight: 21 },

  gridBack: {
    position: 'absolute', alignSelf: 'center',
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#4A3220',
    alignItems: 'center', justifyContent: 'center',
  },

  // ---- create ----
  createRoot: { flex: 1, backgroundColor: '#4A3220', paddingHorizontal: 22 },
  paperWrap: { flex: 1, marginBottom: 18 },
  paperBook: { width: 56, height: 56, alignSelf: 'center', marginBottom: -26, zIndex: 2 },
  paper: {
    flex: 1, backgroundColor: '#FBF7EE', borderRadius: 28, paddingTop: 40, paddingHorizontal: 20, paddingBottom: 20,
    shadowColor: '#2B1A0E', shadowOpacity: 0.4, shadowRadius: 0, shadowOffset: { width: 0, height: 5 },
  },
  paperInput: { flex: 1, fontSize: 17, fontFamily: 'Inter_600SemiBold', lineHeight: 27, color: '#2B2B2B' },
  matchLabel: {
    fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF',
    textAlign: 'center', marginBottom: 8,
  },
  matchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 10, paddingHorizontal: 12,
    marginBottom: 18, minHeight: 64,
  },
  matchRow: { gap: 8, alignItems: 'center', flexGrow: 1, justifyContent: 'center' },
  matchEmpty: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#B7AEA6' },
  createBtn: {
    alignSelf: 'center', minWidth: 220, backgroundColor: '#FBCFA6',
    borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    borderWidth: 2.5, borderColor: '#1B1B1B',
    shadowColor: '#1B1B1B', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 2, height: 3 },
    elevation: 4,
  },
  createBtnText: { color: '#1B1B1B', fontSize: 19, fontFamily: 'Inter_800ExtraBold' },
  createClose: {
    alignSelf: 'center', marginTop: 16,
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
});

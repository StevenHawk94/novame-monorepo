import { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { FRIEND_ICONS } from '@/lib/icons';
import {
  createSharedMemories, fetchSharedBox, type SharedBoxItem,
} from '@/lib/friends-api';

/**
 * Shared memories (mocks 1:1). Grid view: memory-book header ("Your memories
 * with {name}"), avatar, the orange Create New button, the category filter
 * bar, then a 6-across grid of item tiles (blank until the item art lands —
 * tapping one still shows its memory text). Create view: the brown room with
 * a white paper card — type the memory, we match the items for both of you.
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

  const [mode, setMode] = useState<Mode>('grid');
  const [items, setItems] = useState<SharedBoxItem[]>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      Alert.alert('Could not save that', 'Please try again.');
      return;
    }
    setText('');
    setMode('grid');
    if (res.createdCount === 0) {
      Alert.alert(
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.createRoot, { paddingTop: insets.top + 26 }]}>
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
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ---- GRID (mock: header + filter bar + 6-across blank tiles) ----
  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Image source={FRIEND_ICONS.memory} style={styles.headerBook} resizeMode="contain" />
        <Text style={styles.headerTitle} numberOfLines={2}>
          Your memories{'\n'}with {name}
        </Text>
        <View style={styles.headerAvatar}><Text style={styles.headerAvatarEmoji}>{'🐰'}</Text></View>
        <Pressable
          onPress={() => { void haptics.light(); setMode('create'); }}
          style={({ pressed }) => [styles.newBtn, pressed && { transform: [{ translateY: 2 }] }]}
        >
          <Text style={styles.newBtnText}>Create New</Text>
        </Pressable>
      </View>

      {/* category filter bar — the "all" pill; categories light up with the item art */}
      <View style={styles.filterBar}>
        <View style={styles.filterAll}>
          <MaterialIcons name="apps" size={22} color="#FFFFFF" />
        </View>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={styles.filterSlot}>
            <MaterialIcons name="circle" size={10} color="#E3CBA4" />
          </View>
        ))}
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>{'🎁'}</Text>
          <Text style={styles.emptyText}>
            Nothing here yet — create a shared memory, or pick "{'I have done something with my friend'}" when you reflect.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.gridScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.grid}>
            {items.map((it) => (
              <Pressable
                key={it.id}
                onPress={() => Alert.alert(it.description || 'A shared memory', undefined)}
                style={styles.cell}
              >
                {/* blank until the item art lands */}
                <View style={styles.tile} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FDEDEE', paddingHorizontal: 16 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 14 },
  headerBook: { width: 52, height: 52 },
  headerTitle: { flex: 1, fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#4A3220', lineHeight: 26 },
  headerAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#F4F1F8', alignItems: 'center', justifyContent: 'center' },
  headerAvatarEmoji: { fontSize: 24 },
  newBtn: {
    backgroundColor: '#F0885C', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13,
    shadowColor: '#C9552F', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  newBtnText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_800ExtraBold' },

  filterBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FBF3D8', borderRadius: 22, borderWidth: 2, borderColor: '#3A2E1A',
    paddingHorizontal: 10, paddingVertical: 8, marginBottom: 16,
  },
  filterAll: {
    width: 62, height: 40, borderRadius: 20, backgroundColor: '#4A3423',
    alignItems: 'center', justifyContent: 'center',
  },
  filterSlot: { flex: 1, alignItems: 'center' },

  gridScroll: { paddingBottom: 90 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
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

import { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import {
  createSharedMemories, fetchSharedBox, type SharedBoxItem,
} from '@/lib/friends-api';

/**
 * The shared memory box with one friend (design: Shared memeories.png /
 * Create shared memories.png). Same visual grammar as Bags — a grid of the
 * pair's items — plus the Create New flow: paste/write a memory, the rule
 * matcher turns it into items for BOTH of you (PRD 6.3). AI-refined
 * descriptions are the later Plus pass; the matched excerpt is the baseline.
 */
export default function FriendMemoriesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { friendUserId, friendName } = useLocalSearchParams<{
    friendUserId: string;
    friendName?: string;
  }>();
  const name = typeof friendName === 'string' && friendName ? friendName : 'your friend';

  const [items, setItems] = useState<SharedBoxItem[]>([]);
  const [creating, setCreating] = useState(false);
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
    setCreating(false);
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

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        {/* header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
            <MaterialIcons name="arrow-back" size={24} color="#6B5A45" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={2}>
              {'📔'} Your memories with {name}
            </Text>
          </View>
          <Pressable
            onPress={() => { void haptics.light(); setCreating((v) => !v); }}
            style={styles.createBtn}
          >
            <Text style={styles.createBtnText}>{creating ? 'Close' : 'Create New'}</Text>
          </Pressable>
        </View>

        {/* create flow */}
        {creating && (
          <View style={styles.createBox}>
            <TextInput
              style={styles.input}
              placeholder={`Write the memory — the dinner, the trip, the little things you shared with ${name}…`}
              placeholderTextColor="#B8A588"
              value={text}
              onChangeText={(t) => setText(t.slice(0, 3000))}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <Pressable
              onPress={onCreate}
              disabled={text.trim().length < 4 || submitting}
              style={[styles.saveBtn, { opacity: text.trim().length < 4 ? 0.5 : 1 }]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.saveBtnText}>Turn it into items</Text>
              )}
            </Pressable>
          </View>
        )}

        {/* grid */}
        {items.length === 0 && !creating ? (
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
                  <View style={styles.tile}>
                    <Text style={styles.tileEmoji}>{it.emoji}</Text>
                  </View>
                  <Text style={styles.tileDesc} numberOfLines={2}>{it.description}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FBEFF0', paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  back: { paddingVertical: 6 },
  title: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#4A3220', lineHeight: 24 },
  createBtn: {
    backgroundColor: '#F0885C', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 11,
    shadowColor: '#2B2B2B', shadowOpacity: 0.3, shadowRadius: 0, shadowOffset: { width: 1, height: 2 },
    elevation: 2,
  },
  createBtnText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_800ExtraBold' },

  createBox: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, marginBottom: 14 },
  input: {
    minHeight: 110, fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, color: '#2B2B2B',
  },
  saveBtn: {
    backgroundColor: '#8A6240', borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 8,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },

  gridScroll: { paddingBottom: 28 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cell: { width: '31%', marginBottom: 16, alignItems: 'center' },
  tile: {
    width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: '#F4F1F8',
    alignItems: 'center', justifyContent: 'center',
  },
  tileEmoji: { fontSize: 34 },
  tileDesc: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#6B5A45', marginTop: 6, textAlign: 'center' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 80 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#8A7A63', textAlign: 'center', lineHeight: 21 },
});

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { AspireWordsPicker } from '@/components/onboarding/aspire-words-picker';
import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { invalidateWisdomCenter, updateAspireWords } from '@/lib/wisdom-center-api';

/**
 * Edit Aspire Words modal -- Stage 6 editable aspire-words feature.
 *
 * Entry: Growth Center page header pencil icon (top-right).
 *
 * Route params:
 *   initial: JSON-encoded string[] of the user's current aspireWords.
 *            Passed from Growth Center so the modal doesn't need to
 *            re-fetch /api/wisdom-center on open.
 *
 * Save flow (Q8 = "C" style):
 *   - Save disabled until selected.length >= 4 (matches onboarding rule).
 *   - On Save: show spinner, POST /api/update-profile { aspireWords }.
 *   - Success: router.back() -> Growth Center useFocusEffect re-fetches
 *     wisdom-center data with the new aspireWords + recomputed
 *     better_self_score.
 *   - Failure: show Alert, modal stays open, user can retry.
 *
 * Close flow:
 *   - X button: dirty-check (compare against initial). If dirty,
 *     Alert "Discard changes?" -> Discard / Cancel. If clean, back.
 */
export default function EditAspireWordsModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ initial?: string }>();

  // Parse initial selection from route param. JSON.parse failure ->
  // empty array (defensive; should never happen because Growth Center
  // always stringifies a known array).
  const initial = useMemo<string[]>(() => {
    try {
      const raw = params.initial;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((w) => typeof w === 'string') : [];
    } catch {
      return [];
    }
  }, [params.initial]);

  const [selected, setSelected] = useState<string[]>(initial);
  const [saving, setSaving] = useState(false);

  const canSave = selected.length >= 4 && !saving;

  const isDirty = useMemo(() => {
    if (selected.length !== initial.length) return true;
    const sortedA = [...selected].sort();
    const sortedB = [...initial].sort();
    return sortedA.some((w, i) => w !== sortedB[i]);
  }, [selected, initial]);

  const handleClose = () => {
    void haptics.light();
    if (!isDirty) {
      router.back();
      return;
    }
    Alert.alert(
      'Discard changes?',
      'Your edits to aspire words will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => router.back(),
        },
      ],
    );
  };

  const handleSave = async () => {
    if (!canSave) return;
    void haptics.medium();
    setSaving(true);

    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) {
      setSaving(false);
      Alert.alert('Not signed in', 'Please sign in again and retry.');
      return;
    }

    const result = await updateAspireWords(userId, selected);
    setSaving(false);

    if (result.kind === 'success') {
      // Stage 6 Bug 3 fix Layer 2: invalidate wisdom-center cache so
      // Growth Center (which now uses cache-first via
      // fetchWisdomCenterWithCache) doesn't show the OLD aspire_words
      // for a moment before its useFocusEffect refetch lands. The
      // next focus triggers a fresh fetch + write-through.
      invalidateWisdomCenter();
      void haptics.success();
      router.back();
    } else {
      void haptics.error();
      Alert.alert('Save failed', result.message);
    }
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={handleClose} style={styles.iconBtn} hitSlop={8}>
          <MaterialIcons name="close" size={20} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.title}>Edit Aspire Words</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.headline}>How would you describe your ideal self?</Text>
        <Text style={styles.hint}>Select 4 to 6 keywords</Text>

        <AspireWordsPicker selected={selected} onChange={setSelected} />
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.counter}>{selected.length}/6 selected</Text>
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.saveBtnText}>Save Changes</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ---- styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  headline: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  hint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginBottom: 20,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0F0B2E',
  },
  counter: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  saveBtn: {
    height: 52,
    borderRadius: 26,
    backgroundColor: '#EC4899',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: 'rgba(236,72,153,0.3)',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
});

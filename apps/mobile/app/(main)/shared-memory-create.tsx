import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { matchItems } from '@novame/engine';

import { appAlert } from '@/components/ui/app-dialog';
import { ItemSprite } from '@/components/ui/item-sprite';
import { KeyboardDismissView } from '@/components/ui/keyboard-dismiss-view';
import { createSharedMemories } from '@/lib/friends-api';
import { haptics } from '@/lib/haptics';
import { FRIEND_ICONS } from '@/lib/icons';
import { mergedItemDictionary } from '@/lib/remote-items';

export default function SharedMemoryCreateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { friendUserId } = useLocalSearchParams<{ friendUserId: string }>();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [liveMatched, setLiveMatched] = useState<{ itemId: string }[]>([]);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLiveMatched(matchItems(text, mergedItemDictionary()).map((match) => ({ itemId: match.itemId })));
    }, 250);
    return () => clearTimeout(timer);
  }, [text]);

  const paperHeight = useMemo(() => {
    if (keyboardVisible) return Math.max(230, Math.min(300, height * 0.34));
    return Math.max(320, Math.min(470, height * 0.5));
  }, [height, keyboardVisible]);

  async function create() {
    if (typeof friendUserId !== 'string' || !friendUserId || submitting) return;
    const trimmed = text.trim();
    if (trimmed.length < 4) return;
    void haptics.medium();
    setSubmitting(true);
    const result = await createSharedMemories(friendUserId, trimmed);
    setSubmitting(false);
    if (!result.ok) {
      appAlert('Could not save that', 'Please try again.');
      return;
    }
    if (result.createdCount === 0) {
      appAlert(
        'No items matched',
        "We couldn't find any memory items in that text — try mentioning the things themselves (the coffee, the movie, the flowers…).",
      );
      return;
    }
    void haptics.success();
    router.back();
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <KeyboardDismissView style={styles.root}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 22, paddingBottom: keyboardVisible ? 18 : insets.bottom + 18 },
          ]}
        >
          <View style={[styles.paperWrap, { height: paperHeight }]}>
            <Image source={FRIEND_ICONS.memory} style={styles.paperBook} resizeMode="contain" />
            <View style={styles.paper}>
              <TextInput
                style={styles.paperInput}
                placeholder="Simply type anything you remember together, and we’ll turn it into memory items for both of you."
                placeholderTextColor="#9A9A9A"
                value={text}
                onChangeText={(value) => setText(value.slice(0, 3000))}
                multiline
                autoFocus
                textAlignVertical="top"
              />
            </View>
          </View>

          <Text style={styles.matchLabel}>Items matched from your memory</Text>
          <View style={styles.matchBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchRow}>
              {liveMatched.length === 0 ? (
                <Text style={styles.matchEmpty}>Items will appear as you write…</Text>
              ) : liveMatched.map((match) => (
                <ItemSprite key={match.itemId} itemId={match.itemId} size={44} radius={12} />
              ))}
            </ScrollView>
          </View>

          <Pressable
            onPress={() => void create()}
            disabled={text.trim().length < 4 || submitting}
            style={({ pressed }) => [
              styles.createButton,
              text.trim().length < 4 && styles.disabled,
              pressed && { transform: [{ translateY: 2 }] },
            ]}
          >
            {submitting ? <ActivityIndicator color="#1B1B1B" /> : <Text style={styles.createText}>Create</Text>}
          </Pressable>

          {!keyboardVisible ? (
            <Pressable
              onPress={() => { void haptics.light(); router.back(); }}
              style={styles.close}
              hitSlop={10}
            >
              <MaterialIcons name="close" size={26} color="#4A3220" />
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardDismissView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#4A3220' },
  content: { flexGrow: 1, paddingHorizontal: 22, alignItems: 'stretch' },
  paperWrap: { minHeight: 230, marginBottom: 16 },
  paperBook: { width: 56, height: 56, alignSelf: 'center', marginBottom: -26, zIndex: 2 },
  paper: {
    flex: 1, backgroundColor: '#FBF7EE', borderRadius: 28,
    paddingTop: 40, paddingHorizontal: 20, paddingBottom: 20,
    shadowColor: '#2B1A0E', shadowOpacity: 0.4, shadowRadius: 0,
    shadowOffset: { width: 0, height: 5 },
  },
  paperInput: { flex: 1, fontSize: 17, fontFamily: 'Inter_600SemiBold', lineHeight: 27, color: '#2B2B2B' },
  matchLabel: { color: '#FFFFFF', textAlign: 'center', fontSize: 15, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  matchBar: { backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 10, paddingHorizontal: 12, minHeight: 64, marginBottom: 16 },
  matchRow: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  matchEmpty: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#B7AEA6' },
  createButton: {
    alignSelf: 'center', minWidth: 220, backgroundColor: '#FBCFA6', borderRadius: 14,
    paddingVertical: 15, alignItems: 'center', borderWidth: 2.5, borderColor: '#1B1B1B',
    shadowColor: '#1B1B1B', shadowOpacity: 1, shadowRadius: 0,
    shadowOffset: { width: 2, height: 3 }, elevation: 4,
  },
  disabled: { opacity: 0.6 },
  createText: { color: '#1B1B1B', fontSize: 19, fontFamily: 'Inter_800ExtraBold' },
  close: { alignSelf: 'center', marginTop: 16, width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
});

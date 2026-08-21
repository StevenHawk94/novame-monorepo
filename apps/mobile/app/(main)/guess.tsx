import { useCallback, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { useTheme } from '../../src/theme/use-theme';
import { haptics } from '../../src/lib/haptics';
import { fetchFriends, type FriendCard } from '../../src/lib/friends-api';
import { submitGuess } from '../../src/lib/guess-api';

/**
 * Guess Their Day (C11c). Look at a friend's item emoji for today and guess what
 * they got up to -- a short, private note only they'll see. One guess per friend
 * per day. This is the whole interaction: no chat, just a playful guess they can
 * react to with a fixed template.
 */
export default function GuessScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const { userId, name } = useLocalSearchParams<{ userId: string; name: string }>();
  const [friend, setFriend] = useState<FriendCard | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void fetchFriends().then((s) => setFriend(s.friends.find((f) => f.userId === userId) ?? null));
    }, [userId]),
  );

  async function onSend() {
    const body = text.trim();
    if (body.length === 0 || sending) return;
    setSending(true);
    void haptics.medium();
    const res = await submitGuess(userId, body);
    setSending(false);
    if (res.ok) {
      appAlert('Sent', `Only ${name} will see your guess.`, [
        { text: 'Done', onPress: () => router.back() },
      ]);
    } else {
      const msg =
        res.error === 'already_guessed' ? `You've already guessed ${name}'s day today.`
        : res.error === 'not_friends' ? 'You can only guess a friend’s day.'
        : 'Something went wrong. Try again.';
      appAlert('Hmm', msg);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bgPrimary }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
    <View style={[styles.root, { backgroundColor: c.bgPrimary, paddingTop: insets.top + 8 }]}>
      {/* Middle content scrolls when the keyboard shrinks the container; the
          send button stays pinned below as a sticky footer. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
      <Pressable onPress={() => { void haptics.pageClose(); router.back(); }} style={styles.back} hitSlop={12}>
        <MaterialIcons name="arrow-back" size={24} color={c.textSecondary} />
      </Pressable>

      <Text style={[styles.h1, { color: c.textPrimary }]}>Guess {name}'s day</Text>
      <Text style={[styles.sub, { color: c.textSecondary }]}>
        Here's what they gathered today. What do you think they were up to?
      </Text>

      {/* Their emoji glimpse */}
      <View style={[styles.emojiCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
        {friend && friend.todayEmoji.length > 0 ? (
          <View style={styles.emojiRow}>
            {friend.todayEmoji.map((e, i) => <Text key={i} style={styles.emoji}>{e}</Text>)}
          </View>
        ) : (
          <Text style={[styles.noUpdate, { color: c.textMuted }]}>No update from them yet today.</Text>
        )}
      </View>

      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Maybe they had a cozy morning with coffee..."
        placeholderTextColor={c.textMuted}
        multiline
        maxLength={50}
        style={[styles.input, { backgroundColor: c.inputBg, color: c.textPrimary, borderColor: c.border }]}
      />
      <Text style={[styles.counter, { color: c.textMuted }]}>{text.length}/50</Text>
      </ScrollView>

      <Pressable
        onPress={onSend}
        disabled={text.trim().length === 0 || sending}
        style={[styles.sendBtn, { backgroundColor: c.brand.primary, opacity: text.trim().length === 0 ? 0.5 : 1, marginBottom: insets.bottom + 12 }]}
      >
        <Text style={styles.sendText}>{sending ? 'Sending...' : 'Send guess'}</Text>
      </Pressable>
    </View>
    </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  back: { alignSelf: 'flex-start', paddingVertical: 8 },
  h1: { fontSize: 24, fontFamily: 'Inter_700Bold', marginTop: 8 },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 6, marginBottom: 20, lineHeight: 20 },

  emojiCard: { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: 'center', marginBottom: 20 },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  emoji: { fontSize: 34 },
  noUpdate: { fontSize: 14, fontFamily: 'Inter_400Regular' },

  input: { borderWidth: 1, borderRadius: 14, padding: 16, fontSize: 16, fontFamily: 'Inter_400Regular', minHeight: 90, textAlignVertical: 'top' },
  counter: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'right', marginTop: 6 },

  sendBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  sendText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
});

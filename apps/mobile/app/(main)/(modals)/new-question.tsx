/**
 * New Question — Stage 3.9.A.1.4
 *
 * User-submitted question entry. Posted to /api/user-questions which
 * stores the question with status='pending'. Admin reviews + assigns
 * a tag in the admin dashboard before publishing it to the Discover
 * feed.
 *
 * Constraints (server-enforced — mirrored client-side):
 *   - questionText required, trimmed length 10..200
 *   - tag is NOT chosen by the user (admin assigns on approval)
 *
 * Flow:
 *   - On Submit: POST -> show success toast -> auto router.back() after 1.5s
 *   - On error : show error toast, keep form intact for retry
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiClient } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Toast, type ToastVariant } from '@/components/ui/toast';
import { haptics } from '@/lib/haptics';

const MIN_LEN = 10;
const MAX_LEN = 200;

export default function NewQuestionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: ToastVariant } | null>(null);
  const [kbHeight, setKbHeight] = useState(0);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  // Track iOS keyboard height so the submit footer can sit just above
  // it. We use the willShow/willHide pair on iOS for in-sync animation
  // with the system; Android falls back to didShow/didHide which fire
  // after the keyboard frame settles.
  useEffect(() => {
    const showEvt = 'keyboardWillShow';
    const hideEvt = 'keyboardWillHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKbHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const trimmed = text.trim();
  const len = trimmed.length;
  const tooShort = len > 0 && len < MIN_LEN;
  const tooLong = len > MAX_LEN;
  const canSubmit = !submitting && len >= MIN_LEN && !tooLong;

  const counterColor = tooLong
    ? '#F87171'
    : len > MAX_LEN - 30
      ? '#FBBF24'
      : 'rgba(255,255,255,0.45)';

  const showToast = (msg: string, variant: ToastVariant, autoBackMs?: number) => {
    setToast({ msg, variant });
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (autoBackMs) {
      dismissTimer.current = setTimeout(() => {
        router.back();
      }, autoBackMs);
    } else {
      // Auto-hide after 3s if not auto-navigating
      dismissTimer.current = setTimeout(() => setToast(null), 3000);
    }
  };

  const onSubmit = async () => {
    void haptics.light();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        showToast('Please sign in first', 'error');
        setSubmitting(false);
        return;
      }
      await apiClient.request<{ success?: boolean; error?: string }>(
        'POST',
        '/api/user-questions',
        { userId, questionText: trimmed },
      );
      showToast('Question submitted — awaiting review', 'success', 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Submission failed';
      showToast(msg, 'error');
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable onPress={() => { void haptics.light(); router.back(); }} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.topTitle}>Ask New Question</Text>
        <View style={styles.topBarSpacer} />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Lead copy */}
        <Text style={styles.lead}>
          Share what you{'\u2019'}re wrestling with. The community will offer wisdom in response.
        </Text>

        {/* Textarea */}
        <View style={styles.inputWrap}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            maxLength={MAX_LEN + 50 /* allow over-input so the counter can warn */}
            placeholder="Ask the community something..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            style={styles.input}
            editable={!submitting}
            autoFocus
            textAlignVertical="top"
          />
          <View style={styles.counterRow}>
            {tooShort ? (
              <Text style={styles.helperText}>At least {MIN_LEN} characters</Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <Text style={[styles.counter, { color: counterColor }]}>
              {len}/{MAX_LEN}
            </Text>
          </View>
        </View>

        <Text style={styles.note}>
          Note: a moderator will review your question before it appears in Discover.
        </Text>
      </ScrollView>

      {/* Submit — bottom: keyboard height when open, else safe-area inset */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom: kbHeight > 0 ? 12 : insets.bottom + 12,
            transform: [{ translateY: -kbHeight }],
          },
        ]}
      >
        <Pressable
          onPress={onSubmit}
          disabled={!canSubmit}
          style={[styles.submitWrap, !canSubmit && styles.submitWrapDisabled]}
        >
          <LinearGradient
            colors={canSubmit ? ['#A855F7', '#7C3AED'] : ['#3F3565', '#332B52']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.submitBtn}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <MaterialIcons name="send" size={18} color="#FFFFFF" />
                <Text style={styles.submitText}>Submit Question</Text>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </View>

      {/* Toast */}
      {toast ? <Toast visible={!!toast} message={toast.msg} variant={toast.variant} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  topBarSpacer: {
    width: 40,
    height: 40,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  lead: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  inputWrap: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
  },
  input: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 22,
    minHeight: 140,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  helperText: {
    color: 'rgba(251,191,36,0.85)',
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  counter: {
    fontSize: 12,
    fontWeight: '700',
  },
  note: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    marginTop: 16,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(15,11,46,0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  submitWrap: {
    borderRadius: 999,
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 5,
  },
  submitWrapDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 999,
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

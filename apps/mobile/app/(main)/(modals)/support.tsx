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
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import {
  type SupportCategory,
  submitSupportTicket,
} from '@/lib/support-api';

/**
 * Support overlay -- Stage 3.10.2 C3.
 *
 * 5-category picker + email + subject + message -> POST support-ticket.
 * Validation is inline (status banner at the top, mirrors C1 Account
 * Management); native Alert is reserved for destructive flows only.
 *
 * On success the form is replaced with a confirmation screen ("Message
 * Sent!" + the email we'll reply to + Done button). The fallback hint
 * "Or email us directly at support@soulsayit.com" is shown beneath the
 * Send button so a user with persistent network problems still has a
 * path -- mirrors old web SupportOverlay.js verbatim.
 */

const SUPPORT_EMAIL = 'support@soulsayit.com';

type CategoryDef = {
  id: SupportCategory;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
};

const CATEGORIES: CategoryDef[] = [
  { id: 'bug', label: 'Bug Report', icon: 'bug-report' },
  { id: 'feature', label: 'Feature Request', icon: 'lightbulb' },
  { id: 'billing', label: 'Billing Issue', icon: 'credit-card' },
  { id: 'account', label: 'Account Help', icon: 'person' },
  { id: 'other', label: 'Other', icon: 'help' },
];

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string };

export default function SupportModal() {
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<string | null>(null);
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [email, setEmail] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [sent, setSent] = useState(false);
  const [sentToEmail, setSentToEmail] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const user = data.session?.user;
      setUserId(user?.id ?? null);
      setEmail(user?.email ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClose = () => {
    void haptics.light();
    router.back();
  };

  const handleSelectCategory = (id: SupportCategory) => {
    void haptics.light();
    setCategory(id);
    if (status.kind === 'error') setStatus({ kind: 'idle' });
  };

  const handleSend = async () => {
    void haptics.light();
    if (busy) return;
    if (!userId) {
      setStatus({ kind: 'error', text: 'Not signed in. Please re-launch the app.' });
      return;
    }
    if (!category) {
      setStatus({ kind: 'error', text: 'Please pick a category.' });
      return;
    }
    if (!email.includes('@')) {
      setStatus({ kind: 'error', text: 'Please enter a valid email.' });
      return;
    }
    const trimSubject = subject.trim();
    const trimMessage = message.trim();
    if (!trimSubject) {
      setStatus({ kind: 'error', text: 'Please enter a subject.' });
      return;
    }
    if (!trimMessage) {
      setStatus({ kind: 'error', text: 'Please enter a message.' });
      return;
    }

    setBusy(true);
    void haptics.medium();
    const res = await submitSupportTicket({
      userId,
      email: email.trim(),
      category,
      subject: trimSubject,
      message: trimMessage,
    });
    setBusy(false);

    if (res.kind === 'success') {
      void haptics.success();
      setSentToEmail(email.trim());
      setSent(true);
    } else {
      void haptics.error();
      setStatus({ kind: 'error', text: res.message });
    }
  };

  // ---- Sent confirmation view ----

  if (sent) {
    return (
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.headerTitle}>Support</Text>
          <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={styles.sentBody}>
          <Text style={styles.sentEmoji}>✅</Text>
          <Text style={styles.sentTitle}>Message Sent!</Text>
          <Text style={styles.sentDesc}>
            We've received your message and will respond to{' '}
            <Text style={styles.sentEmail}>{sentToEmail}</Text> within 24-48
            hours.
          </Text>
          <Pressable
            onPress={handleClose}
            style={({ pressed }) => [
              styles.primaryBtn,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.primaryBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---- Form view ----

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingTop: insets.top + 16,
              paddingBottom: insets.bottom + 32,
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Support</Text>
            <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
              <MaterialIcons name="close" size={20} color="#FFFFFF" />
            </Pressable>
          </View>

          {status.kind !== 'idle' ? (
            <View
              style={[
                styles.statusBanner,
                status.kind === 'success' && styles.statusSuccess,
                status.kind === 'error' && styles.statusError,
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  status.kind === 'success' && { color: '#4ADE80' },
                  status.kind === 'error' && { color: '#F87171' },
                ]}
              >
                {status.kind === 'success' ? '✓ ' : ''}
                {status.text}
              </Text>
            </View>
          ) : null}

          {/* Category */}
          <Text style={styles.sectionLabel}>What can we help with?</Text>
          <View style={styles.categoryGrid}>
            {CATEGORIES.map((cat) => {
              const selected = category === cat.id;
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => { void haptics.light(); handleSelectCategory(cat.id); }}
                  style={({ pressed }) => [
                    styles.categoryBtn,
                    selected && styles.categoryBtnSelected,
                    { opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <MaterialIcons
                    name={cat.icon}
                    size={18}
                    color={selected ? '#C084FC' : 'rgba(255,255,255,0.4)'}
                  />
                  <Text
                    style={[
                      styles.categoryLabel,
                      selected && styles.categoryLabelSelected,
                    ]}
                  >
                    {cat.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Email */}
          <Text style={styles.sectionLabel}>Your Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Where should we reply?"
            placeholderTextColor="rgba(255,255,255,0.3)"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          {/* Subject */}
          <Text style={styles.sectionLabel}>Subject</Text>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            placeholder="Brief description of your issue"
            placeholderTextColor="rgba(255,255,255,0.3)"
            style={styles.input}
          />

          {/* Message */}
          <Text style={styles.sectionLabel}>Message</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Please describe your issue in detail..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            style={[styles.input, styles.messageInput]}
          />

          {/* Send */}
          <Pressable
            onPress={handleSend}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryBtn,
              { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
            ]}
          >
            {busy ? (
              <View style={styles.btnContentRow}>
                <ActivityIndicator color="#FFFFFF" size="small" />
                <Text style={[styles.primaryBtnText, { marginLeft: 8 }]}>
                  Sending...
                </Text>
              </View>
            ) : (
              <View style={styles.btnContentRow}>
                <MaterialIcons name="send" size={18} color="#FFFFFF" />
                <Text style={[styles.primaryBtnText, { marginLeft: 8 }]}>
                  Send Message
                </Text>
              </View>
            )}
          </Pressable>

          {/* Direct email fallback */}
          <Text style={styles.fallbackText}>
            Or email us directly at{' '}
            <Text style={styles.fallbackEmail}>{SUPPORT_EMAIL}</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---- styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  scroll: {
    paddingHorizontal: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Status
  statusBanner: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  statusSuccess: { backgroundColor: 'rgba(34,197,94,0.15)' },
  statusError: { backgroundColor: 'rgba(239,68,68,0.15)' },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  // Section
  sectionLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4,
  },
  // Category
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  categoryBtn: {
    flexBasis: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  categoryBtnSelected: {
    backgroundColor: 'rgba(168,85,247,0.15)',
    borderColor: 'rgba(168,85,247,0.5)',
  },
  categoryLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
  },
  categoryLabelSelected: {
    color: '#C084FC',
  },
  // Inputs
  input: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: '#FFFFFF',
    fontSize: 14,
    marginBottom: 16,
  },
  messageInput: {
    minHeight: 130,
    paddingTop: 12,
  },
  // Primary button
  primaryBtn: {
    paddingVertical: 16,
    backgroundColor: '#7C3AED',
    borderRadius: 16,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 8,
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  // Fallback
  fallbackText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  fallbackEmail: {
    color: '#C084FC',
  },
  // Sent
  sentBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  sentEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  sentTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
  sentDesc: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  sentEmail: {
    color: '#C084FC',
    fontWeight: '600',
  },
});

import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { haptics } from '@/lib/haptics';
import { signOut } from '@/lib/auth';
import { getBunnyName } from '@/lib/onboarding';
import {
  DEFAULT_AVATAR_OPTIONS,
  getDefaultAvatarId,
  isDefaultAvatarId,
  resolveAvatarSource,
  type DefaultAvatarId,
} from '@/lib/avatar';
import { supabase } from '@/lib/supabase';
import {
  deleteAccount,
  requestAccountReauthentication,
  updateDefaultAvatar,
  updateDisplayName,
  updateEmail,
} from '@/lib/account-api';
import {
  clearCachedMeStats,
  fetchMeStats,
  getCachedMeStats,
  invalidateMeStats,
} from '@/lib/me-stats';
import { clearCachedSubscription } from '@/lib/subscription';

/**
 * Account Management overlay -- Stage 3.10.2 C1.
 *
 * 3-section accordion (Change Avatar / Display Name / Email)
 * + Danger Zone (Delete Account). Each section opens independently and
 * has its own Save action and inline status message.
 *
 * Source-of-truth for current values:
 *   - displayName / avatarUrl: from me-stats cache (warmed by Home tab).
 *     We re-read on mount and after each successful save so the UI
 *     reflects what the server now has.
 *   - email: from supabase.auth.getSession() -- not in me-stats because
 *     email lives in auth.users, not profiles.
 *
 * After avatar / display-name save, we invalidate me-stats and fire a
 * silent refetch so when the user closes this overlay and goes back to
 * the Me page the new value is already in cache.
 *
 * Avatar UX: users choose from the ten bundled profile portraits. The
 * selected id is saved immediately and contains no user-uploaded media.
 */

type Section = 'avatar' | 'name' | 'email' | null;

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string };

export default function AccountManagementModal() {
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<string | null>(null);
  // display_name is auto-seeded at signup ('user' for guests) — a literal
  // 'user' is placeholder noise; the onboarding name outranks it. Same
  // resolution as the Me page header.
  const resolveName = (raw: string | undefined) =>
    (raw && raw !== 'user' ? raw : '') || getBunnyName() || '';
  const [displayName, setDisplayName] = useState<string>(
    () => resolveName(getCachedMeStats()?.displayName),
  );
  const [avatarUrl, setAvatarUrl] = useState<string>(
    () => getCachedMeStats()?.avatarUrl ?? '',
  );
  const [isDefaultAvatar, setIsDefaultAvatar] = useState<boolean | undefined>(
    () => getCachedMeStats()?.isDefaultAvatar,
  );
  const [email, setEmail] = useState<string>('');

  const [openSection, setOpenSection] = useState<Section>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const selectedDefaultAvatarId = isDefaultAvatar !== false
    ? (isDefaultAvatarId(avatarUrl) ? avatarUrl : getDefaultAvatarId(userId))
    : null;

  // Section-local input state
  const [nameInput, setNameInput] = useState<string>('');
  const [emailInput, setEmailInput] = useState<string>('');
  const [reauthCode, setReauthCode] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const u = data.session?.user;
      setUserId(u?.id ?? null);
      setEmail(u?.email ?? '');
      setEmailInput(u?.email ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshFromCache = () => {
    const cached = getCachedMeStats();
    if (cached) {
      setDisplayName(resolveName(cached.displayName));
      setAvatarUrl(cached.avatarUrl);
      setIsDefaultAvatar(cached.isDefaultAvatar);
    }
  };

  const handleClose = () => {
    void haptics.light();
    router.back();
  };

  const toggleSection = (id: Exclude<Section, null>) => {
    void haptics.light();
    setStatus({ kind: 'idle' });
    setReauthCode('');
    if (openSection === id) {
      setOpenSection(null);
      return;
    }
    if (id === 'name') setNameInput(displayName);
    if (id === 'email') setEmailInput(email);
    setOpenSection(id);
  };

  // ---- Bundled avatar selection ----

  const handleSelectAvatar = async (avatarId: DefaultAvatarId) => {
    void haptics.light();
    if (!userId || busy) return;
    if (isDefaultAvatar && avatarUrl === avatarId) return;
    setStatus({ kind: 'idle' });
    setBusy(true);
    void haptics.medium();
    const res = await updateDefaultAvatar(userId, avatarId);
    setBusy(false);

    if (res.kind === 'success') {
      setAvatarUrl(avatarId);
      setIsDefaultAvatar(true);
      setStatus({ kind: 'success', text: 'Avatar updated.' });
      void haptics.success();
      invalidateMeStats();
      void fetchMeStats(userId, { force: true }).then(refreshFromCache).catch(() => {});
    } else {
      setStatus({ kind: 'error', text: res.message });
      void haptics.error();
    }
  };

  // ---- Display name save ----

  const handleSaveName = async () => {
    if (!userId || busy) return;
    const trimmed = nameInput.trim().slice(0, 15);
    if (!trimmed) {
      setStatus({ kind: 'error', text: 'Display name cannot be empty.' });
      return;
    }
    setBusy(true);
    void haptics.medium();
    const res = await updateDisplayName(userId, trimmed);
    setBusy(false);
    if (res.kind === 'success') {
      setDisplayName(trimmed);
      setStatus({ kind: 'success', text: 'Display name updated.' });
      void haptics.success();
      invalidateMeStats();
      void fetchMeStats(userId).then(refreshFromCache).catch(() => {});
      setOpenSection(null);
    } else {
      setStatus({ kind: 'error', text: res.message });
      void haptics.error();
    }
  };

  // ---- Email save ----

  const handleSendSecurityCode = async () => {
    if (busy) return;
    setBusy(true);
    void haptics.medium();
    const res = await requestAccountReauthentication();
    setBusy(false);
    if (res.kind === 'success') {
      setStatus({ kind: 'success', text: 'Security code sent to your current email.' });
      void haptics.success();
    } else {
      setStatus({ kind: 'error', text: res.message });
      void haptics.error();
    }
  };

  const handleSaveEmail = async () => {
    if (!userId || busy) return;
    if (!emailInput.includes('@')) {
      setStatus({ kind: 'error', text: 'Please enter a valid email.' });
      return;
    }
    if (reauthCode.trim().length < 6) {
      setStatus({ kind: 'error', text: 'Enter the security code sent to your current email.' });
      return;
    }
    setBusy(true);
    void haptics.medium();
    const res = await updateEmail(userId, emailInput.trim(), reauthCode.trim());
    setBusy(false);
    if (res.kind === 'success') {
      setStatus({
        kind: 'success',
        text: `Verification email sent to ${emailInput.trim()}.`,
      });
      void haptics.success();
      setReauthCode('');
    } else {
      setStatus({ kind: 'error', text: res.message });
      void haptics.error();
    }
  };

  // ---- Delete account ----

  const handleDeleteAccount = () => {
    void haptics.light();
    appAlert(
      'Delete Account?',
      'This permanently deletes your account, wisdoms, cards, and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            appAlert(
              'Final Confirmation',
              'Are you absolutely sure? Once deleted, your data cannot be recovered.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete Forever',
                  style: 'destructive',
                  onPress: doDeleteAccount,
                },
              ],
            );
          },
        },
      ],
    );
  };

  const doDeleteAccount = async () => {
    if (!userId || busy) return;
    setBusy(true);
    void haptics.warning();
    const res = await deleteAccount(userId);
    if (res.kind === 'error') {
      setBusy(false);
      setStatus({ kind: 'error', text: res.message });
      void haptics.error();
      return;
    }
    // Server already destroyed the user. Clear local caches + sign out.
    clearCachedMeStats();
    clearCachedSubscription();
    await signOut();
    router.replace('/');
  };

  // ---- Render ----

  return (
    <View style={styles.root}>
      {/* iOS automatically adjusts form fields above the keyboard; Android
          relies on the KAV 'height' behavior. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? undefined : 'height'}
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
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Account Management</Text>
          <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* Status banner */}
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
                status.kind === 'success' && { color: '#3E7C4F' },
                status.kind === 'error' && { color: '#C25B4E' },
              ]}
            >
              {status.kind === 'success' ? '✓ ' : ''}
              {status.text}
            </Text>
          </View>
        ) : null}

        {/* Bundled profile avatar */}
        <SectionHeader
          label="Change Avatar"
          summary="Choose an avatar"
          open={openSection === 'avatar'}
          onPress={() => toggleSection('avatar')}
        />
        {openSection === 'avatar' ? (
          <View style={styles.sectionBody}>
            <Text style={styles.avatarPickerTitle}>Choose your avatar</Text>
            <View style={styles.avatarGrid}>
              {DEFAULT_AVATAR_OPTIONS.map((option) => {
                const selected = selectedDefaultAvatarId === option.id;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityLabel={`Avatar ${option.id.replace('default-', '')}`}
                    accessibilityState={{ selected }}
                    disabled={busy}
                    onPress={() => void handleSelectAvatar(option.id)}
                    style={({ pressed }) => [
                      styles.avatarOption,
                      selected && styles.avatarOptionSelected,
                      pressed && !busy && styles.avatarOptionPressed,
                    ]}
                  >
                    <Image
                      source={option.source}
                      style={styles.avatarOptionImage}
                      contentFit="cover"
                      contentPosition="center"
                    />
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.currentAvatarRow}>
              <View style={styles.avatarWrap}>
                <Image
                  source={resolveAvatarSource(avatarUrl, isDefaultAvatar, userId)}
                  style={styles.avatarImg}
                  contentFit="cover"
                  contentPosition="center"
                />
              </View>
              <Text style={styles.currentAvatarText}>
                {busy ? 'Saving…' : 'Current avatar'}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Display Name */}
        <SectionHeader
          label="Display Name"
          summary={displayName || 'Not set'}
          open={openSection === 'name'}
          onPress={() => toggleSection('name')}
        />
        {openSection === 'name' ? (
          <View style={styles.sectionBody}>
            <TextInput
              value={nameInput}
              onChangeText={(t) => setNameInput(t.slice(0, 15))}
              placeholder="Your name"
              placeholderTextColor="#B8A588"
              maxLength={15}
              style={styles.input}
              autoCapitalize="words"
              autoCorrect={false}
            />
            <Text style={styles.charCount}>{nameInput.length}/15</Text>
            <PrimaryBtn label="Save" busy={busy} onPress={handleSaveName} />
          </View>
        ) : null}

        {/* Email */}
        <SectionHeader
          label="Email"
          summary={email || 'Not set'}
          open={openSection === 'email'}
          onPress={() => toggleSection('email')}
        />
        {openSection === 'email' ? (
          <View style={styles.sectionBody}>
            <TextInput
              value={emailInput}
              onChangeText={setEmailInput}
              placeholder="New email"
              placeholderTextColor="#B8A588"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Text style={styles.helperText}>
              Confirm with a security code sent to your current email. The new email must also be verified.
            </Text>
            <PrimaryBtn label="Send Security Code" busy={busy} onPress={handleSendSecurityCode} />
            <TextInput
              value={reauthCode}
              onChangeText={(text) => setReauthCode(text.replace(/\D/g, '').slice(0, 8))}
              placeholder="Security code"
              placeholderTextColor="#B8A588"
              keyboardType="number-pad"
              autoCapitalize="none"
              style={[styles.input, { marginTop: 12 }]}
            />
            <PrimaryBtn label="Send Verification" busy={busy} onPress={handleSaveEmail} />
          </View>
        ) : null}

        {/* Danger Zone */}
        <View style={styles.dangerZone}>
          <Text style={styles.dangerLabel}>DANGER ZONE</Text>
          <Pressable
            onPress={handleDeleteAccount}
            disabled={busy}
            style={({ pressed }) => [
              styles.deleteBtn,
              { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.deleteBtnText}>Delete Account</Text>
          </Pressable>
          <Text style={styles.dangerHint}>
            This permanently deletes your account and all data.
          </Text>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---- sub-components ----

type SectionHeaderProps = {
  label: string;
  summary: string;
  open: boolean;
  onPress: () => void;
};

function SectionHeader({ label, summary, open, onPress }: SectionHeaderProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.sectionHeader,
        { opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionLabel}>{label}</Text>
        <Text style={styles.sectionSummary} numberOfLines={1}>
          {summary}
        </Text>
      </View>
      <MaterialIcons
        name={open ? 'expand-less' : 'expand-more'}
        size={22}
        color="#C9BCA5"
      />
    </Pressable>
  );
}

type PrimaryBtnProps = {
  label: string;
  busy: boolean;
  onPress: () => void;
};

function PrimaryBtn({ label, busy, onPress }: PrimaryBtnProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.primaryBtn,
        { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <Text style={styles.primaryBtnText}>{label}</Text>
      )}
    </Pressable>
  );
}

// ---- styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F2E6CB',
  },
  scroll: {
    paddingHorizontal: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  headerTitle: {
    color: '#4A3423',
    fontSize: 22,
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#4A3423',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Status
  statusBanner: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  statusSuccess: { backgroundColor: 'rgba(62,124,79,0.12)' },
  statusError: { backgroundColor: 'rgba(194,91,78,0.12)' },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  sectionLabel: {
    color: '#2B2B2B',
    fontSize: 14,
    fontWeight: '700',
  },
  sectionSummary: {
    color: '#8A7A63',
    fontSize: 13,
    marginTop: 2,
  },
  // Section body
  sectionBody: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginTop: -8,
    marginBottom: 16,
  },
  // Avatar
  currentAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 14,
  },
  avatarWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F2E6CB',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarPickerTitle: {
    color: '#4A3423',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    marginBottom: 12,
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  avatarOption: {
    flexBasis: '18%',
    flexGrow: 0,
    flexShrink: 0,
    aspectRatio: 1,
    maxWidth: 64,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: '#E8D5B0',
    backgroundColor: '#F2E6CB',
    padding: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  avatarOptionSelected: {
    borderColor: '#2E8B57',
    borderWidth: 3,
  },
  avatarOptionPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.97 }],
  },
  avatarOptionImage: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
  },
  currentAvatarText: {
    color: '#8A7A63',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  // Inputs
  input: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FBF6EA',
    borderWidth: 1.5,
    borderColor: '#E8D5B0',
    borderRadius: 12,
    color: '#4A3423',
    fontSize: 14,
  },
  charCount: {
    textAlign: 'right',
    color: '#B8A588',
    fontSize: 11,
    marginTop: 6,
    marginBottom: 12,
  },
  helperText: {
    color: '#8A7A63',
    fontSize: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  // Primary button
  primaryBtn: {
    paddingVertical: 12,
    backgroundColor: '#8A6240',
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  // Danger zone
  dangerZone: {
    marginTop: 20,
    paddingTop: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8D5B0',
  },
  dangerLabel: {
    color: '#C25B4E',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  deleteBtn: {
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(194,91,78,0.5)',
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  deleteBtnText: {
    color: '#C25B4E',
    fontSize: 14,
    fontWeight: '600',
  },
  dangerHint: {
    color: '#8A7A63',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },
});

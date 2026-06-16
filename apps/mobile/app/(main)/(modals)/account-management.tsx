import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

import { haptics } from '@/lib/haptics';
import { signOut } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import {
  deleteAccount,
  updateDisplayName,
  updateEmail,
  updatePassword,
  uploadAvatar,
} from '@/lib/account-api';
import {
  clearCachedMeStats,
  fetchMeStats,
  getCachedMeStats,
  invalidateMeStats,
} from '@/lib/me-stats';
import { clearCachedSubscription } from '@/lib/subscription';
import { clearCachedCharacterState } from '@/lib/character-state';

/**
 * Account Management overlay -- Stage 3.10.2 C1.
 *
 * 4-section accordion (Profile Image / Display Name / Email / Password)
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
 * Avatar upload UX (per stage 3.10.2 decision C1-A):
 *   Tap "Upload New" -> launch picker -> on selection upload immediately,
 *   no two-step preview/save. The picker itself is the confirmation step.
 */

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

type Section = 'avatar' | 'name' | 'email' | 'password' | null;

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; text: string }
  | { kind: 'warning'; text: string }
  | { kind: 'error'; text: string };

export default function AccountManagementModal() {
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>(
    () => getCachedMeStats()?.displayName ?? '',
  );
  const [avatarUrl, setAvatarUrl] = useState<string>(
    () => getCachedMeStats()?.avatarUrl ?? '',
  );
  const [email, setEmail] = useState<string>('');

  const [openSection, setOpenSection] = useState<Section>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);

  // Section-local input state
  const [nameInput, setNameInput] = useState<string>('');
  const [emailInput, setEmailInput] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');

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
      setDisplayName(cached.displayName);
      setAvatarUrl(cached.avatarUrl);
    }
  };

  const handleClose = () => {
    void haptics.light();
    router.back();
  };

  const toggleSection = (id: Exclude<Section, null>) => {
    void haptics.light();
    setStatus({ kind: 'idle' });
    if (openSection === id) {
      setOpenSection(null);
      return;
    }
    if (id === 'name') setNameInput(displayName);
    if (id === 'email') setEmailInput(email);
    if (id === 'password') {
      setNewPassword('');
      setConfirmPassword('');
    }
    setOpenSection(id);
  };

  // ---- Avatar upload ----

  const handlePickAndUpload = async () => {
    void haptics.light();
    if (!userId || busy) return;
    setStatus({ kind: 'idle' });

    // Permission
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setStatus({
        kind: 'error',
        text: 'Photo library permission denied. Enable it in Settings.',
      });
      return;
    }

    // Picker
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    // Size check
    try {
      const info = await FileSystem.getInfoAsync(asset.uri);
      if (info.exists && typeof info.size === 'number' && info.size > MAX_AVATAR_BYTES) {
        setStatus({ kind: 'error', text: 'Image too large. Max 5MB allowed.' });
        return;
      }
    } catch {
      // size probe failure isn't fatal; let server reject if needed.
    }

    setBusy(true);
    void haptics.medium();

    // B: normalize the cropped image before upload. iOS allowsEditing
    // returns a square crop, but the file can carry EXIF orientation /
    // non-exact dimensions that make expo-image render it off-center in the
    // circle (square crop, but NOT center-aligned). Re-encoding via
    // manipulateAsync bakes the orientation into pixels and emits a clean
    // square JPEG, so square-crop -> circle-display lands exactly centered.
    let uploadUri = asset.uri;
    try {
      const normalized = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 512 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      uploadUri = normalized.uri;
    } catch (e) {
      console.warn('[avatar] normalize failed; uploading original:', e);
    }

    const res = await uploadAvatar(userId, uploadUri, 'image/jpeg');
    setBusy(false);

    if (res.kind === 'success') {
      setAvatarUrl(res.avatarUrl);
      setStatus({ kind: 'success', text: 'Profile picture updated.' });
      void haptics.success();
      invalidateMeStats();
      void fetchMeStats(userId).catch(() => {});
    } else if (res.kind === 'unsafe') {
      setStatus({ kind: 'warning', text: `Image rejected: ${res.reason}` });
      void haptics.warning();
    } else {
      setStatus({ kind: 'error', text: res.message });
      void haptics.error();
    }
  };

  // ---- Display name save ----

  const handleSaveName = async () => {
    if (!userId || busy) return;
    const trimmed = nameInput.trim().slice(0, 16);
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

  const handleSaveEmail = async () => {
    if (!userId || busy) return;
    if (!emailInput.includes('@')) {
      setStatus({ kind: 'error', text: 'Please enter a valid email.' });
      return;
    }
    setBusy(true);
    void haptics.medium();
    const res = await updateEmail(userId, emailInput.trim());
    setBusy(false);
    if (res.kind === 'success') {
      setStatus({
        kind: 'success',
        text: `Verification email sent to ${emailInput.trim()}.`,
      });
      void haptics.success();
    } else {
      setStatus({ kind: 'error', text: res.message });
      void haptics.error();
    }
  };

  // ---- Password save ----

  const handleSavePassword = async () => {
    if (!userId || busy) return;
    if (newPassword.length < 8) {
      setStatus({ kind: 'error', text: 'Password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus({ kind: 'error', text: "Passwords don't match." });
      return;
    }
    setBusy(true);
    void haptics.medium();
    const res = await updatePassword(userId, newPassword);
    setBusy(false);
    if (res.kind === 'success') {
      setStatus({ kind: 'success', text: 'Password updated.' });
      void haptics.success();
      setNewPassword('');
      setConfirmPassword('');
      setOpenSection(null);
    } else {
      setStatus({ kind: 'error', text: res.message });
      void haptics.error();
    }
  };

  // ---- Delete account ----

  const handleDeleteAccount = () => {
    void haptics.light();
    Alert.alert(
      'Delete Account?',
      'This permanently deletes your account, wisdoms, cards, and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
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
    clearCachedCharacterState();
    await signOut();
    router.replace('/');
  };

  // ---- Render ----

  return (
    <View style={styles.root}>
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
              status.kind === 'warning' && styles.statusWarning,
              status.kind === 'error' && styles.statusError,
            ]}
          >
            <Text
              style={[
                styles.statusText,
                status.kind === 'success' && { color: '#4ADE80' },
                status.kind === 'warning' && { color: '#FACC15' },
                status.kind === 'error' && { color: '#F87171' },
              ]}
            >
              {status.kind === 'success' ? '✓ ' : status.kind === 'warning' ? '⚠ ' : ''}
              {status.text}
            </Text>
          </View>
        ) : null}

        {/* Profile Image */}
        <SectionHeader
          label="Profile Image"
          summary="Tap to change"
          open={openSection === 'avatar'}
          onPress={() => toggleSection('avatar')}
        />
        {openSection === 'avatar' ? (
          <View style={styles.sectionBody}>
            <View style={styles.avatarRow}>
              <View style={styles.avatarWrap}>
                {avatarUrl ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    style={styles.avatarImg}
                    contentFit="cover"
                    contentPosition="center"
                  />
                ) : (
                  <MaterialIcons name="person" size={36} color="#FFFFFF" />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Pressable
                  onPress={handlePickAndUpload}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.uploadBtn,
                    { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.uploadBtnText}>Upload New</Text>
                  )}
                </Pressable>
                <Text style={styles.avatarHint}>Max 5MB, JPG/PNG</Text>
              </View>
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
              onChangeText={(t) => setNameInput(t.slice(0, 16))}
              placeholder="Your name"
              placeholderTextColor="rgba(255,255,255,0.3)"
              maxLength={16}
              style={styles.input}
              autoCapitalize="words"
              autoCorrect={false}
            />
            <Text style={styles.charCount}>{nameInput.length}/16</Text>
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
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Text style={styles.helperText}>
              A verification email will be sent to confirm the change.
            </Text>
            <PrimaryBtn label="Send Verification" busy={busy} onPress={handleSaveEmail} />
          </View>
        ) : null}

        {/* Password */}
        <SectionHeader
          label="Password"
          summary={'\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
          open={openSection === 'password'}
          onPress={() => toggleSection('password')}
        />
        {openSection === 'password' ? (
          <View style={styles.sectionBody}>
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password (min 8)"
              placeholderTextColor="rgba(255,255,255,0.3)"
              secureTextEntry
              style={styles.input}
            />
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm password"
              placeholderTextColor="rgba(255,255,255,0.3)"
              secureTextEntry
              style={[styles.input, { marginTop: 12 }]}
            />
            <PrimaryBtn label="Change Password" busy={busy} onPress={handleSavePassword} />
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
        color="rgba(255,255,255,0.4)"
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
    backgroundColor: '#0F0B2E',
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
  statusWarning: { backgroundColor: 'rgba(250,204,21,0.15)' },
  statusError: { backgroundColor: 'rgba(239,68,68,0.15)' },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  sectionLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  sectionSummary: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    marginTop: 2,
  },
  // Section body
  sectionBody: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 16,
    marginTop: -8,
    marginBottom: 16,
  },
  // Avatar
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#7C3AED',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  uploadBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  uploadBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  avatarHint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    marginTop: 6,
  },
  // Inputs
  input: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    color: '#FFFFFF',
    fontSize: 14,
  },
  charCount: {
    textAlign: 'right',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    marginTop: 6,
    marginBottom: 12,
  },
  helperText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  // Primary button
  primaryBtn: {
    paddingVertical: 12,
    backgroundColor: '#7C3AED',
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
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  dangerLabel: {
    color: '#F87171',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  deleteBtn: {
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
    borderRadius: 12,
    alignItems: 'center',
  },
  deleteBtnText: {
    color: '#F87171',
    fontSize: 14,
    fontWeight: '600',
  },
  dangerHint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },
});

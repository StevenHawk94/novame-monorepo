import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { appAlert } from '@/components/ui/app-dialog';
import { haptics } from '@/lib/haptics';
import { GridBackground } from '@/components/ui/grid-background';
import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { kConnectedAccount } from '@/shared/storage/keys';
import {
  connectProviderOrSignIn,
  sendPasswordlessEmailOtp,
  verifyPasswordlessEmailOtp,
  type PasswordlessEmailMode,
} from '@/lib/auth';

/**
 * Connect Account (2026-08-07): standalone entry for binding the anonymous
 * guest account to Apple / Google / email — reachable from the Menu and from
 * the post-purchase safety prompt. Mirrors the onboarding connect step's UI;
 * once the account is already connected it shows a confirmation state.
 */
export default function ConnectAccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ after?: string }>();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // 'enter' → email form; 'verify' → the 6-digit code sent to that email.
  const [emailPhase, setEmailPhase] = useState<'enter' | 'verify'>('enter');
  // 'change' binds the address to this account; 'login' recovers the old
  // account the address already belongs to (smart-connect fallback).
  const [emailMode, setEmailMode] = useState<PasswordlessEmailMode>('change');
  const [busy, setBusy] = useState(false);
  // Cache-first: paint the bound state instantly from the stored value; the
  // getUser() fetch below only reconciles (and updates the cache).
  const [connectedAs, setConnectedAs] = useState<string | null>(
    () => storage.getString(kConnectedAccount.name) ?? null,
  );

  const finish = () => {
    if (params.after === 'notification-settings') {
      void haptics.pageOpen();
      router.replace('/(main)/(modals)/notification-settings' as never);
    } else {
      router.back();
    }
  };

  const continueAfterAccountRestore = () => {
    void haptics.pageOpen();
    router.replace({
      pathname: '/(auth)/signing-in',
      params: params.after === 'notification-settings'
        ? { after: 'notification-settings' }
        : {},
    } as never);
  };

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      const anonymous = (u as { is_anonymous?: boolean }).is_anonymous ?? false;
      if (!anonymous || u.email) {
        const label = u.email ?? 'your account';
        setConnectedAs(label);
        storage.set(kConnectedAccount.name, label);
      } else {
        setConnectedAs(null);
        storage.remove(kConnectedAccount.name);
      }
    });
  }, []);

  /** Post-link: fetch the (new) bound email once and remember it. */
  function refreshConnected() {
    void supabase.auth.getUser().then(({ data }) => {
      const label = data.user?.email ?? 'your account';
      setConnectedAs(label);
      storage.set(kConnectedAccount.name, label);
    });
  }

  async function onProvider(provider: 'apple' | 'google') {
    if (busy) return;
    void haptics.pageOpen();
    setBusy(true);
    const res = await connectProviderOrSignIn(provider);
    setBusy(false);
    if (res.ok && res.mode === 'linked') {
      refreshConnected();
      appAlert('Account connected', 'Your memories are now safe on this account.', [
        { text: 'OK', onPress: finish },
      ]);
    } else if (res.ok) {
      // Recovered an existing account — reload every cache as that user.
      void haptics.success();
      appAlert('Welcome back!', 'Your account and memories have been restored.', [
        { text: 'OK', onPress: continueAfterAccountRestore },
      ]);
    } else if (!res.cancelled) {
      appAlert('Could not connect', res.error ?? 'Please try again.');
    }
  }

  async function onEmail() {
    const addr = email.trim();
    if (!addr.includes('@') || busy) return;
    void haptics.light();
    setBusy(true);
    const result = await sendPasswordlessEmailOtp(addr);
    setBusy(false);
    if (!result.ok || !result.mode) {
      appAlert('Could not connect', result.error ?? 'Please try again.');
      return;
    }
    setEmailMode(result.mode);
    setEmailPhase('verify');
  }

  async function onVerifyCode() {
    const token = code.trim();
    if (token.length !== 6 || busy) return;
    void haptics.light();
    setBusy(true);
    const res = await verifyPasswordlessEmailOtp(email.trim(), token, emailMode);
    setBusy(false);
    if (!res.ok) {
      appAlert('Wrong code', res.error ?? 'Double-check the 6-digit code and try again.');
      return;
    }
    void haptics.success();
    if (emailMode === 'change') {
      refreshConnected();
      appAlert('Account connected', 'Your memories are now safe on this account.', [
        { text: 'OK', onPress: finish },
      ]);
    } else {
      appAlert('Welcome back!', 'Your account and memories have been restored.', [
        { text: 'OK', onPress: continueAfterAccountRestore },
      ]);
    }
  }

  return (
    <View style={styles.root}>
      <GridBackground />
      <View style={[styles.inner, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={finish} style={styles.closeCircle} hitSlop={10}>
          <MaterialIcons name="close" size={22} color="#FFFFFF" />
        </Pressable>

        <View style={styles.center}>
          <Text style={styles.h1}>Connect Your Account</Text>
          {connectedAs ? (
            <>
              <Text style={styles.body}>
                You&apos;re connected as {connectedAs}.{'\n'}Your memories are safe.
              </Text>
              <MaterialIcons name="check-circle" size={54} color="#7BB661" style={{ marginTop: 26, alignSelf: 'center' }} />
            </>
          ) : (
            <>
              <Text style={styles.body}>
                To keep your data safe, we recommend you connect an account for Burrow.
              </Text>
              <View style={{ height: 30 }} />
              {Platform.OS === 'ios' && (
                <Pressable
                  onPress={() => void onProvider('apple')}
                  disabled={busy}
                  style={[styles.authBtn, busy && { opacity: 0.6 }]}
                >
                  <Text style={styles.authBtnText}>{' Sign in with Apple'}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => void onProvider('google')}
                disabled={busy}
                style={[styles.authBtn, busy && { opacity: 0.6 }]}
              >
                <Text style={styles.authBtnText}>{'G  Continue with Google'}</Text>
              </Pressable>
              {emailPhase === 'enter' ? (
                <>
                  <TextInput
                    style={styles.emailInput}
                    placeholder="you@example.com"
                    placeholderTextColor="#B7A88F"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                  <Pressable
                    onPress={() => void onEmail()}
                    disabled={busy || !email.includes('@')}
                    style={[styles.cta, { opacity: !email.includes('@') || busy ? 0.5 : 1 }]}
                  >
                    {busy ? <ActivityIndicator color="#FFFFFF" /> : (
                      <Text style={styles.ctaText}>Connect with Email</Text>
                    )}
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.codeHint}>
                    We sent a 6-digit code to {email.trim()}. Enter it below.
                  </Text>
                  <TextInput
                    style={[styles.emailInput, styles.codeInput]}
                    placeholder="123456"
                    placeholderTextColor="#B7A88F"
                    value={code}
                    onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    autoFocus
                    maxLength={6}
                  />
                  <Pressable
                    onPress={() => void onVerifyCode()}
                    disabled={busy || code.length !== 6}
                    style={[styles.cta, { opacity: code.length !== 6 || busy ? 0.5 : 1 }]}
                  >
                    {busy ? <ActivityIndicator color="#FFFFFF" /> : (
                      <Text style={styles.ctaText}>Verify Code</Text>
                    )}
                  </Pressable>
                  <Pressable onPress={() => { void haptics.pageOpen(); setEmailPhase('enter'); setCode(''); }} hitSlop={8}>
                    <Text style={styles.backLink}>Use a different email</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8E2C1' },
  inner: { flex: 1, paddingHorizontal: 24 },
  closeCircle: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#5C3A24',
    alignItems: 'center', justifyContent: 'center',
  },
  center: { flex: 1, justifyContent: 'center', paddingBottom: 70 },
  h1: { fontSize: 27, lineHeight: 36, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', textAlign: 'center' },
  body: {
    fontSize: 16, lineHeight: 24, fontFamily: 'Inter_500Medium', color: '#3A2E1A',
    textAlign: 'center', marginTop: 14,
  },
  authBtn: {
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 17,
    alignItems: 'center', marginBottom: 14,
  },
  authBtnText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#161311' },
  emailInput: {
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 17, paddingHorizontal: 18,
    fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#2A2118',
    marginTop: 6, textAlign: 'center',
  },
  codeHint: {
    fontSize: 14, lineHeight: 21, fontFamily: 'Inter_500Medium', color: '#6B5B44',
    textAlign: 'center', marginBottom: 12,
  },
  codeInput: { letterSpacing: 8, fontSize: 22, fontFamily: 'Inter_800ExtraBold' },
  backLink: {
    fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#8A6240',
    textAlign: 'center', marginTop: 16, textDecorationLine: 'underline',
  },
  cta: {
    backgroundColor: '#4A3423', borderRadius: 22, alignItems: 'center',
    paddingVertical: 17, marginTop: 14,
  },
  ctaText: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
});

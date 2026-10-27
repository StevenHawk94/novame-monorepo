import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable,
  StyleSheet, Text, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';

import { appAlert } from '@/components/ui/app-dialog';
import { haptics } from '@/lib/haptics';
import { ConnectAccountView } from '@/components/auth/connect-account-view';
import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { kConnectedAccount } from '@/shared/storage/keys';
import { logRegistration } from '@/lib/ad-measurement';
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
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string; authError?: string }>();
  const handledAuthError = useRef<string | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // 'enter' → email form; 'verify' → the 6-digit code sent to that email.
  const [emailPhase, setEmailPhase] = useState<'enter' | 'verify'>('enter');
  // 'change' binds the address to this account; 'login' recovers the old
  // account the address already belongs to (smart-connect fallback).
  const [emailMode, setEmailMode] = useState<PasswordlessEmailMode>('change');
  const [busy, setBusy] = useState(false);
  const [exitApproved, setExitApproved] = useState(false);
  // Cache-first: paint the bound state instantly from the stored value; the
  // getUser() fetch below only reconciles (and updates the cache).
  const [connectedAs, setConnectedAs] = useState<string | null>(
    () => storage.getString(kConnectedAccount.name) ?? null,
  );

  const finish = useCallback(() => {
    // The guard below also sees programmatic navigation. Disable it first,
    // then navigate on the next task so React has committed the new state.
    setExitApproved(true);
    setTimeout(() => {
      void haptics.pageClose();
      router.back();
    }, 0);
  }, [router]);

  const confirmClose = useCallback(() => {
    appAlert(
      'Keep your account safe',
      'We strongly recommend connecting an account. This helps keep your data and memories safe and recoverable if you change phones, reinstall the app, or clear app data.',
      [
        { text: 'Close Anyway', style: 'cancel', onPress: finish },
        { text: 'Keep Connecting' },
      ],
    );
  }, [finish]);

  // Cover the close button, Android system Back and iOS modal swipe-down.
  // Menu-opened account settings remain freely dismissible; this extra layer
  // applies only to the account prompt immediately following a purchase.
  usePreventRemove(
    params.source === 'post-purchase' && !connectedAs && !exitApproved,
    confirmClose,
  );

  const continueAfterAccountRestore = () => {
    void haptics.pageOpen();
    router.replace({
      pathname: '/(auth)/signing-in',
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

  useEffect(() => {
    if (!params.authError || handledAuthError.current === params.authError) return;
    handledAuthError.current = params.authError;
    appAlert('Could not connect', params.authError);
  }, [params.authError]);

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
      void supabase.auth.getSession().then(({ data }) => {
        logRegistration(data.session?.user?.id);
      });
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
      void supabase.auth.getSession().then(({ data }) => {
        logRegistration(data.session?.user?.id);
      });
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

  return <ConnectAccountView onClose={() => router.back()} busy={busy} connectedAs={connectedAs}
    onProvider={provider => { void onProvider(provider); }}>
    {emailPhase === 'enter' ? <>
      <TextInput accessibilityLabel="Email address" style={styles.emailInput} placeholder="you@example.com"
        placeholderTextColor="#B7A88F" value={email} onChangeText={setEmail} autoCapitalize="none"
        keyboardType="email-address" autoComplete="email" autoFocus returnKeyType="done" onSubmitEditing={() => void onEmail()}/>
      <Pressable accessibilityRole="button" onPress={() => void onEmail()} disabled={busy || !email.includes('@')}
        style={[styles.cta, { opacity: !email.includes('@') || busy ? .5 : 1 }]}>
        {busy ? <ActivityIndicator color="#FFFFFF"/> : <Text style={styles.ctaText}>Connect with Email</Text>}
      </Pressable>
    </> : <>
      <Text style={styles.codeHint}>We sent a 6-digit code to {email.trim()}. Enter it below.</Text>
      <TextInput accessibilityLabel="Email verification code" style={[styles.emailInput, styles.codeInput]} placeholder="123456"
        placeholderTextColor="#B7A88F" value={code} onChangeText={t => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
        keyboardType="number-pad" textContentType="oneTimeCode" autoFocus maxLength={6}/>
      <Pressable accessibilityRole="button" onPress={() => void onVerifyCode()} disabled={busy || code.length !== 6}
        style={[styles.cta, { opacity: code.length !== 6 || busy ? .5 : 1 }]}>
        {busy ? <ActivityIndicator color="#FFFFFF"/> : <Text style={styles.ctaText}>Verify Code</Text>}
      </Pressable>
      <Pressable onPress={() => { void haptics.pageOpen(); setEmailPhase('enter'); setCode(''); }} hitSlop={8}>
        <Text style={styles.backLink}>Use a different email</Text>
      </Pressable>
    </>}
  </ConnectAccountView>;
}

const styles = StyleSheet.create({
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

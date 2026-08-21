import { useMemo, useState } from 'react';
import { KeyboardDismissView } from '@/components/ui/keyboard-dismiss-view';
import { Platform,
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';

import { hideSplashOnce } from '@/lib/splash';
import { haptics } from '@/lib/haptics';
import { useResponsive, useTextStyle } from '@/hooks/use-responsive';

import {
  connectProviderOrSignIn,
  resendPasswordlessEmailOtp,
  sendPasswordlessEmailOtp,
  verifyPasswordlessEmailOtp,
  type PasswordlessEmailMode,
} from '@/lib/auth';

/**
 * Passwordless account entry/recovery.
 *
 * Stage 3.5.bugfix (2025-11-XX): Sign in with Apple / Continue with
 * Google buttons restyled to match official platform guidelines:
 *   - Apple: white bg + black logo + "Sign in with Apple" text per
 *     Apple HIG (https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple)
 *   - Google: white bg + 4-color G logo + "Continue with Google" per
 *     Google Identity Branding Guidelines
 *     (https://developers.google.com/identity/branding-guidelines)
 *
 * Logos are SVG components rendered inline via react-native-svg
 * (already a peer dep in Expo SDK 54). No new asset files needed.
 *
 * Mode flow: login / email / verify. Email OTP signs in an existing account
 * or creates one; when an anonymous session exists it binds first so the
 * guest's data stays on the same user id.
 */

type AuthMode = 'login' | 'email' | 'verify';

const TERMS_URL = 'https://www.burrow-app.com/terms';
const PRIVACY_URL = 'https://www.burrow-app.com/privacy';

// ---- SVG Logos (per official guidelines) ----

function AppleLogo({ size = 18 }: { size?: number }) {
  // Apple's official logo glyph (HIG-compliant proportions)
  return (
    <Svg width={size} height={size * 1.2} viewBox="0 0 384 480">
      <Path
        fill="#000000"
        d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
      />
    </Svg>
  );
}

function GoogleLogo({ size = 18 }: { size?: number }) {
  // Google's official 4-color G mark
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <Path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <Path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <Path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </Svg>
  );
}

export default function AuthScreen() {
  const { scale } = useResponsive();
  const t = useTextStyle();
  const styles = useMemo(() => makeStyles(scale, t), [scale, t]);
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [emailMode, setEmailMode] = useState<PasswordlessEmailMode>('login');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const router = useRouter();

  // The dev-only "replay onboarding" button lived here. The eleven-step flow is
  // deleted and the six-step one does not exist yet, so there is nowhere to
  // replay to. Restore it in Phase C, against the new flow.

  const clearMessages = () => {
    setErrorMsg('');
    setInfoMsg('');
  };

  const goTo = (next: AuthMode) => {
    clearMessages();
    setMode(next);
  };

  // ---- handlers ----

  const handleSendEmailCode = async () => {
    void haptics.light();
    clearMessages();
    const address = email.trim();
    if (!address.includes('@')) {
      setErrorMsg('Enter a valid email address.');
      return;
    }
    setLoading(true);
    const result = await sendPasswordlessEmailOtp(address);
    setLoading(false);
    if (!result.ok || !result.mode) {
      setErrorMsg(result.error ?? 'Could not send a verification code.');
      return;
    }
    setEmail(address);
    setEmailMode(result.mode);
    setOtpCode('');
    goTo('verify');
    setInfoMsg('Check your email for a 6-digit code.');
  };

  const handleVerifyOtp = async () => {
    void haptics.light();
    clearMessages();
    if (otpCode.length !== 6) {
      setErrorMsg('Enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    const result = await verifyPasswordlessEmailOtp(email.trim(), otpCode, emailMode);
    setLoading(false);
    if (!result.ok) {
      setErrorMsg(result.error ?? 'The verification code is invalid or expired.');
      return;
    }
    router.replace('/(auth)/signing-in');
  };

  const handleResendEmailCode = async () => {
    clearMessages();
    setLoading(true);
    const result = await resendPasswordlessEmailOtp(email.trim(), emailMode);
    setLoading(false);
    if (!result.ok) {
      setErrorMsg(result.error ?? 'Could not resend the verification code.');
      return;
    }
    setOtpCode('');
    setInfoMsg('A new 6-digit code was sent.');
  };

  const handleProvider = async (provider: 'apple' | 'google') => {
    void haptics.pageOpen();
    clearMessages();
    setLoading(true);
    const result = await connectProviderOrSignIn(provider);
    setLoading(false);
    if (!result.ok && !result.cancelled) {
      setErrorMsg(result.error ?? `Could not continue with ${provider === 'apple' ? 'Apple' : 'Google'}.`);
      return;
    }
    if (result.ok) router.replace('/(auth)/signing-in');
  };

  // ---- shared visual fragments ----

  const Branding = () => <Text style={styles.brand}>Burrow</Text>;

  const Footer = () => (
    <View style={styles.footer}>
      <Text style={styles.footerText}>
        By continuing, you agree to Burrow&apos;s{' '}
      </Text>
      <View style={styles.footerLinks}>
        <Pressable onPress={() => { void haptics.pageOpen(); Linking.openURL(TERMS_URL); }}>
          <Text style={styles.linkText}>Terms &amp; Conditions</Text>
        </Pressable>
        <Text style={styles.footerText}> and acknowledge the </Text>
        <Pressable onPress={() => { void haptics.pageOpen(); Linking.openURL(PRIVACY_URL); }}>
          <Text style={styles.linkText}>Privacy Policy</Text>
        </Pressable>
        <Text style={styles.footerText}>.</Text>
      </View>
    </View>
  );

  const Messages = () => (
    <View style={styles.messages}>
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
      {infoMsg ? <Text style={styles.infoText}>{infoMsg}</Text> : null}
    </View>
  );

  // ---- mode-specific renders ----

  if (mode === 'login') {
    return (
      <SafeAreaView style={styles.container} onLayout={hideSplashOnce}>
      <KeyboardDismissView style={{ flex: 1 }}>
        <View style={styles.body}>
          <Branding />
          <Text style={styles.headline}>
            Keep your journey safe and ready to continue.
          </Text>
          <Text style={styles.subheadline}>
            Your wisdoms and cards will be waiting for you.
          </Text>
          <View style={styles.buttonGroup}>
            {/* Sign in with Apple — HIG-compliant white variant (iOS only;
                Android would render a dead control) */}
            {Platform.OS === 'ios' && (
            <View style={styles.btnSlot}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.btn,
                  styles.btnApple,
                  loading && styles.btnDisabled,
                ]}
                disabled={loading}
                onPress={() => void handleProvider('apple')}
              >
                <View style={styles.btnIcon}>
                  <AppleLogo size={18} />
                </View>
                <Text style={styles.btnAppleText}>Sign in with Apple</Text>
              </TouchableOpacity>
            </View>
            )}

            {/* Continue with Google — official white variant */}
            <View style={styles.btnSlot}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.btn,
                  styles.btnGoogle,
                  loading && styles.btnDisabled,
                ]}
                disabled={loading}
                onPress={() => void handleProvider('google')}
              >
                <View style={styles.btnIcon}>
                  <GoogleLogo size={18} />
                </View>
                <Text style={styles.btnGoogleText}>Continue with Google</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.btnSlot}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.btn, styles.btnPrimary]}
                onPress={() => { void haptics.light(); goTo('email'); }}
              >
                <Text style={styles.btnPrimaryText}>Continue with Email</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        {__DEV__ && (
          <Pressable
            onPress={() => { void haptics.pageOpen(); router.replace('/(onboarding)'); }}
            style={{ alignItems: 'center', paddingVertical: 10 }}
          >
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
              [DEV] Replay onboarding
            </Text>
          </Pressable>
        )}
        <Footer />
      </KeyboardDismissView>
    </SafeAreaView>
    );
  }

  if (mode === 'email') {
    return (
      <SafeAreaView style={styles.container}>
      <KeyboardDismissView style={{ flex: 1 }}>
        <View style={styles.body}>
          <Branding />
          <Text style={styles.formTitle}>Continue with email</Text>
          <Text style={styles.subheadlineSmall}>
            We&apos;ll send a 6-digit code. No password needed.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Email address"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!loading}
          />
          <Messages />
          <Pressable
            style={[styles.btn, styles.btnPrimary, loading && styles.btnDisabled]}
            disabled={loading}
            onPress={() => void handleSendEmailCode()}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>Send Code</Text>
            )}
          </Pressable>
          <Pressable onPress={() => { void haptics.light(); goTo('login'); }} style={styles.backLink}>
            <Text style={styles.linkText}>Back</Text>
          </Pressable>
        </View>
        <Footer />
      </KeyboardDismissView>
    </SafeAreaView>
    );
  }

  return (
      <SafeAreaView style={styles.container} onLayout={hideSplashOnce}>
      <KeyboardDismissView style={{ flex: 1 }}>
        <Pressable
          onPress={() => { void haptics.light(); goTo('email'); }}
          hitSlop={12}
          style={({ pressed }) => [styles.topBackButton, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.topBackArrow}>{'\u2190'}</Text>
        </Pressable>
        <View style={styles.body}>
          <Branding />
          <Text style={styles.formTitle}>Verify email</Text>
          <Text style={styles.subheadlineSmall}>
            We sent a 6-digit code to {email}. Enter it below to continue.
          </Text>
          <TextInput
            style={[styles.input, styles.otpInput]}
            placeholder="------"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={otpCode}
            onChangeText={(text) => setOtpCode(text.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoFocus
            maxLength={6}
            editable={!loading}
          />
          <Messages />
          <Pressable
            style={[styles.btn, styles.btnPrimary, loading && styles.btnDisabled]}
            disabled={loading || otpCode.length !== 6}
            onPress={() => void handleVerifyOtp()}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>Verify</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => void handleResendEmailCode()}
            disabled={loading}
            style={styles.backLink}
          >
            <Text style={styles.linkText}>Resend code</Text>
          </Pressable>
        </View>
        <Footer />
      </KeyboardDismissView>
    </SafeAreaView>
  );
}

// ---- styles ----

function makeStyles(
  scale: (n: number) => number,
  t: ReturnType<typeof useTextStyle>,
) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    paddingHorizontal: scale(24),
    justifyContent: 'space-between',
  },
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  brand: {
    color: '#C084FC',
    ...t.title1,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: scale(32),
  },
  headline: {
    color: '#FFFFFF',
    ...t.title2,
    fontFamily: 'Inter_700Bold',
    marginBottom: scale(12),
  },
  subheadline: {
    color: 'rgba(255,255,255,0.4)',
    ...t.subheadline,
    fontFamily: 'Inter_400Regular',
    marginBottom: scale(36),
  },
  subheadlineSmall: {
    color: 'rgba(255,255,255,0.4)',
    ...t.footnote,
    fontFamily: 'Inter_400Regular',
    marginBottom: scale(24),
  },
  formTitle: {
    color: '#FFFFFF',
    ...t.title1,
    fontFamily: 'Inter_700Bold',
    marginBottom: scale(32),
  },
  input: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    paddingHorizontal: scale(20),
    paddingVertical: scale(18),
    ...t.callout,
    fontFamily: 'Inter_400Regular',
    color: '#FFFFFF',
    marginBottom: scale(12),
  },
  otpInput: {
    ...t.title2,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    letterSpacing: 8,
  },
  buttonGroup: {
    marginBottom: scale(24),
  },
  btnSlot: {
    // Each button isolated in its own View so the touch responder
    // system treats them as separate hit-test regions. 16px spacing
    // chosen for visual uniformity across all 3 buttons.
    marginBottom: scale(16),
  },
  btn: {
    borderRadius: 16,
    paddingVertical: scale(16),
    minHeight: Math.max(44, scale(50)), // Apple HIG minimum tappable height
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnIcon: {
    marginRight: scale(10),
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Sign in with Apple — white variant per HIG
  btnApple: {
    backgroundColor: '#FFFFFF',
  },
  btnAppleText: {
    color: '#000000',
    ...t.headline,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: -0.4,
  },

  // Continue with Google — white variant per Identity Branding Guidelines
  btnGoogle: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  // Unified to Apple HIG typography for visual consistency on iOS-first launch.
  // Google's branding guidelines accept any font as long as logo + "Continue
  // with Google" wording + colors are intact, so 17pt SemiBold is compliant.
  btnGoogleText: {
    color: '#1F1F1F',
    ...t.headline,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: -0.4,
  },

  btnPrimary: {
    backgroundColor: '#A855F7',
    marginTop: scale(8),
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    ...t.headline,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: -0.4,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  topBackButton: {
    position: 'absolute',
    top: 56,
    left: 20,
    zIndex: 10,
    padding: 8,
  },
  topBackArrow: {
    color: '#FFFFFF',
    fontSize: 28,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 28,
  },
  backLink: {
    marginTop: scale(16),
    alignItems: 'center',
  },
  linkText: {
    color: '#C084FC',
    ...t.footnote,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  messages: {
    marginBottom: scale(8),
  },
  errorText: {
    color: '#EF4444',
    ...t.footnote,
    fontFamily: 'Inter_400Regular',
    marginBottom: scale(8),
  },
  infoText: {
    color: '#C084FC',
    ...t.footnote,
    fontFamily: 'Inter_400Regular',
    marginBottom: scale(8),
  },
  footer: {
    paddingBottom: scale(16),
  },
  footerText: {
    color: 'rgba(255,255,255,0.3)',
    ...t.caption,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  footerLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  });
}

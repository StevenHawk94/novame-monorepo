import { useState } from 'react';
import {
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

import { storage } from '@/lib/storage';

import {
  sendPasswordReset,
  signInWithApple,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  verifyEmailOtp,
} from '@/lib/auth';

/**
 * AuthPage — 5-mode state machine.
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
 * Mode flow: login / register / email-login / verify / forgot
 */

type AuthMode = 'login' | 'register' | 'email-login' | 'verify' | 'forgot';

const TERMS_URL = 'https://novameapp.com/terms';
const PRIVACY_URL = 'https://novameapp.com/privacy';

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
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const router = useRouter();

  // ---- dev-only: replay onboarding ----
  const replayOnboarding = () => {
    // Clear onboarding done flag so the boot redirector + onboarding
    // flow treat the user as fresh. We delete the whole state key
    // (rather than patching) so step-2..11 also start clean.
    try {
      storage.remove('novame_onboarding_state');
    } catch {
      // best effort — even if delete fails, replace() will still
      // navigate; user will see step 1 splash regardless.
    }
    router.replace('/(onboarding)');
  };

  const clearMessages = () => {
    setErrorMsg('');
    setInfoMsg('');
  };

  const goTo = (next: AuthMode) => {
    clearMessages();
    setMode(next);
  };

  // ---- handlers ----

  const handleSignUp = async () => {
    clearMessages();
    if (!email.trim() || !password) {
      setErrorMsg('Email and password are required.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords don't match.");
      return;
    }
    setLoading(true);
    const { error, needsEmailConfirmation } = await signUpWithEmail(
      email.trim(),
      password,
    );
    setLoading(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (needsEmailConfirmation) {
      setInfoMsg('Check your email for a 6-digit code.');
      goTo('verify');
    }
  };

  const handleVerifyOtp = async () => {
    clearMessages();
    if (otpCode.length !== 6) {
      setErrorMsg('Enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    const { error } = await verifyEmailOtp(email.trim(), otpCode);
    setLoading(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
  };

  const handleEmailSignIn = async () => {
    clearMessages();
    if (!email.trim() || !password) {
      setErrorMsg('Email and password are required.');
      return;
    }
    setLoading(true);
    const { error } = await signInWithEmail(email.trim(), password);
    setLoading(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
  };

  const handleForgotPassword = async () => {
    clearMessages();
    if (!email.trim()) {
      setErrorMsg('Enter your email address.');
      return;
    }
    setLoading(true);
    const { error } = await sendPasswordReset(email.trim());
    setLoading(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setInfoMsg('Reset link sent. Check your inbox.');
  };

  const handleAppleSignIn = async () => {
    clearMessages();
    setLoading(true);
    const result = await signInWithApple();
    setLoading(false);
    if (result.kind === 'cancelled') return;
    if (result.kind === 'unsupported') {
      setErrorMsg('Sign in with Apple is not available on this device.');
      return;
    }
    if (result.kind === 'error') {
      setErrorMsg(result.message);
      return;
    }
  };

  const handleGoogleSignIn = async () => {
    clearMessages();
    setLoading(true);
    const result = await signInWithGoogle();
    setLoading(false);
    if (result.kind === 'cancelled') return;
    if (result.kind === 'unsupported') {
      setErrorMsg('Sign in with Google is not available on this device.');
      return;
    }
    if (result.kind === 'error') {
      setErrorMsg(result.message);
      return;
    }
  };

  // ---- shared visual fragments ----

  const Branding = () => <Text style={styles.brand}>NovaMe</Text>;

  const Footer = () => (
    <View style={styles.footer}>
      <Text style={styles.footerText}>
        By continuing, you agree to NovaMe&apos;s{' '}
      </Text>
      <View style={styles.footerLinks}>
        <Pressable onPress={() => Linking.openURL(TERMS_URL)}>
          <Text style={styles.linkText}>Terms &amp; Conditions</Text>
        </Pressable>
        <Text style={styles.footerText}> and acknowledge the </Text>
        <Pressable onPress={() => Linking.openURL(PRIVACY_URL)}>
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
      <SafeAreaView style={styles.container}>
        <View style={styles.body}>
          <Branding />
          <Text style={styles.headline}>
            Save your progress and claim your first card.
          </Text>
          <Text style={styles.subheadline}>
            Create an account to keep everything safe.
          </Text>
          <View style={styles.buttonGroup}>
            {/* Sign in with Apple — HIG-compliant white variant */}
            <View style={styles.btnSlot}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.btn,
                  styles.btnApple,
                  loading && styles.btnDisabled,
                ]}
                disabled={loading}
                onPress={handleAppleSignIn}
              >
                <View style={styles.btnIcon}>
                  <AppleLogo size={18} />
                </View>
                <Text style={styles.btnAppleText}>Sign in with Apple</Text>
              </TouchableOpacity>
            </View>

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
                onPress={handleGoogleSignIn}
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
                onPress={() => goTo('register')}
              >
                <Text style={styles.btnPrimaryText}>Continue with Email</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Pressable
            onPress={() => goTo('email-login')}
            style={styles.bottomLinkRow}
          >
            <Text style={styles.dimText}>Already have an account? </Text>
            <Text style={styles.boldLinkText}>Log in</Text>
          </Pressable>
          {__DEV__ ? (
            <Pressable onPress={replayOnboarding} style={styles.devLinkRow}>
              <Text style={styles.devLinkText}>↩︎ Replay onboarding (dev)</Text>
            </Pressable>
          ) : null}
        </View>
        <Footer />
      </SafeAreaView>
    );
  }

  if (mode === 'register') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.body}>
          <Branding />
          <Text style={styles.formTitle}>Create account</Text>
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
          <TextInput
            style={styles.input}
            placeholder="Password (min 6 characters)"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            secureTextEntry
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm password"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            autoCapitalize="none"
            secureTextEntry
            editable={!loading}
          />
          <Messages />
          <Pressable
            style={[styles.btn, styles.btnPrimary, loading && styles.btnDisabled]}
            disabled={loading}
            onPress={handleSignUp}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>Create Account</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => goTo('email-login')}
            style={styles.bottomLinkRow}
          >
            <Text style={styles.dimText}>Already have an account? </Text>
            <Text style={styles.boldLinkText}>Sign In</Text>
          </Pressable>
          <Pressable onPress={() => goTo('login')} style={styles.backLink}>
            <Text style={styles.linkText}>Back</Text>
          </Pressable>
        </View>
        <Footer />
      </SafeAreaView>
    );
  }

  if (mode === 'email-login') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.body}>
          <Branding />
          <Text style={styles.formTitle}>Sign in</Text>
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
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            secureTextEntry
            editable={!loading}
          />
          <Pressable onPress={() => goTo('forgot')} style={styles.forgotLinkRow}>
            <Text style={styles.linkText}>Forgot password?</Text>
          </Pressable>
          <Messages />
          <Pressable
            style={[styles.btn, styles.btnPrimary, loading && styles.btnDisabled]}
            disabled={loading}
            onPress={handleEmailSignIn}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>Sign In</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => goTo('register')}
            style={styles.bottomLinkRow}
          >
            <Text style={styles.dimText}>Don&apos;t have an account? </Text>
            <Text style={styles.boldLinkText}>Sign Up</Text>
          </Pressable>
          <Pressable onPress={() => goTo('login')} style={styles.backLink}>
            <Text style={styles.linkText}>Back</Text>
          </Pressable>
        </View>
        <Footer />
      </SafeAreaView>
    );
  }

  if (mode === 'verify') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.body}>
          <Branding />
          <Text style={styles.formTitle}>Verify email</Text>
          <Text style={styles.subheadlineSmall}>
            We sent a 6-digit code to {email}. Enter it below to finish creating
            your account.
          </Text>
          <TextInput
            style={[styles.input, styles.otpInput]}
            placeholder="------"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={otpCode}
            onChangeText={setOtpCode}
            keyboardType="number-pad"
            maxLength={6}
            editable={!loading}
          />
          <Messages />
          <Pressable
            style={[styles.btn, styles.btnPrimary, loading && styles.btnDisabled]}
            disabled={loading}
            onPress={handleVerifyOtp}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>Verify</Text>
            )}
          </Pressable>
          <Pressable onPress={() => goTo('register')} style={styles.backLink}>
            <Text style={styles.linkText}>Back</Text>
          </Pressable>
        </View>
        <Footer />
      </SafeAreaView>
    );
  }

  // mode === 'forgot'
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.body}>
        <Branding />
        <Text style={styles.formTitle}>Reset password</Text>
        <Text style={styles.subheadlineSmall}>
          Enter your email and we&apos;ll send you a link to reset your password.
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
          onPress={handleForgotPassword}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.btnPrimaryText}>Send Reset Link</Text>
          )}
        </Pressable>
        <Pressable onPress={() => goTo('email-login')} style={styles.backLink}>
          <Text style={styles.linkText}>Back</Text>
        </Pressable>
      </View>
      <Footer />
    </SafeAreaView>
  );
}

// ---- styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0B2E',
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  brand: {
    color: '#C084FC',
    fontSize: 32,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 32,
  },
  headline: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    lineHeight: 36,
    marginBottom: 12,
  },
  subheadline: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    marginBottom: 36,
  },
  subheadlineSmall: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginBottom: 24,
    lineHeight: 20,
  },
  formTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    marginBottom: 32,
  },
  input: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  otpInput: {
    fontSize: 24,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    letterSpacing: 8,
  },
  buttonGroup: {
    marginBottom: 24,
  },
  btnSlot: {
    // Each button isolated in its own View so the touch responder
    // system treats them as separate hit-test regions. 16px spacing
    // chosen for visual uniformity across all 3 buttons.
    marginBottom: 16,
  },
  btn: {
    borderRadius: 16,
    paddingVertical: 16,
    minHeight: 50, // Apple HIG minimum tappable height
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnIcon: {
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Sign in with Apple — white variant per HIG
  btnApple: {
    backgroundColor: '#FFFFFF',
  },
  btnAppleText: {
    color: '#000000',
    fontSize: 17,
    fontWeight: '600',
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
    fontSize: 17,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: -0.4,
  },

  btnPrimary: {
    backgroundColor: '#A855F7',
    marginTop: 8,
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: -0.4,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  bottomLinkRow: {
    marginTop: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  forgotLinkRow: {
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  backLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  dimText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  boldLinkText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
  },
  linkText: {
    color: '#C084FC',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  messages: {
    marginBottom: 8,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginBottom: 8,
  },
  infoText: {
    color: '#C084FC',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginBottom: 8,
  },
  footer: {
    paddingBottom: 16,
  },
  footerText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  footerLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  devLinkRow: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 8,
  },
  devLinkText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    fontStyle: 'italic',
  },
});
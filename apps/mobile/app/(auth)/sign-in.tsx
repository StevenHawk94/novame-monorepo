import { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  sendPasswordReset,
  signInWithEmail,
  signUpWithEmail,
  verifyEmailOtp,
} from '@/lib/auth';

/**
 * AuthPage — 5-mode state machine.
 *
 * Visual contract: matches the old Capacitor NovaMe AuthPage screenshots.
 * Architecture: rewritten with React Native + expo-router.
 *
 * Mode flow:
 *   login        — landing page (Apple / Google / Email buttons)
 *   register     — new user email + password + confirm
 *   email-login  — existing user email + password
 *   verify       — OTP code entry after register success
 *   forgot       — send password reset email
 *
 * Apple / Google buttons are visible but disabled in this commit.
 * Stage 3.4 step 6 wires up Apple Sign-In; step 7 wires up Google.
 *
 * onAuthStateChange listener (in app/_layout.tsx, stage 3.4 step 3) is
 * what actually triggers redirect to (main)/(tabs) after successful
 * signIn / verifyOtp. This screen does not call router.replace itself.
 */

type AuthMode = 'login' | 'register' | 'email-login' | 'verify' | 'forgot';

const TERMS_URL = 'https://novameapp.com/terms';
const PRIVACY_URL = 'https://novameapp.com/privacy';

export default function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

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
    // If no email confirmation required, onAuthStateChange handles redirect.
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
    // Success: onAuthStateChange will redirect.
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
    // Success: onAuthStateChange will redirect.
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

  // ---- shared visual fragments ----

  const Branding = () => <Text style={styles.brand}>NovaMe</Text>;

  const Footer = () => (
    <View style={styles.footer}>
      <Text style={styles.footerText}>By continuing, you agree to NovaMe&apos;s </Text>
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
            <Pressable
              style={[styles.btn, styles.btnApple, styles.btnDisabled]}
              disabled
            >
              <Text style={styles.btnAppleText}>Sign in with Apple</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnGoogle, styles.btnDisabled]}
              disabled
            >
              <Text style={styles.btnGoogleText}>Continue with Google</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => goTo('register')}
            >
              <Text style={styles.btnPrimaryText}>Continue with Email</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => goTo('email-login')} style={styles.bottomLinkRow}>
            <Text style={styles.dimText}>Already have an account? </Text>
            <Text style={styles.boldLinkText}>Log in</Text>
          </Pressable>
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
          <Pressable onPress={() => goTo('email-login')} style={styles.bottomLinkRow}>
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
          <Pressable onPress={() => goTo('register')} style={styles.bottomLinkRow}>
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
    gap: 12,
    marginBottom: 24,
  },
  btn: {
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnApple: {
    backgroundColor: '#FFFFFF',
  },
  btnAppleText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  btnGoogle: {
    backgroundColor: '#1A1A2E',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  btnGoogleText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  btnPrimary: {
    backgroundColor: '#A855F7',
    marginTop: 8,
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
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
});

/**
 * AI Consent modal — Stage 6.
 *
 * Required first-touch gate before any AI-touching flow (mic record,
 * Offer Wisdom from Discover, Offer Wisdom from Seek-question detail).
 *
 * Presentation:
 *   - transparentModal: backdrop transparently overlays the previous
 *     screen so the user keeps the spatial context of where they were
 *     before tapping mic / Offer Wisdom.
 *   - animation: fade (configured on the parent _layout's Stack.Screen
 *     for this route).
 *   - The card is custom-rendered (not a native sheet) because we want
 *     a non-dismissible backdrop and pixel-level control of the purple
 *     branding -- @gorhom/bottom-sheet would be overkill for a single
 *     centered card with no snap points, and was already noted in the
 *     parent _layout comment as the reason native formSheet was
 *     abandoned.
 *
 * Dismissal contract:
 *   - Backdrop tap: does NOT dismiss. Consent is a deliberate gate
 *     and accidental dismiss would erode trust.
 *   - Top-right X: dismisses without persisting. User stays unagreed
 *     and the modal will re-appear next time they trigger an
 *     AI-touching flow.
 *   - Agree & Continue (after checkbox checked):
 *       1. POST /api/ai-consent (idempotent server mark).
 *       2. Write MMKV cache via markAiConsent.
 *       3. router.replace(next) so the consent modal does NOT linger
 *          as a back step — user lands on the original target with a
 *          clean stack.
 *
 * The `next` param is the full URL string the caller wanted to push
 * before the gate intercepted. requireAiConsent() in lib/ai-consent.ts
 * is the only place that should push this modal — call sites should
 * never construct the URL manually.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { markAiConsent } from '@/lib/ai-consent';
import { supabase } from '@/lib/supabase';

const PURPLE = '#7C3AED';
const PURPLE_DEEP = '#6D28D9';
const STAR_YELLOW = '#FBBF24';

export default function AiConsentModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ next?: string }>();
  const next = params.next ?? '/(main)/(tabs)';

  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleClose = () => {
    void haptics.light();
    // X close path: do NOT persist. User stays unagreed; the modal
    // re-appears on the next AI-touching flow trigger.
    if (router.canGoBack()) router.back();
  };

  const handleToggle = () => {
    void haptics.light();
    setAgreed((prev) => !prev);
  };

  // Open the AI-features explainer page in the user's external
  // browser. We intentionally use Linking.openURL (not a WebView /
  // expo-web-browser) so the page renders with the user's familiar
  // browser chrome + their saved cookies / dark mode preferences,
  // and so the consent modal stays parked in the background ready
  // for the user to return and finish the agree flow.
  const handleLearnMore = () => {
    void haptics.light();
    void Linking.openURL('https://novameapp.com/ai-features').catch(() => {
      Alert.alert(
        'Unable to open page',
        'Please visit novameapp.com/ai-features in your browser.',
      );
    });
  };

  const handleAgree = async () => {
    if (!agreed || busy) return;
    void haptics.medium();
    setBusy(true);

    // Resolve userId for the server POST. We expect the user to be
    // signed in by the time they can trigger this modal -- the mic
    // and Offer Wisdom buttons are all inside (main) which already
    // gates on auth via the (main)/_layout's session check. Still,
    // defensive: if userId is missing for any reason, surface and
    // bail rather than silently dropping the consent.
    const sess = await supabase.auth.getSession();
    const userId = sess.data.session?.user?.id;
    if (!userId) {
      setBusy(false);
      Alert.alert(
        'Session expired',
        'Please sign in again to continue.',
      );
      return;
    }

    const result = await markAiConsent(userId);
    setBusy(false);

    if (!result.success) {
      Alert.alert(
        'Could not save',
        result.error ?? 'Please try again.',
      );
      return;
    }

    // Consent recorded -- proceed to the original target. router.replace
    // (NOT push) so the back stack does not contain this consent modal.
    // Decoding: requireAiConsent encoded the URL with encodeURIComponent
    // to keep query params safe; we decode here before passing to router.
    let target: string;
    try {
      target = decodeURIComponent(next);
    } catch {
      target = next;
    }
    router.replace(target as never);
  };

  return (
    // pointerEvents='box-none' on the backdrop View lets touches OUTSIDE
    // the card pass through to... nothing (transparentModal still owns
    // the screen). Important: we do NOT add an onPress on the backdrop
    // because backdrop-tap-to-dismiss is intentionally disabled per the
    // dismissal contract above.
    <View style={[styles.backdrop, { paddingTop: insets.top }]}>
      <View style={styles.card}>
        {/* Top-right close — the only escape hatch other than Agree. */}
        <View style={styles.closeRow}>
          <Pressable
            onPress={handleClose}
            style={({ pressed }) => [
              styles.closeBtn,
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={10}
          >
            <MaterialIcons name="close" size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* Decorative stars cluster. auto-awesome is the standard
            "sparkle" glyph in MaterialIcons; we paint three at varying
            sizes for the trio look in the design. */}
        <View style={styles.starsRow}>
          <MaterialIcons
            name="auto-awesome"
            size={28}
            color={STAR_YELLOW}
            style={styles.starSmallLeft}
          />
          <MaterialIcons
            name="auto-awesome"
            size={64}
            color={STAR_YELLOW}
          />
          <MaterialIcons
            name="auto-awesome"
            size={22}
            color={STAR_YELLOW}
            style={styles.starSmallRight}
          />
        </View>

        <Text style={styles.title}>NovaMe uses AI to support you</Text>

        <Text style={styles.body}>
          To generate &ldquo;Wisdom Cards&rdquo; and insights, NovaMe uses
          third-party AI technology.
        </Text>

        {/* Checkbox row. The entire row is pressable so a tap anywhere
            on the row toggles the checkbox -- larger hit target than
            the checkbox square alone. */}
        <Pressable
          onPress={handleToggle}
          style={({ pressed }) => [
            styles.checkboxRow,
            pressed && { opacity: 0.85 },
          ]}
        >
          <View
            style={[
              styles.checkbox,
              agreed && styles.checkboxChecked,
            ]}
          >
            {agreed ? (
              <MaterialIcons name="check" size={16} color={PURPLE} />
            ) : null}
          </View>
          <Text style={styles.checkboxLabel}>
            I agree that Gemini may process my entries and messages to
            generate AI responses.
          </Text>
        </Pressable>

        <Pressable
          onPress={handleLearnMore}
          style={({ pressed }) => [
            styles.learnMoreRow,
            pressed && { opacity: 0.6 },
          ]}
          hitSlop={6}
        >
          <Text style={styles.learnMoreText}>Learn More</Text>
          <MaterialIcons
            name="open-in-new"
            size={14}
            color="rgba(255,255,255,0.75)"
          />
        </Pressable>

        <Pressable
          onPress={handleAgree}
          disabled={!agreed || busy}
          style={({ pressed }) => [
            styles.ctaBtn,
            (!agreed || busy) && styles.ctaBtnDisabled,
            pressed && agreed && !busy && { opacity: 0.85 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={PURPLE} />
          ) : (
            <Text
              style={[
                styles.ctaText,
                !agreed && styles.ctaTextDisabled,
              ]}
            >
              Agree & Continue
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: PURPLE,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    shadowColor: PURPLE_DEEP,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  closeRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 4,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 20,
    height: 72,
  },
  starSmallLeft: {
    marginRight: 6,
    marginTop: -18,
  },
  starSmallRight: {
    marginLeft: 6,
    marginTop: 22,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 30,
    marginBottom: 12,
  },
  body: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  checkboxLabel: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  learnMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginTop: -10,
    marginBottom: 16,
  },
  learnMoreText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
    textDecorationColor: 'rgba(255,255,255,0.5)',
  },
  ctaBtn: {
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  ctaBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  ctaText: {
    color: PURPLE,
    fontSize: 16,
    fontWeight: '800',
  },
  ctaTextDisabled: {
    color: 'rgba(124,58,237,0.6)',
  },
});

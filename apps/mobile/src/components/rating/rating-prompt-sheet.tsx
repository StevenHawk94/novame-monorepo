/**
 * rating-prompt-sheet.tsx -- Stage 6.RatingPrompt
 *
 * Bottom sheet that asks "How's NovaMe so far?" and routes the user
 * to either the App Store rating prompt (Loving it path) or a
 * pre-filled mailto support email (Could be better path). Each step
 * has a Skip / Maybe later fallback in small text at the bottom
 * that closes without recording an "expressed" state.
 *
 * Design constraints (Stage 6 brand):
 *   - Paywall-purple bg (#7C3AED) + pink CTA (#EC4899) + deep-purple
 *     text on white secondary buttons (#1F1147)
 *   - One primary action per step (pink button) + small skip text
 *     below -- no parallel skip button, per design spec
 *   - One question per step (per Apple HIG: don't stack questions)
 *
 * Apple compliance posture:
 *   - We do NOT auto-route based on user's happiness signal (would
 *     be review gating, App Store reject risk per Guideline 1.1.7)
 *   - We ASK the user "would you like to rate us?" in the followup
 *     step. They must tap an explicit Rate button. The Apple system
 *     prompt itself is then triggered.
 *   - 1-3 star (could-be-better) path goes to a feedback email, NOT
 *     because we filtered them away from App Store, but because they
 *     explicitly chose "Could be better" themselves.
 *
 * Uses @gorhom/bottom-sheet v5. Mounted globally in
 * (tabs)/_layout.tsx so it can surface above any tab after the
 * record modal closes.
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import * as StoreReview from 'expo-store-review';
import * as Application from 'expo-application';

import { haptics } from '@/lib/haptics';
import { markUserExpressed } from '@/lib/rating-prompt';

const SUPPORT_EMAIL = 'support@soulsayit.com';

type Step = 'initial' | 'loving_followup' | 'feedback_followup';

export type RatingPromptSheetRef = {
  present: () => void;
  dismiss: () => void;
};

export const RatingPromptSheet = forwardRef<RatingPromptSheetRef>(
  function RatingPromptSheet(_props, externalRef) {
    const internalRef = useRef<BottomSheetModal>(null);
    const [step, setStep] = useState<Step>('initial');

    const handleChange = useCallback((index: number) => {
      if (index === -1) {
        // Sheet fully dismissed -- reset for next presentation.
        setStep('initial');
      }
    }, []);

    useImperativeHandle(externalRef, () => ({
      present: () => {
        setStep('initial');
        internalRef.current?.present();
      },
      dismiss: () => internalRef.current?.dismiss(),
    }));

    const snapPoints = useMemo(() => ['54%'], []);

    const renderBackdrop = useCallback(
      (backdropProps: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...backdropProps}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.6}
          pressBehavior="close"
        />
      ),
      [],
    );

    // ---- Step handlers ----

    const onPickLoving = () => {
      haptics.light();
      setStep('loving_followup');
    };

    const onPickUnhappy = () => {
      haptics.light();
      setStep('feedback_followup');
    };

    const onPickSkipInitial = () => {
      haptics.light();
      internalRef.current?.dismiss();
    };

    const onRateApp = async () => {
      haptics.medium();
      markUserExpressed('loved');
      try {
        // SKStoreReviewController may or may not actually display
        // the Apple modal -- iOS decides based on its rate limits,
        // prior user actions, and the in-app-ratings setting. Per
        // design: we do not provide a fallback URL here. The user
        // has expressed intent; if iOS suppresses the prompt,
        // that's iOS's call and respected.
        await StoreReview.requestReview();
      } catch (e) {
        console.warn('[rating-prompt] requestReview failed:', e);
      } finally {
        internalRef.current?.dismiss();
      }
    };

    const onSkipLoving = () => {
      haptics.light();
      internalRef.current?.dismiss();
    };

    const onSendFeedback = async () => {
      haptics.medium();
      markUserExpressed('unhappy');

      // Pre-fill subject + body metadata so support can triage
      // quickly without asking the user for their version / OS.
      const appVersion = Application.nativeApplicationVersion ?? 'unknown';
      const buildNumber = Application.nativeBuildVersion ?? 'unknown';
      const osVersion =
        Platform.Version != null ? String(Platform.Version) : 'unknown';

      const subject = encodeURIComponent('NovaMe Feedback');
      const body = encodeURIComponent(
        [
          'Hi NovaMe team,',
          '',
          '[Your feedback here]',
          '',
          '---',
          'App version: ' + appVersion + ' (' + buildNumber + ')',
          'iOS version: ' + osVersion,
        ].join('\n'),
      );

      const url = 'mailto:' + SUPPORT_EMAIL + '?subject=' + subject + '&body=' + body;

      try {
        await Linking.openURL(url);
      } catch (e) {
        console.warn('[rating-prompt] open mailto failed:', e);
      } finally {
        internalRef.current?.dismiss();
      }
    };

    const onSkipFeedback = () => {
      haptics.light();
      internalRef.current?.dismiss();
    };

    // ---- Render per-step body ----

    let body: React.ReactElement;

    if (step === 'initial') {
      body = (
        <>
          <Text style={styles.title}>How's NovaMe so far? ✨</Text>
          <Text style={styles.subtitle}>
            We'd love to hear what you think.
          </Text>

          <Pressable
            onPress={onPickLoving}
            style={({ pressed }) => [
              styles.primaryButton,
              { opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Text style={styles.primaryLabel}>Loving it 💜</Text>
          </Pressable>

          <Pressable
            onPress={onPickUnhappy}
            style={({ pressed }) => [
              styles.secondaryButton,
              { opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Text style={styles.secondaryLabel}>Could be better 🤔</Text>
          </Pressable>

          <Pressable
            onPress={onPickSkipInitial}
            style={({ pressed }) => [
              styles.skipText,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={styles.skipLabel}>Skip</Text>
          </Pressable>
        </>
      );
    } else if (step === 'loving_followup') {
      body = (
        <>
          <Text style={styles.title}>Glad you're enjoying it! 💜</Text>
          <Text style={styles.subtitle}>
            Would you mind taking a moment to rate us on the App Store?
            Every rating helps NovaMe reach more people.
          </Text>

          <Pressable
            onPress={onRateApp}
            style={({ pressed }) => [
              styles.primaryButton,
              { opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Text style={styles.primaryLabel}>Rate NovaMe ⭐</Text>
          </Pressable>

          <Pressable
            onPress={onSkipLoving}
            style={({ pressed }) => [
              styles.skipText,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={styles.skipLabel}>Maybe later</Text>
          </Pressable>
        </>
      );
    } else {
      body = (
        <>
          <Text style={styles.title}>Sorry to hear that 🤍</Text>
          <Text style={styles.subtitle}>
            Tell us what's not working -- we read every message and
            we'll do our best to make it right.
          </Text>

          <Pressable
            onPress={onSendFeedback}
            style={({ pressed }) => [
              styles.primaryButton,
              { opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Text style={styles.primaryLabel}>Send Feedback 💌</Text>
          </Pressable>

          <Pressable
            onPress={onSkipFeedback}
            style={({ pressed }) => [
              styles.skipText,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={styles.skipLabel}>Skip</Text>
          </Pressable>
        </>
      );
    }

    return (
      <BottomSheetModal
        ref={internalRef}
        index={0}
        snapPoints={snapPoints}
        onChange={handleChange}
        backdropComponent={renderBackdrop}
        handleStyle={styles.handle}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.background}
        enablePanDownToClose
        enableDynamicSizing={false}
      >
        <BottomSheetView style={styles.container}>{body}</BottomSheetView>
      </BottomSheetModal>
    );
  },
);

const styles = StyleSheet.create({
  background: {
    backgroundColor: '#7C3AED',
  },
  handle: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  handleIndicator: {
    backgroundColor: 'rgba(255,255,255,0.4)',
    width: 40,
  },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 12,
    paddingBottom: 32,
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  subtitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 8,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#EC4899',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: 14,
  },
  primaryLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
  secondaryButton: {
    width: '100%',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginBottom: 14,
  },
  secondaryLabel: {
    color: '#1F1147',
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
  skipText: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  skipLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
});

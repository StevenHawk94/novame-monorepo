import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';

import { PrimaryButton } from '@/components/onboarding/shared';
import { useResponsive, useTextStyle } from '@/hooks/use-responsive';
import {
  getOnboardingState,
  patchOnboardingState,
} from '@/lib/onboarding';

/**
 * Step 10 — Companion reveal + naming.
 *
 * Stage 3.5.bugfix.C (2025-11-XX): keyboard handling rewritten.
 * Previous attempt used <KeyboardAvoidingView behavior="padding">
 * which adds bottom padding — content reflows but the input stays
 * roughly at the same screen Y, so on ob-10's tall video layout
 * the input was still under the keyboard.
 *
 * New approach: listen to Keyboard show/hide events and animate the
 * entire page translateY by -keyboardHeight + footer offset. The
 * video region scrolls off-screen as the page lifts (acceptable per
 * design call d2-ii — video may be partially obscured).
 *
 * Tap-anywhere-outside-input dismisses keyboard via Pressable on the
 * outer container. Input has returnKeyType="done" + onSubmitEditing
 * for the explicit dismiss path.
 */
export default function OnboardingStep10() {
  const { scale } = useResponsive();
  const t = useTextStyle();
  const styles = useMemo(() => makeStyles(scale, t), [scale, t]);
  const router = useRouter();
  const initial = getOnboardingState().charName;
  const [name, setName] = useState(initial);
  const translateY = useRef(new Animated.Value(0)).current;

  // ---- Keyboard listener: lift the page when keyboard opens ----
  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      // Lift the whole page by approximately 60% of keyboard height.
      // Full lift would push the brand title off-screen; partial lift
      // keeps headline visible while exposing the input + button.
      const lift = Math.round(e.endCoordinates.height * 0.6);
      Animated.timing(translateY, {
        toValue: -lift,
        duration: e.duration ?? 250,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    };
    const onHide = (e: KeyboardEvent) => {
      Animated.timing(translateY, {
        toValue: 0,
        duration: e.duration ?? 250,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    };

    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [translateY]);

  const player = useVideoPlayer(
    require('@/../assets/images/onboarding/ob-10.mp4'),
    (p) => {
      p.loop = true;
      p.muted = true;
      p.play();
    },
  );

  const handleChange = (v: string) => {
    const next = v.slice(0, 12);
    setName(next);
    patchOnboardingState({ charName: next });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <Pressable style={styles.flex} onPress={Keyboard.dismiss}>
        <Animated.View style={[styles.flex, { transform: [{ translateY }] }]}>
          {/* Video region */}
          <View style={styles.videoContainer}>
            <VideoView
              player={player}
              style={styles.video}
              contentFit="cover"
              nativeControls={false}
            />
          </View>

          {/* Content + Input */}
          <View style={styles.content}>
            <Text style={styles.headline}>Meet Your Companion</Text>
            <Text style={styles.subheadline}>
              Your companion listens to your voice, catches your fleeting thoughts, and weaves them into wisdom.
            </Text>
            <Text style={styles.eyebrow}>Every guide needs a name</Text>
            <TextInput
              value={name}
              onChangeText={handleChange}
              placeholder="Type Name Here"
              placeholderTextColor="rgba(255,255,255,0.25)"
              maxLength={12}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />
            <Text style={styles.counter}>{name.length}/12</Text>
          </View>

          {/* Footer button */}
          <View style={styles.footer}>
            <PrimaryButton
              disabled={!name.trim()}
              onPress={() => {
                Keyboard.dismiss();
                router.push('/(onboarding)/step-11');
              }}
            >
              Nice to meet you!
            </PrimaryButton>
          </View>
        </Animated.View>
      </Pressable>
    </SafeAreaView>
  );
}

function makeStyles(
  scale: (n: number) => number,
  t: ReturnType<typeof useTextStyle>,
) {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0820',
  },
  flex: {
    flex: 1,
  },
  videoContainer: {
    width: '100%',
    aspectRatio: 7 / 6,
    overflow: 'hidden',
    backgroundColor: '#1A1430',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  content: {
    flex: 1,
    paddingHorizontal: scale(28),
    justifyContent: 'center',
  },
  headline: {
    color: '#FFFFFF',
    ...t.title2,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: scale(8),
  },
  subheadline: {
    color: 'rgba(255,255,255,0.45)',
    ...t.footnote,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: scale(20),
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.6)',
    ...t.caption2,
    fontFamily: 'Inter_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: scale(8),
  },
  input: {
    width: '100%',
    height: Math.max(44, scale(56)),
    borderRadius: 16,
    paddingHorizontal: scale(20),
    ...t.title3,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 2,
    borderColor: 'rgba(168,85,247,0.3)',
    color: '#FFFFFF',
  },
  counter: {
    color: 'rgba(255,255,255,0.25)',
    ...t.caption2,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: scale(6),
  },
  footer: {
    paddingHorizontal: scale(28),
    paddingBottom: scale(16),
  },
  });
}

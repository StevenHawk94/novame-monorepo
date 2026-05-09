import { useEffect, useRef, useState } from 'react';
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
            <Text style={styles.headline}>You didn't do this alone.</Text>
            <Text style={styles.subheadline}>
              Meet your companion. They are here to listen to your voice,
              catch your fleeting thoughts, and weave them into pure wisdom.
            </Text>
            <Text style={styles.eyebrow}>Every guide needs a name</Text>
            <TextInput
              value={name}
              onChangeText={handleChange}
              placeholder="Name your companion..."
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

const styles = StyleSheet.create({
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
    paddingHorizontal: 28,
    justifyContent: 'center',
  },
  headline: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subheadline: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 8,
  },
  input: {
    width: '100%',
    height: 56,
    borderRadius: 16,
    paddingHorizontal: 20,
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 2,
    borderColor: 'rgba(168,85,247,0.3)',
    color: '#FFFFFF',
  },
  counter: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: 6,
  },
  footer: {
    paddingHorizontal: 28,
    paddingBottom: 16,
  },
});

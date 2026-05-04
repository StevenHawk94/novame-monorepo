import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';

import {
  ImgPage,
  PrimaryButton,
} from '@/components/onboarding/shared';
import {
  getOnboardingState,
  patchOnboardingState,
} from '@/lib/onboarding';

/**
 * Step 10 — Companion reveal + naming.
 *
 * Plays the ob-10.mp4 video silently in the top portion of the
 * screen and asks the user to name their companion (1-12 chars).
 *
 * Continue is disabled until the user types something. The name
 * persists to MMKV on every change (so back/forward navigation
 * does not lose it).
 *
 * The video file is bundled with the app (committed to
 * apps/mobile/assets/images/onboarding/ob-10.mp4) — onboarding
 * cannot rely on the R2 cache being warm yet, since this is the
 * second-to-last screen and the asset-cache prefetch from step 1
 * may not have completed for video files.
 */
export default function OnboardingStep10() {
  const router = useRouter();
  const initial = getOnboardingState().charName;
  const [name, setName] = useState(initial);

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
    <ImgPage
      vidUri="bundled"
      vidPoster={
        <VideoView
          player={player}
          style={styles.video}
          contentFit="cover"
          nativeControls={false}
        />
      }
      btn={
        <PrimaryButton
          disabled={!name.trim()}
          onPress={() => router.push('/(onboarding)/step-11')}
        >
          Nice to meet you!
        </PrimaryButton>
      }
    >
      <View>
        <Text style={styles.headline}>You didn&apos;t do this alone.</Text>
        <Text style={styles.subheadline}>
          Meet your companion. They are here to listen to your voice, catch your
          fleeting thoughts, and weave them into pure wisdom.
        </Text>
        <Text style={styles.eyebrow}>Every guide needs a name</Text>
        <TextInput
          value={name}
          onChangeText={handleChange}
          placeholder="Name your companion..."
          placeholderTextColor="rgba(255,255,255,0.25)"
          maxLength={12}
          style={styles.input}
        />
        <Text style={styles.counter}>{name.length}/12</Text>
      </View>
    </ImgPage>
  );
}

const styles = StyleSheet.create({
  video: {
    width: '100%',
    height: '100%',
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
});

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image as NativeImage,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ScreenOverlay } from '@/components/ui/screen-overlay';
import { Image as ExpoImage, useImage } from 'expo-image';
import { useFocusEffect } from 'expo-router';

import { ICONS } from '@/lib/icons';
import { haptics } from '@/lib/haptics';
import {
  completeFeatureGuide,
  shouldShowFeatureGuide,
  type FeatureGuideId,
} from '@/lib/feature-guides';
import {
  releaseModalSlot,
  requestModalSlot,
  useActiveModalSlot,
  ownsModalSlot,
} from '@/lib/modal-coordinator';

interface GuideCopy {
  title: string;
  body: string;
  button: string;
  icon: (typeof ICONS)[string];
}

const GUIDES: Record<FeatureGuideId, GuideCopy> = {
  reflect: {
    title: 'YOUR DAY, NOW COLLECTIBLE',
    body: 'Write what happened, or tap your keyboard mic to voice typing. Items appear as you go, giving your person a glimpse while the full story stays private.',
    button: 'Let’s Reflect',
    icon: ICONS.reflectEntry3,
  },
  focus: {
    title: 'GIVE YOUR BRAIN A HEAD START',
    body: 'Before work, study, or anything that needs your attention, press play for a short audio reset.',
    button: 'Let’s Focus',
    icon: ICONS.guideFocus,
  },
  paired: {
    title: 'Burrow is better with your person.',
    body: 'Invite someone special to create a private space for two.',
    button: 'Invite Now',
    icon: ICONS.guidePaired,
  },
  connection: {
    title: 'PRIVATE BY DESIGN. CLOSER BY CHOICE.',
    body: 'Both of your full reflections stay private. Burrow surfaces only high-level patterns to help you understand each other—without revealing anyone’s private words.',
    button: 'See the Connection',
    icon: ICONS.guideConnection,
  },
  memories: {
    title: 'KEEP THE GOOD STUFF',
    body: 'Find your memories, the ones they shared with you, and the moments you made together, all in one cozy place.',
    button: 'Got it',
    icon: ICONS.guideMemories,
  },
  bunny: {
    title: 'YOUR BUNNY HAS A KIT FOR THAT',
    body: 'Overthinking? Self-doubt? Feeling stuck, lost, or ready to vent? Pick a Bunny Kit and work through whatever showed up today.',
    button: 'Show Me the Kits',
    icon: ICONS.guideBunny,
  },
  quests: {
    title: 'GIVE YOUR WEEK SOME PLOT',
    body: 'Set one weekly goal, take on bite-sized Quests, and give your days something new to reflect on.',
    button: 'Start a Quest',
    icon: ICONS.guideQuests,
  },
};

export function FeatureGuideModal({
  guide,
  enabled = true,
}: {
  guide: FeatureGuideId;
  enabled?: boolean;
}) {
  const activeModal = useActiveModalSlot();
  const owner = `guide:${guide}`;
  const requestedRef = useRef(false);
  const retryIcon = useRef<(() => void) | null>(null);
  const icon = useImage(NativeImage.resolveAssetSource(GUIDES[guide].icon).uri, {
    onError: (_error, retry) => { retryIcon.current = retry; },
  });
  const [iconDisplayed, setIconDisplayed] = useState(false);
  const [visible, setVisible] = useState(false);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.78)).current;

  useFocusEffect(
    useCallback(() => {
      if (!enabled || !shouldShowFeatureGuide(guide)) return undefined;
      if (!icon) { retryIcon.current?.(); return undefined; }
      // useImage already supplies a decoded ImageRef. Do not open an invisible
      // modal and wait for an onDisplay event before allowing any interaction.
      setIconDisplayed(true);
      backdropOpacity.setValue(0);
      cardOpacity.setValue(0);
      requestedRef.current = true;
      requestModalSlot('guide', owner);
      return () => {
        requestedRef.current = false;
        setVisible(false);
        releaseModalSlot('guide', owner);
      };
    }, [enabled, guide, icon, owner, backdropOpacity, cardOpacity]),
  );

  useEffect(() => {
    setVisible(requestedRef.current && activeModal === 'guide' && ownsModalSlot(owner));
  }, [activeModal, icon, enabled, owner]);

  useEffect(() => {
    if (!visible || !iconDisplayed) return;
    backdropOpacity.setValue(0);
    cardOpacity.setValue(0);
    cardScale.setValue(0.78);
    const animation = Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(cardScale, {
          toValue: 1.06,
          duration: 210,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(cardScale, {
          toValue: 0.96,
          duration: 90,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(cardScale, {
          toValue: 1,
          duration: 90,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);
    animation.start();
    return () => animation.stop();
  }, [backdropOpacity, cardOpacity, cardScale, visible, iconDisplayed]);

  const dismiss = useCallback(() => {
    if (!requestedRef.current) return;
    if (iconDisplayed) completeFeatureGuide(guide);
    requestedRef.current = false;
    setVisible(false);
    releaseModalSlot('guide', owner);
  }, [guide, iconDisplayed, owner]);

  const copy = GUIDES[guide];

  return (
    <ScreenOverlay
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={dismiss}
    >
      <View style={styles.root} accessibilityViewIsModal>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
        <Animated.View
          style={[
            styles.card,
            { opacity: cardOpacity, transform: [{ scale: cardScale }] },
          ]}
        >
          <Text style={styles.title}>{copy.title}</Text>
          <ExpoImage source={icon} style={styles.icon} contentFit="contain"
            transition={0} onDisplay={() => setIconDisplayed(true)} />
          <Text style={styles.body}>{copy.body}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.button}
            onPress={() => {
              void haptics.pageClose();
              dismiss();
            }}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>{copy.button}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </ScreenOverlay>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  card: {
    width: '100%',
    maxWidth: 390,
    minHeight: 360,
    borderRadius: 22,
    backgroundColor: '#83503D',
    paddingHorizontal: 24,
    paddingTop: 38,
    paddingBottom: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.72,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 22,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 19,
    lineHeight: 25,
    fontFamily: 'Inter_800ExtraBold',
    textAlign: 'center',
    marginBottom: 18,
  },
  icon: {
    width: 74,
    height: 74,
    marginBottom: 18,
  },
  body: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 22,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    marginBottom: 30,
  },
  button: {
    minWidth: 164,
    minHeight: 50,
    borderRadius: 13,
    backgroundColor: '#FFF9ED',
    paddingHorizontal: 24,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    color: '#4B2F1E',
    fontSize: 16,
    fontFamily: 'Inter_800ExtraBold',
    textAlign: 'center',
  },
});

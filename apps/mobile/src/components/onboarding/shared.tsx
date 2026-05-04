import { ReactNode } from 'react';
import {
  ActivityIndicator,
  ImageSourcePropType,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Shared building blocks for the 11 onboarding screens (stage 3.5).
 *
 * Visual contract derived from old Capacitor OnboardingFlow.js
 * (NovaMe dark navy theme + purple accent gradient + gentle
 * fade-in animations). Implementation is fully native React Native;
 * the old CSS keyframes are replaced by Stack slide_from_right
 * (configured in app/(onboarding)/_layout.tsx).
 */

// ---- ProgressBar ----

export function ProgressBar({ step, of = 11 }: { step: number; of?: number }) {
  const pct = Math.max(0, Math.min(1, step / of));
  return (
    <View style={pbStyles.track}>
      <View style={[pbStyles.fill, { width: `${pct * 100}%` }]} />
    </View>
  );
}

const pbStyles = StyleSheet.create({
  track: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#A855F7',
  },
});

// ---- PrimaryButton ----

type PrimaryButtonProps = {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export function PrimaryButton({
  children,
  onPress,
  disabled,
  loading,
}: PrimaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        btnStyles.btn,
        (disabled || loading) && btnStyles.btnDisabled,
        pressed && !disabled && !loading && btnStyles.btnPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={btnStyles.label}>{children}</Text>
      )}
    </Pressable>
  );
}

const btnStyles = StyleSheet.create({
  btn: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: '#A855F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.3,
  },
  btnPressed: {
    transform: [{ scale: 0.98 }],
  },
  label: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
});

// ---- BackButton ----

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={backStyles.btn}>
      <Text style={backStyles.arrow}>{'←'}</Text>
    </Pressable>
  );
}

const backStyles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 22,
    fontFamily: 'Inter_400Regular',
  },
});

// ---- Shell (with progress bar + back) ----

type ShellProps = {
  children: ReactNode;
  step: number;
  onBack?: () => void;
};

export function Shell({ children, step, onBack }: ShellProps) {
  return (
    <SafeAreaView style={shellStyles.root} edges={['top', 'left', 'right']}>
      <View style={shellStyles.header}>
        {onBack ? <BackButton onPress={onBack} /> : <View style={shellStyles.headerSpacer} />}
        <View style={shellStyles.progressContainer}>
          <ProgressBar step={step} />
        </View>
        <View style={shellStyles.headerSpacer} />
      </View>
      <View style={shellStyles.body}>{children}</View>
    </SafeAreaView>
  );
}

const shellStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0820',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
  },
  headerSpacer: {
    width: 40,
  },
  progressContainer: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
});

// ---- ImgPage (full-bleed image at top + content below) ----

type ImgPageProps = {
  children: ReactNode;
  btn?: ReactNode;
  imgSource?: ImageSourcePropType;
  vidUri?: string | null;
  vidPoster?: ReactNode;
};

export function ImgPage({ children, btn, imgSource, vidUri, vidPoster }: ImgPageProps) {
  return (
    <SafeAreaView style={imgPageStyles.root} edges={['top', 'left', 'right', 'bottom']}>
      <View style={imgPageStyles.imageContainer}>
        {vidUri ? (
          // step-10 hands an expo-video player here via a render prop.
          // imgPage itself does not import expo-video to keep this
          // shared component framework-agnostic.
          vidPoster ?? null
        ) : imgSource ? (
          <Image source={imgSource} style={imgPageStyles.image} resizeMode="cover" />
        ) : (
          <View style={imgPageStyles.imagePlaceholder} />
        )}
        <View style={imgPageStyles.gradient} />
      </View>
      <View style={imgPageStyles.content}>{children}</View>
      {btn ? <View style={imgPageStyles.footer}>{btn}</View> : null}
    </SafeAreaView>
  );
}

const imgPageStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0820',
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 7 / 6,
    overflow: 'hidden',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1A1430',
  },
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 96,
    backgroundColor: 'transparent',
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: 28,
    paddingBottom: 16,
  },
});

// ---- HighlightedText (parses {bold} segments) ----

export function HighlightedText({ text }: { text: string }) {
  const parts = text.split(/\{|\}/);
  return (
    <Text style={hiStyles.body}>
      {parts.map((segment, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={hiStyles.highlight}>
            {segment}
          </Text>
        ) : (
          <Text key={i}>{segment}</Text>
        ),
      )}
    </Text>
  );
}

const hiStyles = StyleSheet.create({
  body: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    lineHeight: 22,
    fontFamily: 'Inter_400Regular',
    fontStyle: 'italic',
  },
  highlight: {
    color: '#C084FC',
    fontFamily: 'Inter_700Bold',
    fontStyle: 'normal',
  },
});

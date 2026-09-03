import {
  createContext,
  forwardRef,
  useContext,
  useMemo,
  type ComponentProps,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
  Platform,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  useWindowDimensions,
} from 'react-native';

type TypographyScale = {
  heading: number;
  body: number;
};

const AndroidCompactTypographyContext = createContext<TypographyScale>({
  heading: 1,
  body: 1,
});

/**
 * Android's density + user font-scale combination makes Burrow's expressive
 * display type noticeably larger than the same composition on iOS. Keep the
 * phone layout airy without flattening accessibility completely: headings
 * receive the stronger reduction, body copy a gentler one, and roomy Android
 * windows retain slightly larger type than compact phones.
 */
export function getAndroidCompactTypographyScale(
  width: number,
  height: number,
  platform: typeof Platform.OS = Platform.OS,
): TypographyScale {
  if (platform !== 'android') return { heading: 1, body: 1 };

  const shortSide = Math.min(Math.max(0, width), Math.max(0, height));
  const longSide = Math.max(Math.max(0, width), Math.max(0, height));
  const availableRatio = Math.min(shortSide / 430, longSide / 932);
  const room = Math.max(0, Math.min(1, (availableRatio - 0.78) / 0.22));
  const heading = 0.8 + room * 0.08;

  return {
    heading,
    body: Math.min(0.96, heading + 0.1),
  };
}

export function AndroidCompactTypographyProvider({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const value = useMemo(
    () => getAndroidCompactTypographyScale(width, height),
    [height, width],
  );

  return (
    <AndroidCompactTypographyContext.Provider value={value}>
      {children}
    </AndroidCompactTypographyContext.Provider>
  );
}

function scaleForFontSize(fontSize: number, scale: TypographyScale): number {
  if (fontSize >= 24) return scale.heading;
  if (fontSize <= 17) return scale.body;

  const headingWeight = (fontSize - 17) / 7;
  return scale.body + (scale.heading - scale.body) * headingWeight;
}

export const AndroidCompactText = forwardRef<
  ComponentRef<typeof NativeText>,
  ComponentProps<typeof NativeText>
>(function AndroidCompactText({ style, maxFontSizeMultiplier, ...props }, ref) {
  const scale = useContext(AndroidCompactTypographyContext);
  const flat = StyleSheet.flatten(style);
  const fontSize = typeof flat?.fontSize === 'number' ? flat.fontSize : undefined;
  const lineHeight = typeof flat?.lineHeight === 'number' ? flat.lineHeight : undefined;
  // Large font-only Text nodes are normally emoji artwork. Do not shrink those
  // with the copy; named Inter faces identify Burrow's actual typography.
  const isLargeEmoji = fontSize !== undefined && fontSize >= 32 && !flat?.fontFamily;
  const multiplier = fontSize === undefined || isLargeEmoji
    ? 1
    : scaleForFontSize(fontSize, scale);

  return (
    <NativeText
      ref={ref}
      {...props}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (Platform.OS === 'android' ? 1.15 : undefined)}
      style={[
        style,
        multiplier !== 1
          ? {
              fontSize: fontSize! * multiplier,
              ...(lineHeight !== undefined ? { lineHeight: lineHeight * multiplier } : null),
            }
          : null,
      ]}
    />
  );
});

export const AndroidCompactTextInput = forwardRef<
  ComponentRef<typeof NativeTextInput>,
  ComponentProps<typeof NativeTextInput>
>(function AndroidCompactTextInput({ style, maxFontSizeMultiplier, ...props }, ref) {
  const scale = useContext(AndroidCompactTypographyContext);
  const flat = StyleSheet.flatten(style);
  const fontSize = typeof flat?.fontSize === 'number' ? flat.fontSize : undefined;
  const lineHeight = typeof flat?.lineHeight === 'number' ? flat.lineHeight : undefined;

  return (
    <NativeTextInput
      ref={ref}
      {...props}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (Platform.OS === 'android' ? 1.15 : undefined)}
      style={[
        style,
        Platform.OS === 'android' && fontSize !== undefined
          ? {
              fontSize: fontSize * scale.body,
              ...(lineHeight !== undefined ? { lineHeight: lineHeight * scale.body } : null),
            }
          : null,
      ]}
    />
  );
});

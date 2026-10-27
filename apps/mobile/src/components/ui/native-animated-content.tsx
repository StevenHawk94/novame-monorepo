import { forwardRef, type ReactNode } from 'react';
import { Animated, View, type ViewProps } from 'react-native';

/** RN 0.81 includes object-valued children in AnimatedProps identity. A fresh
 * React element can replace the native graph and restore the OLD transform.
 * Functions are excluded from that identity. Render current content inside the
 * forwarded native View, leaving the animation graph connected across updates.
 * This is not a content cache: navigation contexts and business props stay live. */
const ContentHost = forwardRef<View, ViewProps & { renderScene: () => ReactNode }>(
  function ContentHost({ renderScene, ...props }, ref) {
    return <View {...props} ref={ref}>{renderScene()}</View>;
  },
);

export const NativeAnimatedContent = Animated.createAnimatedComponent(ContentHost);

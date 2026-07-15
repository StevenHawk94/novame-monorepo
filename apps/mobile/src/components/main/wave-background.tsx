import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

/**
 * Layered gradient wave backdrop. A soft vertical gradient with two translucent
 * wave bands near the bottom, in the same hue family. Used behind the companion
 * sheet and each Kit screen; the palette prop selects a warm tone so the sheets
 * differ while staying in the light warm-toned system (reds / greens / yellows).
 *
 * Pure SVG, no images -- scales to any size via the absolute fill + viewBox.
 */
export type WavePalette = {
  top: string;     // gradient top color
  bottom: string;  // gradient bottom color
  wave1: string;   // upper wave band
  wave2: string;   // lower wave band
};

export const WAVE_PALETTES: Record<string, WavePalette> = {
  // Companion sheet -- warm orange
  orange: { top: '#F5B98A', bottom: '#EFD9C0', wave1: '#F2A97288', wave2: '#F7C79A88' },
  // Kits -- distinct warm tones (light reds / greens / yellows)
  newLens:    { top: '#F3C98F', bottom: '#F6E7C8', wave1: '#EEBB7788', wave2: '#F5D9A788' }, // amber
  trueNorth:  { top: '#EF9C8E', bottom: '#F6D9CE', wave1: '#E9877988', wave2: '#F3C0B088' }, // coral red
  quietWins:  { top: '#A8D69A', bottom: '#DCEFCE', wave1: '#93C88388', wave2: '#C4E5B088' }, // green
  tameEnemy:  { top: '#F0B87E', bottom: '#F7E3C4', wave1: '#EAA96788', wave2: '#F4D29A88' }, // warm gold
  visitMaster:{ top: '#EFC98A', bottom: '#F6E8C6', wave1: '#E9BB7388', wave2: '#F4DBA388' }, // pale gold
};

export function WaveBackground({ palette }: { palette: WavePalette }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.top} />
            <Stop offset="1" stopColor={palette.bottom} />
          </LinearGradient>
        </Defs>
        <Path d="M0 0 H400 V800 H0 Z" fill="url(#bg)" />
        {/* Two soft wave bands in the lower half */}
        <Path d="M0 520 C 100 480, 300 560, 400 510 L400 800 L0 800 Z" fill={palette.wave1} />
        <Path d="M0 610 C 120 570, 280 650, 400 600 L400 800 L0 800 Z" fill={palette.wave2} />
      </Svg>
    </View>
  );
}

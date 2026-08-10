import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Path, Pattern, Rect } from 'react-native-svg';

/**
 * Code-drawn replacement for assets/Background/connection.webp: the warm
 * beige checked paper. Colors and geometry measured from the original image
 * (base #F9DCB8, lines #FFECC8, ~56px cells / ~5px lines at 841px wide →
 * 25pt cells / 2pt lines on screen). Vector, so it stays crisp at any
 * resolution and costs no asset download.
 *
 * Layout note: the Svg element must NOT be the absolutely-positioned node —
 * neither width/height props nor left/right insets stretch it reliably
 * inside a padded parent (it came up ~14pt short on the right in the
 * companion sheet). A plain View owns the absoluteFill; the Svg just fills
 * it with flex:1.
 */
export function GridBackground({
  cell = 25,
  base = '#F9DCB8',
  line = '#FFECC8',
  lineWidth = 2,
  style,
}: {
  cell?: number;
  base?: string;
  line?: string;
  lineWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style ?? StyleSheet.absoluteFill} pointerEvents="none">
      <Svg style={{ flex: 1 }}>
        <Defs>
          <Pattern id="grid-bg" width={cell} height={cell} patternUnits="userSpaceOnUse">
            <Rect width={cell} height={cell} fill={base} />
            {/* Top + left edge of each tile; the repeat completes the grid. */}
            <Path
              d={`M ${cell} 0 L 0 0 0 ${cell}`}
              stroke={line}
              strokeWidth={lineWidth}
              fill="none"
            />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#grid-bg)" />
      </Svg>
    </View>
  );
}

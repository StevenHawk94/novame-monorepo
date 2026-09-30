import { StyleSheet, View } from 'react-native';

const HEARTS = [
  { left: '-8%', top: '8%', size: 116, opacity: .16, rotate: '-18deg' },
  { left: '73%', top: '15%', size: 82, opacity: .18, rotate: '20deg' },
  { left: '6%', top: '42%', size: 64, opacity: .13, rotate: '10deg' },
  { left: '66%', top: '56%', size: 146, opacity: .12, rotate: '-12deg' },
  { left: '-9%', top: '82%', size: 108, opacity: .1, rotate: '15deg' },
] as const;

// A CSS heart built from one rotated square and two circles, so the artwork
// remains crisp on every screen density without a separate bitmap asset.
export function MomentsHearts() {
  return <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
    {HEARTS.map((heart, index) => <View key={index} style={{ position: 'absolute', left: heart.left, top: heart.top, width: heart.size, height: heart.size, opacity: heart.opacity, transform: [{ rotate: heart.rotate }] }}>
      <View style={{ position: 'absolute', left: '25%', top: '25%', width: '60%', height: '60%', backgroundColor: '#FFD7BD', transform: [{ rotate: '45deg' }] }} />
      <View style={{ position: 'absolute', left: '10%', top: '11%', width: '60%', height: '60%', borderRadius: heart.size, backgroundColor: '#FFD7BD' }} />
      <View style={{ position: 'absolute', left: '40%', top: '11%', width: '60%', height: '60%', borderRadius: heart.size, backgroundColor: '#FFD7BD' }} />
    </View>)}
  </View>;
}

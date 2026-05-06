/**
 * Assets sub-tab — Stage 3.9.B.3 (placeholder for now)
 *
 * 3.9.B.1 only ships the Collection sub-tab. The full Assets flow
 * (unlock progress + product detail + shipping form + order history)
 * is implemented in 3.9.B.3-5.
 */
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export function AssetsView() {
  return (
    <View style={styles.root}>
      <MaterialIcons name="diamond" size={48} color="rgba(255,255,255,0.18)" />
      <Text style={styles.title}>Manifest Your Wisdom</Text>
      <Text style={styles.sub}>
        Wisdom Book and Wisdom Cards ordering arrives next.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 16,
    marginBottom: 6,
  },
  sub: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
});

/**
 * CaveShell — the Friends Cave sub-screen frame from the mocks: teal sky
 * band with the centered brown title, a dark-brown rounded shell holding a
 * cream inner panel, and the brown X close floating at the bottom. Friends
 * List / Friend Profile / Reflect Detail all wear it.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';

export function CaveShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <Text style={styles.title}>Friends Cave</Text>
        <View style={styles.shell}>
          <View style={styles.inner}>{children}</View>
        </View>
        <Pressable
          onPress={() => { void haptics.light(); router.back(); }}
          style={styles.closeBtn}
          hitSlop={10}
        >
          <MaterialIcons name="close" size={26} color="#FFFFFF" />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#8FBDB9' },
  title: {
    fontSize: 28, fontFamily: 'Inter_800ExtraBold', color: '#4A3220',
    textAlign: 'center', marginTop: 6, marginBottom: 10,
  },
  shell: {
    flex: 1, marginHorizontal: 10,
    backgroundColor: '#4A3220', borderTopLeftRadius: 36, borderTopRightRadius: 36,
    padding: 12, paddingBottom: 0,
  },
  inner: {
    flex: 1, backgroundColor: '#FBF7EE',
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
    padding: 16, overflow: 'hidden',
  },
  closeBtn: {
    position: 'absolute', bottom: 22, alignSelf: 'center',
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#4A3220',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#FBF7EE',
  },
});

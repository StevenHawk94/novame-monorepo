/**
 * Wisdom transcript modal — Stage 3.9.A.2.4
 *
 * Read view for a single wisdom from My Logs. Displays the full
 * transcript text + creation time, with a back button. The text is
 * passed in via the route param (encodeURIComponent JSON) so the
 * modal renders without a network round-trip.
 */
import { useLocalSearchParams, router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatRelativeShort } from '@/lib/relative-time';
import { haptics } from '@/lib/haptics';

type Payload = {
  text: string;
  description: string | null;
  createdAt: string;
};

function decodePayload(raw: string | undefined): Payload | null {
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw)) as Payload;
  } catch {
    return null;
  }
}

export default function WisdomTextModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ payload?: string }>();
  const payload = decodePayload(params.payload);

  const goBack = () => {
    void haptics.light();
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/growth');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
        >
          <MaterialIcons name="arrow-back" size={22} color="#1F1147" />
        </Pressable>
        <Text style={styles.headerTitle}>Wisdom</Text>
        <View style={styles.headerSpacer} />
      </View>

      {payload ? (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.time}>
            {formatRelativeShort(payload.createdAt)} ago
          </Text>
          <Text style={styles.body}>{payload.text || '(no transcript)'}</Text>
        </ScrollView>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Could not load this wisdom.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Stage 6.LightTheme: full inversion from dark (#1A0F3D bg + white
  // text) to light (white bg + deep-purple text #1F1147). The dark
  // theme felt heavy for a reading view; light theme reads more like
  // a journal page, matches the deep-purple text used elsewhere
  // (Insight cards, PhaseTypeInput input box). All alpha values
  // mirror the previous dark-mode opacities so the visual hierarchy
  // (primary > secondary > tertiary text) is preserved.
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  headerSpacer: {
    width: 36,
    height: 36,
  },
  headerTitle: {
    color: '#1F1147',
    fontSize: 17,
    fontWeight: '700',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  time: {
    color: 'rgba(31,17,71,0.4)',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 12,
  },
  description: {
    color: 'rgba(31,17,71,0.7)',
    fontSize: 14,
    fontStyle: 'italic',
    marginBottom: 16,
    lineHeight: 20,
  },
  body: {
    color: '#1F1147',
    fontSize: 16,
    lineHeight: 26,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    color: 'rgba(31,17,71,0.4)',
    fontSize: 14,
  },
});

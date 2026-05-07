import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import type { DefaultAvatar } from '@/lib/wisdom-center-api';

/**
 * Compact avatar pile (5 circles, ~25% overlap) used in:
 *   - Growth Center Community Resonance card (Stage 3.10.3 A)
 *   - Weekly Report Echo section          (Stage 3.10.3 B)
 *
 * Always renders 5 slots so the visual width is stable. Slots without
 * a server-supplied avatar fall back to a colored emoji circle (same
 * fallback set as the legacy capacitor implementation, so behavior is
 * identical for users with empty leaderboard_seeds rows).
 *
 * Each cell handles its own image-error state; a 404 on one URL only
 * collapses that slot to the emoji fallback rather than the whole row.
 */

const FALLBACK_EMOJIS = ['🦊', '🐱', '🐼', '🦉', '🐸'];

const FALLBACK_BG_COLORS = [
  'hsl(200, 60%, 30%)',
  'hsl(260, 60%, 30%)',
  'hsl(320, 60%, 30%)',
  'hsl(20, 60%, 30%)',
  'hsl(80, 60%, 30%)',
];

export type AvatarRowProps = {
  avatars: DefaultAvatar[];
};

export function AvatarRow({ avatars }: AvatarRowProps) {
  return (
    <View style={styles.row}>
      {[0, 1, 2, 3, 4].map((i) => {
        const av = avatars[i];
        return (
          <AvatarSlot
            key={i}
            uri={av?.url ?? null}
            fallbackEmoji={FALLBACK_EMOJIS[i]}
            fallbackBg={FALLBACK_BG_COLORS[i]}
          />
        );
      })}
    </View>
  );
}

function AvatarSlot({
  uri,
  fallbackEmoji,
  fallbackBg,
}: {
  uri: string | null;
  fallbackEmoji: string;
  fallbackBg: string;
}) {
  const [errored, setErrored] = useState(false);
  if (!uri || errored) {
    return (
      <View style={[styles.slot, { backgroundColor: fallbackBg }]}>
        <Text style={styles.emoji}>{fallbackEmoji}</Text>
      </View>
    );
  }
  return (
    <View style={styles.slot}>
      <Image
        source={{ uri }}
        style={styles.img}
        contentFit="cover"
        onError={() => setErrored(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  slot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#0F0B2E',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  img: {
    width: '100%',
    height: '100%',
  },
  emoji: {
    fontSize: 14,
  },
});

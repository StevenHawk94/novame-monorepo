import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { resolveAvatarSource } from '@/lib/avatar';

/**
 * Circular user avatar: the uploaded photo when the user actually set one
 * (isDefaultAvatar === false), else their assigned bundled default — a
 * deterministic pick from the userId, so any device renders the same
 * "random" portrait for the same person without extra requests.
 */
export function UserAvatar({
  userId,
  avatarUrl,
  isDefaultAvatar,
  size = 46,
}: {
  userId: string | null | undefined;
  avatarUrl?: string | null;
  isDefaultAvatar?: boolean | null;
  size?: number;
}) {
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={resolveAvatarSource(avatarUrl, isDefaultAvatar, userId)}
        style={styles.img}
        contentFit="cover"
        contentPosition="center"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#F4F1F8', overflow: 'hidden' },
  img: { width: '100%', height: '100%' },
});

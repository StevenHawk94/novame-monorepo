import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { haptics } from '@/lib/haptics';
import { CaveShell } from '@/components/main/cave-shell';
import { fetchFriends, type FriendsStatus } from '@/lib/friends-api';
import { UserAvatar } from '@/components/ui/user-avatar';

/**
 * Friends List (mock 1:1): the roster inside the cave shell — avatar, name,
 * and a brown Profile pill with the orange drop; hairline dividers between
 * rows; X closes back to the cave.
 */
export default function FriendsListScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<FriendsStatus>({ inviteCode: null, friends: [], pending: [], sent: [] });

  useFocusEffect(
    useCallback(() => {
      void fetchFriends().then(setStatus);
    }, []),
  );

  return (
    <CaveShell>
      <ScrollView showsVerticalScrollIndicator={false}>
        {status.friends.length === 0 ? (
          <Text style={styles.empty}>No friends yet — share your Friend ID to get started!</Text>
        ) : (
          status.friends.map((f, i) => (
            <View key={f.userId}>
              {i > 0 && <View style={styles.divider} />}
              <View style={styles.row}>
                <UserAvatar userId={f.userId} avatarUrl={f.avatarUrl} isDefaultAvatar={f.isDefaultAvatar} size={46} />
                <Text style={styles.name} numberOfLines={1}>{f.displayName}</Text>
                <Pressable
                  onPress={() => {
                    void haptics.light();
                    router.push({
                      pathname: '/(main)/friend-profile' as never,
                      params: { friendUserId: f.userId, friendName: f.displayName },
                    } as never);
                  }}
                  style={({ pressed }) => [styles.profileBtn, pressed && { transform: [{ translateY: 2 }] }]}
                >
                  <Text style={styles.profileText}>Profile</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </CaveShell>
  );
}

const styles = StyleSheet.create({
  empty: {
    fontSize: 14, fontFamily: 'Inter_500Medium', color: '#8A7A63',
    textAlign: 'center', lineHeight: 21, paddingVertical: 40, paddingHorizontal: 20,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18 },
  divider: { height: 2, backgroundColor: '#E3DACB', borderRadius: 1 },
  name: { flex: 1, fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: '#1B1B1B' },
  profileBtn: {
    backgroundColor: '#4A3220', borderRadius: 20, paddingHorizontal: 30, paddingVertical: 14,
    shadowColor: '#D98B4B', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  profileText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_800ExtraBold' },
});

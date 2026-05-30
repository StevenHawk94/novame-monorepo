import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

const APP_STORE_URL = 'https://apps.apple.com/app/id6763723281';

/**
 * Full-screen, UNESCAPABLE hard-update screen.
 *
 * Rendered only when force-update.ts has positively determined the installed
 * version is below the server min_version (fail-open lives there, not here --
 * by the time this mounts, blocking is intended).
 *
 * Deliberately blocking: no close button, no backdrop dismiss, and
 * onRequestClose is a no-op so the Android hardware back button cannot
 * dismiss it. The only action is "Update Now" -> App Store.
 */
export function ForceUpdateGate({ message }: { message: string | null }) {
  const handleUpdate = () => {
    void Linking.openURL(APP_STORE_URL).catch(() => {
      // If the store URL somehow fails to open, there is nothing else the user
      // can do from here; leave the screen up so they can retry.
    });
  };

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={() => {}}>
      <View style={styles.root}>
        <View style={styles.body}>
          <Text style={styles.title}>Update Required</Text>
          <Text style={styles.message}>
            {message && message.trim().length > 0
              ? message
              : 'This version of NovaMe is out of date. Please update to continue.'}
          </Text>
          <Pressable
            onPress={handleUpdate}
            style={({ pressed }) => [styles.button, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.buttonText}>Update Now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0823',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  body: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    marginBottom: 14,
    textAlign: 'center',
  },
  message: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 32,
  },
  button: {
    width: '100%',
    backgroundColor: '#EC4899',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
});

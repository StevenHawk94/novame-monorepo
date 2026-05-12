/**
 * Skin unlock modal (Stage 5.WR.2, Bug 3).
 *
 * Shown when the user crosses an outfit-unlock threshold.
 * Renders globally via tabs _layout.tsx subscribing to
 * useSkinUnlockHead from skin-unlock-store.
 *
 * Behavior:
 *   - "Switch" button: calls switchOutfit() and waits for the round-
 *     trip to finish before closing. Mirrors the home top-right
 *     skin-select modal pattern (apps/mobile/app/(main)/(modals)/
 *     skin-select.tsx) so the visual transition video plays as the
 *     user expects.
 *   - "Later" button: closes immediately, no server call. Queue head
 *     is dequeued so the next pending unlock (if any) renders next.
 *
 * The image asset is loaded via require() with a switch/case fallback
 * because React Native's Metro bundler can't analyze dynamic require()
 * paths at compile time — every asset must be statically referenced.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { switchOutfit } from '@/lib/character-state';
import { dequeueSkinUnlock } from '@/lib/skin-unlock-store';

// Statically-resolved asset imports — Metro can't bundle dynamic
// require() paths, so we map outfit number to its require() result
// up front. char-1-skinN.webp where N = 1..6.
const SKIN_IMAGES: Record<number, ImageSourcePropType> = {
  1: require('../../../assets/characters/char-1-skin1.webp'),
  2: require('../../../assets/characters/char-1-skin2.webp'),
  3: require('../../../assets/characters/char-1-skin3.webp'),
  4: require('../../../assets/characters/char-1-skin4.webp'),
  5: require('../../../assets/characters/char-1-skin5.webp'),
  6: require('../../../assets/characters/char-1-skin6.webp'),
};

type SkinUnlockModalProps = {
  /** Outfit number 1-6 to display. */
  outfitNum: number;
  /** Current authenticated user id, required for switchOutfit RPC. */
  userId: string | null;
};

export function SkinUnlockModal({ outfitNum, userId }: SkinUnlockModalProps) {
  const [busy, setBusy] = useState(false);
  const image = SKIN_IMAGES[outfitNum] ?? SKIN_IMAGES[1];

  const handleSwitch = async () => {
    if (!userId || busy) return;
    setBusy(true);
    try {
      await switchOutfit(userId, outfitNum);
      // Success — dequeue and close. The fresh CachedCharacterState
      // is already written to MMKV by switchOutfit, so the next
      // home tab focus will pick it up via getCachedCharacterState.
      dequeueSkinUnlock();
    } catch (e) {
      console.warn('[skin-unlock-modal] switchOutfit failed:', e);
      // Don't close — leave the user a chance to retry or tap Later.
      setBusy(false);
    }
  };

  const handleLater = () => {
    if (busy) return;
    dequeueSkinUnlock();
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // Tapping outside should NOT dismiss — user must explicitly
      // choose Switch or Later. This matches Pokemon-style reward
      // dialogs where the unlock event is a moment of celebration,
      // not something to swat away accidentally.
      onRequestClose={() => {}}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>🎉 Congratulations!</Text>
          <Text style={styles.headline}>You've Unlocked a New Skin</Text>

          <View style={styles.imageWrap}>
            <Image source={image} style={styles.image} resizeMode="contain" />
          </View>

          <Text style={styles.subhead}>Do you want to switch now?</Text>

          <View style={styles.buttonRow}>
            <Pressable
              onPress={handleLater}
              disabled={busy}
              style={({ pressed }) => [
                styles.laterButton,
                pressed && !busy ? styles.buttonPressed : null,
                busy ? styles.buttonDisabled : null,
              ]}
            >
              <Text style={styles.laterLabel}>Later</Text>
            </Pressable>

            <Pressable
              onPress={handleSwitch}
              disabled={busy}
              style={({ pressed }) => [
                styles.switchButton,
                pressed && !busy ? styles.buttonPressed : null,
                busy ? styles.buttonDisabled : null,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.switchLabel}>Switch</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1A1430',
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#A855F7',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 12,
  },
  eyebrow: {
    color: '#C4B5FD',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  headline: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  imageWrap: {
    width: 180,
    height: 180,
    backgroundColor: '#0F0B2E',
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  subhead: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  laterButton: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  switchButton: {
    flex: 1,
    backgroundColor: '#7C3AED',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  switchLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});

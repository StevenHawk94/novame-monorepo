import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ASPIRE_WORDS } from '@/components/onboarding/constants';
import { haptics } from '@/lib/haptics';

/**
 * Shared aspire-words chip-grid picker.
 *
 * Reused by:
 *   - apps/mobile/app/(onboarding)/step-2.tsx
 *     (initial onboarding selection -> MMKV draft -> server on completion)
 *   - apps/mobile/app/(main)/(modals)/edit-aspire-words.tsx
 *     (post-onboarding re-selection -> direct POST /api/update-profile)
 *
 * Controlled component: parent owns the `selected` state and reacts to
 * `onChange`. The picker only enforces `maxCount` (refuses to add a
 * 7th chip) -- minimum-count gating (e.g. Continue/Save disabled until
 * 4 picked) lives in the parent because the CTA UI lives there too.
 *
 * Visual contract mirrors the onboarding step-2 chip-grid exactly so
 * users editing later see the same chip styling they remember from
 * onboarding.
 */

export type AspireWordsPickerProps = {
  selected: string[];
  onChange: (next: string[]) => void;
  maxCount?: number;
};

export function AspireWordsPicker({
  selected,
  onChange,
  maxCount = 6,
}: AspireWordsPickerProps) {
  const toggle = (word: string) => {
    void haptics.light();
    let next: string[];
    if (selected.includes(word)) {
      next = selected.filter((w) => w !== word);
    } else if (selected.length < maxCount) {
      next = [...selected, word];
    } else {
      return; // already at cap, ignore
    }
    onChange(next);
  };

  return (
    <View style={styles.grid}>
      {ASPIRE_WORDS.map((word) => {
        const active = selected.includes(word);
        return (
          <Pressable
            key={word}
            onPress={() => toggle(word)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {word}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  chipActive: {
    backgroundColor: 'rgba(168,85,247,0.25)',
    borderColor: 'rgba(168,85,247,0.6)',
  },
  chipText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  chipTextActive: {
    color: '#C084FC',
  },
});

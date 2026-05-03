import { Text, View } from 'react-native';

/**
 * Stage 3.1 placeholder component.
 *
 * Used by all route placeholder files (tabs, modals, onboarding, auth)
 * until each route is fully built in stage 3.4 / 3.5 / 3.6+.
 *
 * Uses NovaMe color palette (D20 decision B): dark navy background,
 * purple accent text, low-contrast subtitle.
 *
 * Will be deleted at end of stage 3 once all routes have real content.
 */
type PlaceholderProps = {
  name: string;
};

export function Placeholder({ name }: PlaceholderProps) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#0F0B2E',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#C084FC', fontSize: 18, fontWeight: '600' }}>
        {name}
      </Text>
      <Text
        style={{
          color: 'rgba(255,255,255,0.4)',
          fontSize: 12,
          marginTop: 8,
        }}
      >
        stage 3.1 placeholder
      </Text>
    </View>
  );
}

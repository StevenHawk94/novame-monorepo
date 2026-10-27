import { Stack } from 'expo-router';
import { MAIN_CARD_OPTIONS } from '@/lib/main-navigation-options';

/** Historical group name; settings/detail routes follow the same edge-back
 * card hierarchy as Menu. Inline bottom sheets own their own presentation. */
export default function ModalsLayout() {
  return <Stack screenOptions={MAIN_CARD_OPTIONS} />;
}

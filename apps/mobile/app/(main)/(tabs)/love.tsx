import { Redirect } from 'expo-router';
import { BurrowScreen } from '@/components/burrow/burrow-screen';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';

export default function LoveTab() {
  return useMajorUpdateEnabled() ? <BurrowScreen section="affection" asTab /> : <Redirect href="/(main)/(tabs)" />;
}

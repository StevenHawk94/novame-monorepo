import { Redirect } from 'expo-router';
import { BurrowScreen } from '@/components/burrow/burrow-screen';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';

export default function CollectionTab() {
  return useMajorUpdateEnabled() ? <BurrowScreen section="collection" asTab /> : <Redirect href="/(main)/(tabs)" />;
}

import { NativeTabRedirect } from '@/components/main/native-tab-redirect';

/** Legacy scene links now open the current Shop, not the retired scene store. */
export default function SceneSelectScreen() {
  return <NativeTabRedirect href="/(main)/(tabs)/shop" />;
}

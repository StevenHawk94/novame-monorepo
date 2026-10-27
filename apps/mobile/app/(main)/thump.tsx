import { NativeTabRedirect } from '@/components/main/native-tab-redirect';

/** Compatibility destination for old links. Bunny Court is retired. */
export default function RetiredCourtScreen() {
  return <NativeTabRedirect href="/(main)/(tabs)" />;
}

import { NativeTabRedirect } from '@/components/main/native-tab-redirect';

/** Compatibility destination for retired Visit Master links. */
export default function VisitMasterScreen() {
  return <NativeTabRedirect href="/(main)/(tabs)" />;
}

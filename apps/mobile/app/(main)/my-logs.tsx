import { NativeTabRedirect } from '@/components/main/native-tab-redirect';

/** Compatibility link for a retired pre-Burrow page; no legacy reads or writes. */
export default function RetiredScreen() {
  return <NativeTabRedirect href="/(main)/(tabs)/friends" />;
}

import { NativeTabRedirect } from '@/components/main/native-tab-redirect';

/** The old companion Kit picker is no longer part of Burrow. */
export default function CompanionSheetRoute() {
  return <NativeTabRedirect href="/(main)/(tabs)" />;
}

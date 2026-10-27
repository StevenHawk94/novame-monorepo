import { NativeTabRedirect } from '@/components/main/native-tab-redirect';

/** Legacy cosmetic links now open the current Shop; no old video catalog. */
export default function OutfitClosetScreen() {
  return <NativeTabRedirect href="/(main)/(tabs)/shop" />;
}

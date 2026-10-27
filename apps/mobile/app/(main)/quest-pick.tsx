import { NativeTabRedirect } from '@/components/main/native-tab-redirect';

/** Old custom-quest links return to the current quest board. */
export default function RetiredQuestScreen() {
  return <NativeTabRedirect href="/(main)/(tabs)/quests" />;
}

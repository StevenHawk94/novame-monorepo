import { RetainedTabs } from '@/components/main/retained-tabs-navigator';

/** Burrow is the only bundled experience; retain its existing tab lifecycle. */
export default function TabsLayout() {
  return <RetainedTabs backBehavior="history" initialRouteName="index" screenOptions={{ headerShown: false, lazy: true }} />;
}

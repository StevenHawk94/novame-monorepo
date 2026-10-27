import { useEffect } from 'react';
import SubscriptionPaywallModal from './subscription-paywall';
import { recordReflectionPaywallVariantShown, type ReflectionPaywallVariant } from '@/lib/reflection-paywall-count';
import { useLocalSearchParams } from 'expo-router';

/** Preserve promotional cadence/bookkeeping, never a second visual variant. */
export default function ReflectionPlusPaywallModal() {
  const { variant } = useLocalSearchParams<{ variant?: string }>();
  const recorded: ReflectionPaywallVariant = variant === '2' ? '2' : '1';
  useEffect(() => recordReflectionPaywallVariantShown(recorded), [recorded]);
  return <SubscriptionPaywallModal />;
}

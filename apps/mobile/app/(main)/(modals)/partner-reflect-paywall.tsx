import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import SubscriptionPaywallModal from './subscription-paywall';
import { clearPartnerReflectPaywallAssignment, getPartnerReflectPaywallAssignment, recordPartnerReflectPaywallClick } from '@/lib/partner-reflect-paywall';

/** Campaign assignment remains analytics-only; no Admin-selected UI or copy. */
export default function PartnerReflectPaywallModal() {
  const [assignment] = useState(getPartnerReflectPaywallAssignment);
  useEffect(() => {
    if (!assignment) router.back();
    return () => clearPartnerReflectPaywallAssignment();
  }, [assignment]);
  if (!assignment) return null;
  return <SubscriptionPaywallModal onClose={clearPartnerReflectPaywallAssignment} onContinue={() => {
    void recordPartnerReflectPaywallClick(assignment);
    clearPartnerReflectPaywallAssignment();
  }}/>;
}

import { useEffect, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { sessionEpoch } from './session-lifecycle';
import { cancelCoinPurchase, requestCoinPurchase, showCoinPurchaseSuccess, type CoinPurchaseOffer } from './coin-purchase-prompt';

/** Navigation/account/pair changes revoke an unanswered confirmation. */
export function useCoinPurchaseConfirmation(scope: string) {
  const focused = useIsFocused();
  const owner = useRef({ live: false, scope, focused }).current;
  owner.scope = scope; owner.focused = focused;
  const epoch = sessionEpoch();
  useEffect(() => {
    owner.live = true;
    return () => { owner.live = false; cancelCoinPurchase(owner); };
  }, [owner]);
  useEffect(() => {
    if (!focused) cancelCoinPurchase(owner);
    return () => cancelCoinPurchase(owner);
  }, [owner, focused, scope]);
  const isCurrent = () => owner.live && owner.focused && owner.scope === scope && epoch === sessionEpoch();
  return {
    isCurrent,
    confirm: (offer: CoinPurchaseOffer) => requestCoinPurchase(owner, offer, isCurrent),
    success: (name: string) => { if (isCurrent()) showCoinPurchaseSuccess(name); },
  };
}

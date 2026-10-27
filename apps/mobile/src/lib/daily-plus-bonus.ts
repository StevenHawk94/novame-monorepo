import { coinArrivalTiming } from './burrow-motion';

export type DailyPlusBonusState = {
  eligible: boolean; claimed: boolean; amount: number; localDate: string; key: string;
};
/** Screen coordinates measured from Home, not guessed from the artwork crop. */
export type HomeWalletAnchor = {
  x: number; y: number; width: number; height: number;
  coinSize: number; fontSize: number; gap: number; paddingLeft: number; paddingRight: number;
};
export const PLUS_COIN_FLIGHT_MS = coinArrivalTiming(0).flightEnd;
export function dailyPlusBonusAvailable(bonus: DailyPlusBonusState | undefined, localDate: string) {
  return !!bonus?.eligible && !bonus.claimed && bonus.amount > 0
    && bonus.localDate === localDate && bonus.key === `plus-login:${localDate}`;
}

/** Display-only store metadata. Never selects an offer or changes checkout. */
export type TrialUnit = 'day' | 'week' | 'month' | 'year';
export type TrialDuration = { unit: TrialUnit; value: number }[];
const units: TrialUnit[] = ['year', 'month', 'week', 'day'];
const positive = (n: unknown) => Number.isSafeInteger(Number(n)) && Number(n) > 0;

/** Shared display formatting only. The actual charge remains the store price. */
export function formatSubscriptionCurrency(amount: number, currency: string): string {
  if (!Number.isFinite(amount) || amount < 0 || !currency)
    throw new Error('The store returned incomplete subscription pricing.');
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** One subscription covers two users; annual billing covers twelve months. */
export function perUserMonthlyPrice(plan: {price:number;currency:string}, cycle: 'yearly'|'monthly'): string {
  return formatSubscriptionCurrency(plan.price / (cycle === 'yearly' ? 24 : 2), plan.currency);
}

export function iosTrialDuration(product: unknown): TrialDuration | null {
  const p = product as { subscriptionInfoIOS?: { introductoryOffer?: { period?: { unit?: string; value?: number }; periodCount?: number } };
    subscriptionOffers?: { type?: string; paymentMode?: string; period?: { unit?: string; value?: number }; periodCount?: number }[];
    introductoryPriceSubscriptionPeriodIOS?: string; introductoryPriceNumberOfPeriodsIOS?: string } | null;
  if (!p) return null;
  const offer = p.subscriptionInfoIOS?.introductoryOffer
    ?? p.subscriptionOffers?.find(o => o.type === 'introductory' && o.paymentMode === 'free-trial');
  if (offer?.period) {
    const { unit, value } = offer.period, count = offer.periodCount ?? 1;
    if (units.includes(unit as TrialUnit) && positive(value) && positive(count) && positive(Number(value) * count))
      return [{ unit: unit as TrialUnit, value: Number(value) * count }];
    return null;
  }
  const unit = p.introductoryPriceSubscriptionPeriodIOS, value = Number(p.introductoryPriceNumberOfPeriodsIOS);
  return units.includes(unit as TrialUnit) && positive(value) ? [{ unit: unit as TrialUnit, value }] : null;
}

export function androidTrialDuration(offer: unknown): TrialDuration | null {
  const phases = (offer as { pricingPhasesAndroid?: { pricingPhaseList?: {
    priceAmountMicros?: string; billingPeriod?: string; billingCycleCount?: number }[] } } | null)?.pricingPhasesAndroid?.pricingPhaseList;
  const free = phases?.filter(p => typeof p.priceAmountMicros === 'string' && /^0+$/.test(p.priceAmountMicros));
  if (!free?.length) return null;
  const totals: Record<TrialUnit, number> = { year: 0, month: 0, week: 0, day: 0 };
  for (const phase of free) {
    const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(phase.billingPeriod ?? '');
    const count = phase.billingCycleCount;
    if (!match || !positive(count) || !match.slice(1).some(n => positive(n))) return null;
    units.forEach((unit, i) => { totals[unit] += Number(match[i + 1] ?? 0) * Number(count); });
  }
  const duration = units.filter(unit => totals[unit] > 0).map(unit => ({ unit, value: totals[unit] }));
  return duration.length && duration.every(p => positive(p.value)) ? duration : null;
}

export function trialDurationText(duration?: TrialDuration | null, title = false): string | null {
  if (!duration?.length || duration.some(p => !units.includes(p.unit) || !positive(p.value))) return null;
  return duration.map(({ unit, value }) => `${value} ${title ? unit[0].toUpperCase() + unit.slice(1) : unit}${value === 1 ? '' : 's'}`).join(' + ');
}

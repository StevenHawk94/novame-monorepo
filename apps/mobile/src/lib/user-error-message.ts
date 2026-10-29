/** Presentation only: never change the original error/receipt used by retry,
 * conflict, rate-limit or payment decisions. Unknown diagnostics stay in logs. */
export function userErrorMessage(error: unknown, fallback = 'Couldn’t finish this time. Please try again.') {
  const e = error as { body?: { error?: unknown }; message?: unknown; kind?: string; status?: number } | null;
  const code = typeof e?.body?.error === 'string' ? e.body.error : typeof e?.message === 'string' ? e.message : '';
  const messages: Record<string, string> = {
    'We couldn’t reconnect to your account. Please try again.': 'We couldn’t reconnect to your account. Please try again.',
    'Coin purchases are temporarily unavailable. Please try again later.': 'Coin purchases are temporarily unavailable. Please try again later.',
    'We couldn’t finish syncing your purchase. Try Restore Purchases': 'We couldn’t finish syncing your purchase. Try Restore Purchases',
    not_paired: 'Connect with your partner, then try again.',
    pair_changed: 'Your pairing changed. Reopen this page to continue.',
    session_changed: 'Your account changed. Reopen this page to continue.',
    auth_refresh_failed: 'Couldn’t reconnect to your account. Check your connection and try again.',
    Unauthorized: 'Please reconnect to your account and try again.',
    network_error: 'Couldn’t connect. Your saved progress is still here. Please try again.',
    'Operation timed out': 'This is taking longer than expected. Please try again; a confirmed purchase will not be charged twice.',
    insufficient_balance: 'Not enough coins. Add coins and try again.',
    price_changed: 'The price changed. Review the updated price before trying again. No coins were spent.',
    plus_required: 'This item requires Burrow Plus.',
    not_found: 'This is no longer available. Refresh this page and try again.',
    feature_disabled: 'This feature is temporarily unavailable. Please try again later.',
    daily_limit_reached: 'You’ve completed today’s allowance. Come back tomorrow.',
  };
  if (messages[code]) return messages[code];
  if (e?.kind === 'network') return 'Couldn’t connect. Please check your connection and try again.';
  if (e?.status === 429) return 'Please wait a moment, then try again.';
  // Existing IAP adapters deliberately produce these user-facing sentences.
  // Keep ownership/recovery guidance, but never expose URLs, codes or stacks.
  if (/^(Your |Please |This purchase |Google Play |Apple |The store |We could |Carrot purchases |A purchase is |Payment is |The pending )/.test(code)
    && code.length <= 400 && !/https?:|\n|\bHTTP\b|\bError:|[a-z]+_[a-z]+/.test(code)) return code;
  return fallback;
}

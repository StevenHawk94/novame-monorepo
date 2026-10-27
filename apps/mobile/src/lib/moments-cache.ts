import { createMomentsCache } from './moments-cache-state';
import { fetchBurrowHistory } from './burrow-history';
import { getBurrowSnapshot } from './burrow-store';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { afterUiSettles } from './ui-idle';

export const momentsCache = createMomentsCache({
  epoch: sessionEpoch,
  valid: data => {
    const latest = getBurrowSnapshot().data;
    return data.profile.id === sessionUserId() && latest?.profile.id === data.profile.id
      && latest.partner?.id === data.partner?.id && latest.pairVersion === data.pairVersion
      && (!data.partner || (data.pairAccessVerified === true && latest.pairAccessVerified === true));
  },
  fetch: (partner, cursor) => fetchBurrowHistory('moments', partner, cursor, ''),
  defer: () => new Promise(resolve => afterUiSettles(resolve, { requireForeground: false })),
});
subscribeSessionIdentity(() => momentsCache.reset());

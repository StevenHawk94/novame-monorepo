import type { RealtimeChannel } from '@supabase/supabase-js';

import {
  fetchFriendFeed,
  fetchFriends,
  fetchPairing,
  getCachedPairing,
  notifyRemoteSharedBoxChanged,
  type FeedEntry,
  type FriendsStatus,
  type PairingStatus,
} from './friends-api';
import { supabase } from './supabase';

export type PairingRealtimeSnapshot = {
  pairing: PairingStatus;
  friends: FriendsStatus;
  feed: FeedEntry[];
};

type Listener = (snapshot: PairingRealtimeSnapshot) => void;
type FriendshipListener = (status: FriendsStatus) => void;

const listeners = new Set<Listener>();
const friendshipListeners = new Set<FriendshipListener>();
let channel: RealtimeChannel | null = null;
let activeUserId: string | null = null;
let generation = 0;
let reconcileInFlight: Promise<void> | null = null;
let friendshipReconcileInFlight: Promise<void> | null = null;

function publish(snapshot: PairingRealtimeSnapshot): void {
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[pairing] realtime listener failed:', error);
    }
  }
}

function publishFriendships(status: FriendsStatus): void {
  for (const listener of friendshipListeners) {
    try {
      listener(status);
    } catch (error) {
      console.warn('[pairing] friendship realtime listener failed:', error);
    }
  }
}

async function reconcileFriendships(userId: string, expectedGeneration: number): Promise<void> {
  if (friendshipReconcileInFlight) return friendshipReconcileInFlight;
  const request = (async () => {
    try {
      const friends = await fetchFriends({ force: true });
      if (activeUserId !== userId || generation !== expectedGeneration) return;
      publishFriendships(friends);
    } catch (error) {
      console.warn('[pairing] friendship realtime reconcile failed:', error);
    }
  })().finally(() => {
    if (friendshipReconcileInFlight === request) friendshipReconcileInFlight = null;
  });
  friendshipReconcileInFlight = request;
  return request;
}

async function reconcile(userId: string, expectedGeneration: number): Promise<void> {
  if (reconcileInFlight) return reconcileInFlight;
  const request = (async () => {
    try {
      // A pairing notification is an explicit invalidation signal, so these
      // reads intentionally bypass only their TTL. The cache storage and every
      // page's normal cache-first behavior remain unchanged.
      const [pairing, friends] = await Promise.all([
        fetchPairing({ force: true }),
        fetchFriends({ force: true }),
      ]);
      const feed = pairing.paired
        ? await fetchFriendFeed(undefined, { force: true })
        : [];
      if (activeUserId !== userId || generation !== expectedGeneration) return;
      publish({ pairing, friends, feed });
    } catch (error) {
      // The next channel reconnect or app foreground retries. Existing cached
      // state stays visible instead of turning a transport failure into a UI
      // or process failure.
      console.warn('[pairing] realtime reconcile failed:', error);
    }
  })().finally(() => {
    if (reconcileInFlight === request) reconcileInFlight = null;
  });
  reconcileInFlight = request;
  return request;
}

export function subscribePairingRealtime(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeFriendshipRealtime(listener: FriendshipListener): () => void {
  friendshipListeners.add(listener);
  return () => friendshipListeners.delete(listener);
}

export async function startPairingRealtime(userId: string): Promise<void> {
  let attemptGeneration: number | null = null;
  try {
    if (activeUserId === userId && channel) {
      void reconcile(userId, generation);
      return;
    }

    await stopPairingRealtime();
    attemptGeneration = ++generation;

    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session || session.user.id !== userId || attemptGeneration !== generation) return;

    await supabase.realtime.setAuth(session.access_token);
    if (attemptGeneration !== generation) return;

    activeUserId = userId;
    const subscribedGeneration = attemptGeneration;
    channel = supabase
      .channel(`pairing:${userId}`, { config: { private: true } })
      .on('broadcast', { event: 'pairing_changed' }, () => {
        void reconcile(userId, subscribedGeneration);
      })
      .on('broadcast', { event: 'friendship_invited' }, () => {
        // Invite events only invalidate the small Friends status resource.
        void reconcileFriendships(userId, subscribedGeneration);
      })
      .on('broadcast', { event: 'shared_box_changed' }, (message) => {
        const partnerUserId = message.payload?.partner_user_id;
        if (typeof partnerUserId !== 'string' || !partnerUserId) return;
        // Treat broadcast payloads as invalidations, not authority. Only the
        // currently authenticated pairing may select which local cache moves.
        if (getCachedPairing()?.partner?.userId !== partnerUserId) return;
        notifyRemoteSharedBoxChanged(partnerUserId);
      })
      .subscribe((status) => {
        // Reconcile after every successful subscription as the delivery
        // fallback for events missed while the device was offline/backgrounded.
        if (status === 'SUBSCRIBED') void reconcile(userId, subscribedGeneration);
      });
  } catch (error) {
    if (attemptGeneration === null || attemptGeneration === generation) {
      activeUserId = null;
      channel = null;
    }
    console.warn('[pairing] realtime start failed:', error);
  }
}

export async function resumePairingRealtime(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) return;
    await startPairingRealtime(userId);
  } catch (error) {
    console.warn('[pairing] realtime resume failed:', error);
  }
}

export async function stopPairingRealtime(): Promise<void> {
  generation += 1;
  activeUserId = null;
  reconcileInFlight = null;
  friendshipReconcileInFlight = null;
  const current = channel;
  channel = null;
  if (!current) return;
  try {
    await supabase.removeChannel(current);
  } catch (error) {
    console.warn('[pairing] realtime stop failed:', error);
  }
}

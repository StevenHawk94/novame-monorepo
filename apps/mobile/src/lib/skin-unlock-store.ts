/**
 * Skin unlock global store (Stage 5.WR.2, Bug 3).
 *
 * A tiny module-level subscription store backing the global
 * SkinUnlockModal in tabs _layout.tsx. Lets any caller (home tab,
 * growth tab, anywhere that fetches character state) enqueue an
 * unlock event without needing tab-scoped state.
 *
 * Why not React Context: this avoids re-rendering the whole tabs
 * tree when the queue changes. Only the modal subscriber re-renders.
 *
 * Why not Zustand: keeping deps lean — there's only one store with
 * one operation each direction.
 *
 * Queue semantics: enqueue([2, 3]) appends 2 and 3 to the queue.
 * dequeue() removes the head and returns the next head, or undefined
 * when empty. The modal subscriber reads the head, renders it, and
 * dequeues when the user closes the modal (Switch success or Later).
 */

type Listener = (queue: number[]) => void;

let _queue: number[] = [];
const _listeners = new Set<Listener>();

function notify() {
  for (const l of _listeners) l(_queue);
}

/**
 * Append outfit numbers to the unlock queue. Called by
 * fetchCharacterState after computing pending unlocks
 * (getUnlockedOutfits(level) minus DB seenSkinUnlocks minus outfit 1).
 *
 * Idempotency: outfit numbers already in the queue are not re-added
 * (covers the rare double-fetch race where two fetchCharacterState
 * calls finish before MMKV lastShownLevel is written).
 */
export function enqueueSkinUnlocks(outfits: number[]): void {
  if (outfits.length === 0) return;
  const additions = outfits.filter((n) => !_queue.includes(n));
  if (additions.length === 0) return;
  _queue = [..._queue, ...additions];
  notify();
}

/**
 * Remove the head of the queue. Called by the modal subscriber when
 * the user closes the modal (either Switch completes or Later tapped).
 */
export function dequeueSkinUnlock(): void {
  if (_queue.length === 0) return;
  _queue = _queue.slice(1);
  notify();
}

/**
 * Read the current queue state. Used by the React hook below.
 */
function getQueue(): number[] {
  return _queue;
}

/**
 * Subscribe to queue changes. Returns an unsubscribe function.
 */
function subscribe(listener: Listener): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

// ---- React hook for the modal subscriber ----

import { useEffect, useState } from 'react';

/**
 * React hook that returns the current head of the unlock queue (or
 * undefined when empty) and re-renders the consumer when it changes.
 *
 * Used by SkinUnlockModal in tabs _layout.tsx to know what to render.
 */
export function useSkinUnlockHead(): number | undefined {
  const [queue, setQueue] = useState<number[]>(getQueue());
  useEffect(() => subscribe(setQueue), []);
  return queue[0];
}

/**
 * Clear the entire queue. Called by _layout.tsx on SIGNED_OUT so a
 * fresh sign-in doesn't see leftover queued modals from prior session.
 */
export function clearSkinUnlockQueue(): void {
  if (_queue.length === 0) return;
  _queue = [];
  notify();
}

/**
 * Synchronously peek the head of the queue without subscribing.
 *
 * Stage 6.RatingPrompt: used by record.tsx handleClose to decide
 * whether to yield to a skin unlock vs trigger the rating prompt --
 * when the queue is non-empty, the SkinUnlockModal in
 * (tabs)/_layout.tsx will auto-surface, so the rating prompt yields
 * (and does NOT mark itself as shown, so the next publish milestone
 * gets a fresh shot).
 *
 * Non-React (unlike useSkinUnlockHead) because the call site is an
 * imperative event handler, not a render path.
 */
export function peekSkinUnlockQueueHead(): number | undefined {
  return _queue[0];
}

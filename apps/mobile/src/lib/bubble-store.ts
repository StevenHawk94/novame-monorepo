/**
 * Companion bubble store. After a reflection, the API returns a one-off line
 * the companion "says" on Home. We stash it with a timestamp; Home shows it
 * for six hours, then falls back to the next launch-sequenced default line.
 */
import { BUBBLE_LINES_DAY, BUBBLE_LINES_NIGHT } from '@novame/domain';

import { kBubble } from '../shared/storage/keys';
import { storage } from './storage';

const FRESH_MS = 6 * 60 * 60 * 1000; // show an AI line for up to 6h

export interface FreshBubble {
  line: string;
  atMs: number;
  expiresAtMs: number;
}

interface StoredBubble {
  line?: string;
  atMs?: number;
  dayNext?: number;
  nightNext?: number;
}

interface BubbleSequence {
  dayNext: number;
  nightNext: number;
}

export function setReflectBubble(line: string): void {
  const payload: StoredBubble = { ...readStoredBubble(), line, atMs: Date.now() };
  storage.set(kBubble.name, JSON.stringify(payload));
}

/** The fresh AI line, or null if none / expired. */
export function getFreshBubble(): string | null {
  return getFreshBubbleState()?.line ?? null;
}

/** Fresh AI line plus its exact expiry, so Home can switch without a restart. */
export function getFreshBubbleState(): FreshBubble | null {
  const b = readStoredBubble();
  if (!b.line || !Number.isFinite(b.atMs)) return null;
  const atMs = b.atMs as number;
  const expiresAtMs = atMs + FRESH_MS;
  if (Date.now() >= expiresAtMs) return null;
  return { line: b.line, atMs, expiresAtMs };
}

function readStoredBubble(): StoredBubble {
  const raw = storage.getString(kBubble.name);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StoredBubble;
  } catch {
    return {};
  }
}

function readSequence(): BubbleSequence {
  const value = readStoredBubble();
  return {
    dayNext: Number.isInteger(value.dayNext) && (value.dayNext ?? 0) >= 0 ? value.dayNext! : 0,
    nightNext: Number.isInteger(value.nightNext) && (value.nightNext ?? 0) >= 0 ? value.nightNext! : 0,
  };
}

/** Take and persist the next line based on the phone's current local hour. */
function takeNextDefault(now = new Date()): string {
  const day = now.getHours() >= 6 && now.getHours() < 18;
  const lines = day ? BUBBLE_LINES_DAY : BUBBLE_LINES_NIGHT;
  const sequence = readSequence();
  const cursor = day ? sequence.dayNext : sequence.nightNext;
  const line = lines[cursor % lines.length];
  const next = (cursor + 1) % lines.length;
  if (day) sequence.dayNext = next;
  else sequence.nightNext = next;
  storage.set(kBubble.name, JSON.stringify({ ...readStoredBubble(), ...sequence }));
  return line;
}

/** Select the next persisted line when Home is created for a new app session. */
export function getLaunchDefaultBubble(): string {
  return takeNextDefault();
}

/** Used when an AI line's six-hour window ends during the current launch. */
export function advanceDefaultBubble(): string {
  return takeNextDefault();
}

export function clearBubble(): void {
  storage.remove(kBubble.name);
}

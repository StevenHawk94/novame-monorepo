/**
 * Companion bubble store. After a reflection, the API returns a one-off line
 * the companion "says" on Home. We stash it with a timestamp; Home shows it
 * while it's fresh (a few hours), then falls back to the rotating default lines.
 */
import { kBubble } from '../shared/storage/keys';
import { storage } from './storage';

const FRESH_MS = 6 * 60 * 60 * 1000; // show an AI line for up to 6h

interface StoredBubble {
  line: string;
  atMs: number;
}

export function setReflectBubble(line: string): void {
  const payload: StoredBubble = { line, atMs: Date.now() };
  storage.set(kBubble.name, JSON.stringify(payload));
}

/** The fresh AI line, or null if none / expired. */
export function getFreshBubble(): string | null {
  const raw = storage.getString(kBubble.name);
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as StoredBubble;
    if (Date.now() - b.atMs > FRESH_MS) return null;
    return b.line || null;
  } catch {
    return null;
  }
}

export function clearBubble(): void {
  storage.remove(kBubble.name);
}

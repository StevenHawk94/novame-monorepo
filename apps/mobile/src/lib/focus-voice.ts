/**
 * Focus voice rotation (2026-08-08 spec).
 *
 * Track 1 of every scene ships in the app bundle; tracks 2+ live on R2 under
 * `Focus Voice/<Base><n>.MP3`. Listening to track N fires
 * `onFocusVoiceListened`, which:
 *   1. probes past the highest known track — fresh uploads are downloaded and
 *      become the NEXT play (the "jump to newest" rule);
 *   2. otherwise steps the loop forward (N+1, wrapping to the bundled track 1
 *      after the last known one) and prefetches the coming file so tomorrow's
 *      listen starts instantly.
 *
 * R2 keys are case-sensitive and the uploads drift (work2.MP3 vs Work3.MP3),
 * so probing tries a small set of case candidates and remembers the exact key
 * that answered.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { storage } from './storage';
import { kFocusVoice } from '../shared/storage/keys';

const R2_BASE = 'https://media.novameapp.com';
const FOLDER = 'Focus Voice';
const MAX_NEW_PROBES = 3; // batch uploads discovered up to 3 per listen

export const FOCUS_VOICE_BUNDLED: Record<string, number> = {
  work: require('../../assets/audio/focus-voice/work1.mp3'),
  learn: require('../../assets/audio/focus-voice/learn1.mp3'),
  connect: require('../../assets/audio/focus-voice/connect1.mp3'),
  daily: require('../../assets/audio/focus-voice/daily1.mp3'),
  family: require('../../assets/audio/focus-voice/family1.mp3'),
  challenge: require('../../assets/audio/focus-voice/challenge1.mp3'),
};

// Scene id → R2 filename base ("Daily Tasks2.MP3", "Social2.MP3", …).
const BASE_NAME: Record<string, string> = {
  work: 'Work',
  learn: 'Learn',
  connect: 'Social',
  daily: 'Daily Tasks',
  family: 'Family',
  challenge: 'Challenge',
};

interface SceneState {
  /** Track index to play on the next listen (1 = bundled). */
  next: number;
  /** Highest track index known to exist on R2 (1 = bundled only). */
  knownMax: number;
  /** Resolved R2 filename per index (exact case that answered the probe). */
  keys: Record<string, string>;
}

type VoiceState = Record<string, SceneState>;

function readState(): VoiceState {
  try {
    const raw = storage.getString(kFocusVoice.name);
    if (raw) return JSON.parse(raw) as VoiceState;
  } catch { /* corrupted → start fresh */ }
  return {};
}

function writeState(state: VoiceState): void {
  storage.set(kFocusVoice.name, JSON.stringify(state));
}

function sceneState(state: VoiceState, scene: string): SceneState {
  return state[scene] ?? { next: 1, knownMax: 1, keys: {} };
}

function urlFor(key: string): string {
  return `${R2_BASE}/${encodeURIComponent(FOLDER)}/${encodeURIComponent(key)}`;
}

function cacheDir(): string {
  return `${FileSystem.cacheDirectory}focus-voice/`;
}

function localPath(scene: string, index: number): string {
  return `${cacheDir()}${scene}-${index}.mp3`;
}

/** Filename candidates for a track — covers the observed case drift. */
function candidates(scene: string, index: number): string[] {
  const base = BASE_NAME[scene] ?? scene;
  return [
    `${base}${index}.MP3`,
    `${base.toLowerCase()}${index}.MP3`,
    `${base}${index}.mp3`,
  ];
}

/** HEAD-probe R2 for a track; returns the exact key that exists, or null. */
async function probe(scene: string, index: number): Promise<string | null> {
  for (const key of candidates(scene, index)) {
    try {
      const res = await fetch(urlFor(key), { method: 'HEAD' });
      if (res.ok) return key;
    } catch { /* network hiccup — treat as missing */ }
  }
  return null;
}

async function ensureDownloaded(scene: string, index: number, key: string): Promise<void> {
  const path = localPath(scene, index);
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) return;
    await FileSystem.makeDirectoryAsync(cacheDir(), { intermediates: true }).catch(() => {});
    await FileSystem.downloadAsync(urlFor(key), path);
  } catch { /* prefetch is best-effort; playback can stream */ }
}

export type FocusVoiceSource = number | { uri: string };

/**
 * The source to play right now for a scene, plus its track index. Track 1 is
 * the bundled asset; later tracks prefer the prefetched cache file and fall
 * back to streaming straight from R2 (or the bundled track when the key was
 * somehow lost).
 */
export async function getFocusVoiceSource(
  scene: string,
): Promise<{ source: FocusVoiceSource; index: number }> {
  const bundled = FOCUS_VOICE_BUNDLED[scene];
  const st = sceneState(readState(), scene);
  if (st.next <= 1) return { source: bundled, index: 1 };

  const path = localPath(scene, st.next);
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) return { source: { uri: path }, index: st.next };
  } catch { /* fall through to streaming */ }

  const key = st.keys[String(st.next)];
  if (key) return { source: { uri: urlFor(key) }, index: st.next };
  return { source: bundled, index: 1 };
}

/**
 * Fired when a listen starts. Discovers fresh uploads (which jump the loop to
 * the newest track), otherwise advances sequentially with wrap-around, and
 * prefetches whatever plays next.
 */
export async function onFocusVoiceListened(scene: string, playedIndex: number): Promise<void> {
  const state = readState();
  const st = { ...sceneState(state, scene), keys: { ...sceneState(state, scene).keys } };

  // 1) Look past the known ceiling for new uploads.
  let discovered = 0;
  for (let i = 0; i < MAX_NEW_PROBES; i++) {
    const idx = st.knownMax + 1;
    const key = await probe(scene, idx);
    if (!key) break;
    st.keys[String(idx)] = key;
    st.knownMax = idx;
    discovered = idx;
  }

  if (discovered > 0) {
    // Fresh content: next play starts at the newest track.
    st.next = discovered;
  } else {
    // Sequential loop: step forward, wrap to the bundled track after the end.
    st.next = playedIndex + 1 <= st.knownMax ? playedIndex + 1 : 1;
  }

  // 2) Prefetch the coming track so the next listen starts instantly.
  if (st.next > 1) {
    const key = st.keys[String(st.next)];
    if (key) void ensureDownloaded(scene, st.next, key);
  }

  state[scene] = st;
  writeState(state);
}

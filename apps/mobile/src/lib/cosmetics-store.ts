/**
 * Personalization selection store: which Home scene and which companion skin
 * the user has chosen. Local-first (MMKV) so Home renders the choice instantly;
 * a server sync can layer on later. Skin is keyed per companion so each pet
 * remembers its own look.
 */
import { kCosmetics } from '../shared/storage/keys';
import { storage } from './storage';
import { DEFAULT_SCENE_ID } from '@novame/domain';

interface CosmeticsState {
  sceneId: string;
  // companionId -> skin index (1..6)
  skinByPet: Record<string, number>;
}

function read(): CosmeticsState {
  const raw = storage.getString(kCosmetics.name);
  if (!raw) return { sceneId: DEFAULT_SCENE_ID, skinByPet: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<CosmeticsState>;
    return {
      sceneId: parsed.sceneId ?? DEFAULT_SCENE_ID,
      skinByPet: parsed.skinByPet ?? {},
    };
  } catch {
    return { sceneId: DEFAULT_SCENE_ID, skinByPet: {} };
  }
}

function write(s: CosmeticsState): void {
  storage.set(kCosmetics.name, JSON.stringify(s));
}

export function getSelectedScene(): string {
  return read().sceneId;
}

export function setSelectedScene(sceneId: string): void {
  const s = read();
  s.sceneId = sceneId;
  write(s);
}

export function getSelectedSkin(companionId: string): number {
  return read().skinByPet[companionId] ?? 1;
}

export function setSelectedSkin(companionId: string, skin: number): void {
  const s = read();
  s.skinByPet = { ...s.skinByPet, [companionId]: skin };
  write(s);
}

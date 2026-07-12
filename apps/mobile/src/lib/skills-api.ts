/**
 * Skills data: the lessons a user has collected, cache-first.
 *
 * source 'self' are the user's own (the "learned" count); 'friend' are taught
 * by friends (shown separately). Rarity 'secret' is the glowing card. Skills are
 * paid-only to generate, so a free user's list is empty -- the tab explains
 * that rather than looking broken.
 */
import { kSkillsState } from '../shared/storage/keys';
import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';

export type SkillRarity = 'normal' | 'secret';
export type SkillSource = 'self' | 'friend';

export interface Skill {
  skillId: string;
  dimension: string;
  title: string;
  body: string;
  rarity: SkillRarity;
  source: SkillSource;
  createdAt: string;
}

export function getCachedSkills(): Skill[] {
  const raw = storage.getString(kSkillsState.name);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Skill[];
  } catch {
    return [];
  }
}

export async function fetchSkills(): Promise<Skill[]> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return getCachedSkills();

  try {
    const data = await apiClient.get<{ success?: boolean; skills?: Skill[] }>(
      `/api/skills?userId=${encodeURIComponent(userId)}`,
    );
    if (!data.success || !data.skills) return getCachedSkills();
    storage.set(kSkillsState.name, JSON.stringify(data.skills));
    return data.skills;
  } catch {
    return getCachedSkills();
  }
}

export const DIMENSION_COLOR: Record<string, string> = {
  expression: '#E8825E',
  awareness: '#7C5CFC',
  momentum: '#E85B5B',
  direction: '#5B9BD5',
  steadiness: '#4CAF82',
  confidence: '#D4A574',
  gratitude: '#C084FC',
  connection: '#E0A030',
};

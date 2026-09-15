import { ApiError } from '@novame/api-client';
import { apiClient } from './api';
import { supabase } from './supabase';
import { storage } from './storage';
import { kCourtLobby } from '../shared/storage/keys';

export type CourtCategory = 'Love Court' | 'Closeness Court' | 'Life Court' | 'Meet in the Middle';
export type CourtStatus = 'awaiting_initiator' | 'awaiting_partner' | 'processing' | 'ready' | 'completed' | 'declined' | 'expired' | 'cancelled';

export type CourtCaseSummary = {
  id: string;
  category: CourtCategory;
  title: string;
  subtitle: string;
  engine: string;
  accessTier: 'free' | 'plus';
  questionCount: number;
  repeatability: string;
  sensitivity: string;
  lockedReason: 'relationship' | 'plus' | 'cooldown' | null;
  availableAt: string | null;
};

export type CourtVerdict = {
  outcomeKey: string;
  headline: string;
  whatCourtHeard: string;
  verdict: string;
  courtOrderedMove: string;
  shareText: string;
  safetyState: 'safe' | 'safety_redirect';
  createdAt: string;
};

export type CourtSession = {
  id: string;
  status: CourtStatus;
  case: {
    case_id: string;
    category: CourtCategory;
    title: string;
    card_subtitle: string;
    engine: string;
    access_tier: 'free' | 'plus';
    repeatability: string;
  } | null;
  role: 'initiator' | 'partner';
  hasSubmitted: boolean;
  otherSubmitted: boolean;
  expiresAt: string;
  createdAt: string;
  verdict: CourtVerdict | null;
};

export type CourtQuestion = {
  number: number;
  prompt: string;
  responseType: 'Single select' | 'Multi select' | 'Short text' | 'Memory picker';
  options: { label: string; value: string }[];
  required: boolean;
};

export type CourtLobby = {
  success: boolean;
  paired: boolean;
  isPlus: boolean;
  relationship?: string | null;
  partnerUserId?: string;
  cases: CourtCaseSummary[];
  active: CourtSession | null;
  history: { id: string; case_id: string; status: CourtStatus; completed_at?: string; verdict_ready_at?: string; created_at: string }[];
  fetchedAt: number;
};

export type CourtSessionPayload = { success: boolean; session: CourtSession; questions: CourtQuestion[] };
export type CourtAnswer = { questionNumber: number; value: string | string[] };
export type CourtApiResult<T> = { ok: true; data: T } | { ok: false; error: string; availableAt?: string };

function errorCode(error: unknown): { code: string; availableAt?: string } {
  if (error instanceof ApiError && error.body && typeof error.body === 'object') {
    const body = error.body as { error?: string; availableAt?: string };
    return { code: body.error || 'network', availableAt: body.availableAt };
  }
  return { code: 'network' };
}

async function userId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export function getCachedCourtLobby(): CourtLobby | null {
  try {
    const raw = storage.getString(kCourtLobby.name);
    return raw ? JSON.parse(raw) as CourtLobby : null;
  } catch { return null; }
}

function cacheLobby(lobby: CourtLobby): CourtLobby {
  storage.set(kCourtLobby.name, JSON.stringify(lobby));
  return lobby;
}

export async function fetchCourtLobby(): Promise<CourtApiResult<CourtLobby>> {
  const id = await userId();
  if (!id) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.get<Omit<CourtLobby, 'fetchedAt'>>(`/api/court?userId=${encodeURIComponent(id)}`);
    return { ok: true, data: cacheLobby({ ...data, fetchedAt: Date.now() }) };
  } catch (error) {
    const cached = getCachedCourtLobby();
    if (cached) return { ok: true, data: cached };
    return { ok: false, error: errorCode(error).code };
  }
}

export async function createCourtCase(caseId: string): Promise<CourtApiResult<CourtSession>> {
  const id = await userId();
  if (!id) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.post<{ success: boolean; session: CourtSession }>('/api/court', { userId: id, caseId });
    return { ok: true, data: data.session };
  } catch (error) {
    const parsed = errorCode(error);
    return { ok: false, error: parsed.code, availableAt: parsed.availableAt };
  }
}

export async function fetchCourtSession(sessionId: string): Promise<CourtApiResult<CourtSessionPayload>> {
  const id = await userId();
  if (!id) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.get<CourtSessionPayload>(`/api/court/${encodeURIComponent(sessionId)}?userId=${encodeURIComponent(id)}`);
    return { ok: true, data };
  } catch (error) { return { ok: false, error: errorCode(error).code }; }
}

export async function submitCourtAnswers(sessionId: string, answers: CourtAnswer[]): Promise<CourtApiResult<CourtSession>> {
  return courtAction(sessionId, { action: 'submit', answers });
}

export async function courtAction(sessionId: string, payload: { action: 'submit'; answers: CourtAnswer[] } | { action: 'decline' | 'nudge' | 'complete' }): Promise<CourtApiResult<CourtSession>> {
  const id = await userId();
  if (!id) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.post<{ success: boolean; session?: CourtSession }>(
      `/api/court/${encodeURIComponent(sessionId)}`, { userId: id, ...payload },
    );
    return { ok: true, data: data.session as CourtSession };
  } catch (error) { return { ok: false, error: errorCode(error).code }; }
}

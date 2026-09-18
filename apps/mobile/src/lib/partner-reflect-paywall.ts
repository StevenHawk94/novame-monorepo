import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';
import {
  kPartnerReflectPaywallAssignment,
  kPartnerReflectPaywallQueue,
} from '@/shared/storage';

export type PartnerReflectPaywallAssignment = {
  reflectId: string;
  variantId: string;
  variantKey: string;
  headline: string;
  subheadline: string;
  ctaHeading: string;
  benefits: string[];
};

type ClaimResponse = {
  success?: boolean;
  eligible?: boolean;
  assignment?: PartnerReflectPaywallAssignment;
};

const listeners = new Set<() => void>();

function readQueue(): string[] {
  try {
    const parsed = JSON.parse(storage.getString(kPartnerReflectPaywallQueue.name) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.length > 0).slice(-10)
      : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: string[]): void {
  if (queue.length) storage.set(kPartnerReflectPaywallQueue.name, JSON.stringify(queue.slice(-10)));
  else storage.remove(kPartnerReflectPaywallQueue.name);
}

export function requestPartnerReflectPaywall(reflectId: string): void {
  if (!reflectId) return;
  const queue = readQueue();
  if (!queue.includes(reflectId)) writeQueue([...queue, reflectId]);
  for (const listener of listeners) {
    try { listener(); } catch (error) {
      console.warn('[partner-reflect-paywall] listener failed:', error);
    }
  }
}

export function peekPartnerReflectPaywall(): string | null {
  return readQueue()[0] || null;
}

export function removePartnerReflectPaywall(reflectId: string): void {
  writeQueue(readQueue().filter((id) => id !== reflectId));
}

export function subscribePartnerReflectPaywallRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function syncPartnerReflectPaywallRequests(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    const response = await apiClient.get<{ success?: boolean; reflectIds?: string[] }>(
      `/api/marketing/partner-reflect-paywall?action=pending&userId=${encodeURIComponent(userId)}`,
    );
    for (const reflectId of response.reflectIds || []) requestPartnerReflectPaywall(reflectId);
  } catch (error) {
    console.warn('[partner-reflect-paywall] pending sync failed:', error);
  }
}

export async function claimPartnerReflectPaywall(reflectId: string): Promise<{
  ok: boolean;
  eligible: boolean;
  assignment?: PartnerReflectPaywallAssignment;
}> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return { ok: true, eligible: false };
    const response = await apiClient.get<ClaimResponse>(
      `/api/marketing/partner-reflect-paywall?userId=${encodeURIComponent(userId)}&reflectId=${encodeURIComponent(reflectId)}`,
    );
    if (response.assignment) {
      storage.set(kPartnerReflectPaywallAssignment.name, JSON.stringify(response.assignment));
    }
    return {
      ok: response.success === true,
      eligible: response.eligible === true,
      assignment: response.assignment,
    };
  } catch (error) {
    console.warn('[partner-reflect-paywall] claim failed:', error);
    return { ok: false, eligible: false };
  }
}

export function getPartnerReflectPaywallAssignment(): PartnerReflectPaywallAssignment | null {
  try {
    const raw = storage.getString(kPartnerReflectPaywallAssignment.name);
    if (!raw) return null;
    const value = JSON.parse(raw) as PartnerReflectPaywallAssignment;
    return value && typeof value.reflectId === 'string' && Array.isArray(value.benefits) ? value : null;
  } catch {
    return null;
  }
}

export function clearPartnerReflectPaywallAssignment(): void {
  storage.remove(kPartnerReflectPaywallAssignment.name);
}

export async function recordPartnerReflectPaywallClick(
  assignment: PartnerReflectPaywallAssignment,
): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    await apiClient.post('/api/marketing/partner-reflect-paywall', {
      userId,
      reflectId: assignment.reflectId,
      variantId: assignment.variantId,
    });
  } catch (error) {
    console.warn('[partner-reflect-paywall] click tracking failed:', error);
  }
}

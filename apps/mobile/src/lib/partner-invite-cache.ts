import { storage } from './storage';
import { kPartnerInviteCode } from '../shared/storage/keys';
import { sessionUserId } from './session-lifecycle';

export function cachedPartnerInvite(owner = sessionUserId()): string | null {
  if (!owner || owner !== sessionUserId()) return null;
  try {
    const saved = JSON.parse(storage.getString(kPartnerInviteCode.name) ?? 'null');
    return saved?.owner === owner && /^[A-Z0-9]{6}$/.test(saved.code) ? saved.code : null;
  } catch { return null; }
}
export function rememberPartnerInvite(owner: string, code: string) {
  if (owner !== sessionUserId() || !/^[A-Z0-9]{6}$/.test(code)) return;
  try { storage.set(kPartnerInviteCode.name, JSON.stringify({ owner, code })); } catch {}
}

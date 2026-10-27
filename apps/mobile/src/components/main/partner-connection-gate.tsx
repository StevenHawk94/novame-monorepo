import { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard } from 'react-native';
import { useSegments } from 'expo-router';
import { Image } from 'expo-image';
import { ScreenOverlay } from '@/components/ui/screen-overlay';
import { PairingConnectedPage, type PairingPerson } from '@/components/onboarding/partner-pairing-ui';
import { getBurrowSnapshot, useBurrowSnapshot } from '@/lib/burrow-store';
import { sessionEpoch, sessionUserId } from '@/lib/session-lifecycle';
import { withDeadline } from '@/lib/async-lifecycle';
import {useOverlayPresent} from '@/lib/overlay-presence';

type Connection = { owner: string; epoch: number; scope: string; self: PairingPerson; partner: PairingPerson };
/** Presentation only: never navigate, replace a route, or discard its inputs. */
export function PartnerConnectionGate() {
  const { data, pairInvalidated } = useBurrowSnapshot(), segments = useSegments();
  const overlay=useOverlayPresent();
  const [prompt, setPrompt] = useState<Connection | null>(null);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const previous = useRef<{ owner: string; epoch: number; scope: string } | null>(null);
  const preparing = useRef('');
  const owner = sessionUserId(), epoch = sessionEpoch();
  const scope = data?.partner && data.pairVersion ? `${data.partner.id}:${data.pairVersion}` : '';
  const inline = segments.some(segment => segment === 'pair-partner' || segment === 'partner-connected');
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    let live = true;
    if (!owner || (previous.current && (previous.current.owner !== owner || previous.current.epoch !== epoch))) {
      previous.current = null; preparing.current = ''; setPrompt(null);
    }
    // Ignore invalidation gaps. Only authenticated, complete bootstrap data
    // can announce a connection (a broadcast payload is never authorization).
    if (!data || data.profile.id !== owner || pairInvalidated || !data.pairAccessVerified) return;
    const last = previous.current;
    previous.current = { owner, epoch, scope };
    if (!scope) { preparing.current = ''; setPrompt(null); return; }
    // Cold restoration is not a new pairing. The explicit invite route owns
    // its own identical success page, so it must not also get a global prompt.
    if (!last || inline) { preparing.current = ''; return; }
    if (last.scope !== scope) preparing.current = scope;
    if (preparing.current !== scope) return;
    // Preserve the pending connection while the launch announcement/another
    // surface owns presentation. Once prepared, its own overlay may stay open.
    if(overlay)return;
    const partner = data.partner!;
    const connection: Connection = { owner, epoch, scope,
      self: { userId: owner, name: data.profile.display_name || 'You', avatarUrl: data.profile.avatar_url || undefined, isDefaultAvatar: data.profile.is_default_avatar !== false },
      partner: { userId: partner.id, name: partner.display_name || 'Partner', avatarUrl: partner.avatar_url || undefined, isDefaultAvatar: partner.is_default_avatar !== false },
    };
    const prepare = async () => {
      await Promise.all([connection.self, connection.partner].map(async person => {
        if (!person.avatarUrl || person.isDefaultAvatar || !/^https?:\/\//.test(person.avatarUrl)) return;
        try { const ok = await withDeadline(Image.prefetch(person.avatarUrl), 1500); if (!ok) person.avatarUrl = undefined; }
        catch { person.avatarUrl = undefined; } // Ready initials, not a broken/empty portrait.
      }));
      const current = getBurrowSnapshot();
      if (!live || epoch !== sessionEpoch() || owner !== sessionUserId() || current.pairInvalidated
        || !current.data?.pairAccessVerified || `${current.data.partner?.id}:${current.data.pairVersion}` !== scope) return;
      preparing.current = ''; Keyboard.dismiss(); setPrompt(connection);
    };
    void prepare();
    return () => { live = false; };
  }, [owner, epoch, scope, pairInvalidated, data?.pairAccessVerified, inline, overlay]);
  const visible = !!prompt && active && prompt.owner === owner && prompt.epoch === epoch
    && prompt.scope === scope && !pairInvalidated && !!data?.pairAccessVerified;
  const close = () => setPrompt(null);
  return <ScreenOverlay visible={visible} onRequestClose={close}>
    {prompt && <PairingConnectedPage self={prompt.self} partner={prompt.partner} onContinue={close} />}
  </ScreenOverlay>;
}

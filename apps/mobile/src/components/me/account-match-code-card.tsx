import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Pressable } from '@/components/ui/feedback-pressable';
import { cachedPartnerInvite } from '@/lib/partner-invite-cache';
import { fetchFriends } from '@/lib/friends-api';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from '@/lib/session-lifecycle';

/** Own stable code only: pairing does not remove it or expose a partner's code. */
export function AccountMatchCodeCard() {
    const owner = useRef(sessionUserId()), epoch = useRef(sessionEpoch()), live = useRef(true);
    const loading = useRef(false), copying = useRef(false);
    const [code, setCode] = useState(() => cachedPartnerInvite());
    const [message, setMessage] = useState(''), [unavailable, setUnavailable] = useState(false);
    const current = () => live.current && owner.current === sessionUserId() && epoch.current === sessionEpoch();
    async function loadCode() {
        if (!current() || !owner.current || loading.current) return;
        loading.current = true; setUnavailable(false);
        try {
            const result = await fetchFriends();
            if (!current()) return;
            if (result.inviteCode && /^[A-Z0-9]{6}$/.test(result.inviteCode)) setCode(result.inviteCode);
            else setUnavailable(true);
        } catch { if (current()) setUnavailable(true); }
        finally { loading.current = false; }
    }
    useEffect(() => {
        live.current = true;
        const unsubscribe = subscribeSessionIdentity(() => { setCode(null); setMessage(''); setUnavailable(false); });
        // The code is stable. An already prepared identity-scoped code needs no request.
        if (!cachedPartnerInvite()) void loadCode();
        return () => { live.current = false; unsubscribe(); };
    }, []);
    async function copyCode() {
        if (!current() || !code || copying.current) return;
        copying.current = true;
        try {
            await Clipboard.setStringAsync(code);
            if (current()) setMessage('Copied');
        } catch { if (current()) setMessage('Could not copy. Please try again.'); }
        finally { copying.current = false; }
    }
    const visibleCode = current() ? code : null;
    return <View style={s.card}>
        <Text style={s.label}>Your match code</Text>
        <View style={s.row}>
            <Text selectable numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} accessibilityLabel="Your match code" style={s.code}>{visibleCode ?? '—'}</Text>
            {visibleCode ? <Pressable accessibilityRole="button" accessibilityLabel="Copy match code" onPress={() => void copyCode()} style={s.button}><Text style={s.buttonText}>Copy</Text></Pressable>
                : unavailable ? <Pressable accessibilityRole="button" accessibilityLabel="Retry loading match code" onPress={() => void loadCode()} style={s.button}><Text style={s.buttonText}>Retry</Text></Pressable> : null}
        </View>
        <Text accessibilityLiveRegion="polite" style={s.helper}>{message || (visibleCode ? 'Your code stays the same after connecting.' : unavailable ? 'Could not load your code. Please try again.' : 'Preparing your match code…')}</Text>
    </View>;
}
const s = StyleSheet.create({
    card: { backgroundColor: '#FFF9F0', borderRadius: 18, marginBottom: 24, padding: 16 },
    label: { fontSize: 16, color: '#4A3423' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
    code: { flex: 1, fontSize: 24, fontWeight: '700', letterSpacing: 3, color: '#4A3423' },
    button: { minHeight: 44, minWidth: 64, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderRadius: 14, backgroundColor: '#4A3423' },
    buttonText: { color: '#FFF9F0', fontSize: 15, fontWeight: '700' },
    helper: { marginTop: 12, fontSize: 14, lineHeight: 20, color: '#8A7A63' },
});

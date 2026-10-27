import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';
import { AppState } from 'react-native';
import { PROFILE_AVATAR_DIRECTORY, waitForProfileAvatarCleanup } from '../shared/storage/artifacts';
import { kProfileAvatar } from '../shared/storage/keys';
import { storage } from './storage';
import { prepareProfileAvatarUpload, completeProfileAvatarUpload } from './account-api';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { supabase } from './supabase';
import { withDeadline } from './async-lifecycle';
import { supersedeOnboardingAvatar } from './avatar-upload-queue';
type Avatar = {
    userId: string;
    key: string;
    localUri: string;
    previousUrl: string;
    remoteUrl?: string;
    pending: boolean;
    path?: string;
    token?: string;
    attempts: number;
};
let state: Avatar | null = null, loadedOwner: string | null = null;
let flight: object | null = null, flightUri: string | null = null, timer: ReturnType<typeof setTimeout> | null = null;
let onboardingFlight: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>(), committed = new Set<() => void>();
const emit = () => listeners.forEach(fn => { try { fn(); } catch { console.warn('[profile-avatar]', 'observer_failed'); } });
function read() {
    const owner = sessionUserId();
    if (!owner)
        return null;
    if (loadedOwner !== owner) {
        const raw = storage.getString(kProfileAvatar.name);
        state = null;
        if (raw) {
            const value = JSON.parse(raw) as Avatar;
            if (value.userId === owner && typeof value.key === 'string' && typeof value.localUri === 'string'
                && PROFILE_AVATAR_DIRECTORY && value.localUri.startsWith(PROFILE_AVATAR_DIRECTORY) && typeof value.pending === 'boolean')
                state = value;
        }
        loadedOwner = owner;
    }
    return state;
}
function write(next: Avatar) { storage.set(kProfileAvatar.name, JSON.stringify(next)); state = next; loadedOwner = next.userId; emit(); }
function removeLocal(uri: string) { if (PROFILE_AVATAR_DIRECTORY && uri.startsWith(PROFILE_AVATAR_DIRECTORY))
    void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => { }); }
function schedule(delay = 0) {
    if (timer || flight || AppState.currentState !== 'active' || !read()?.pending)
        return;
    timer = setTimeout(() => { timer = null; void syncLocalProfileAvatar(); }, delay);
}
export function localProfileAvatarUri(userId: string | null | undefined, remoteUrl?: string | null) {
    if (!userId || userId !== sessionUserId())
        return null;
    try {
        const row = read();
        if (!row)
            return null;
        return row.pending || (remoteUrl ?? '') === row.remoteUrl || (remoteUrl ?? '') === row.previousUrl ? row.localUri : null;
    }
    catch {
        return null;
    }
}
export const subscribeLocalProfileAvatar = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const onProfileAvatarCommitted = (fn: () => void) => { committed.add(fn); return () => { committed.delete(fn); }; };
/** Called only after native crop/encode. Disk acceptance, not upload, closes UI. */
export async function saveLocalProfileAvatar(userId: string, uri: string, previousUrl = '') {
    const epoch = sessionEpoch();
    if (userId !== sessionUserId() || !PROFILE_AVATAR_DIRECTORY)
        throw Error('avatar_session_changed');
    const key = randomUUID(), path = `${PROFILE_AVATAR_DIRECTORY}${key}.jpg`;
    await waitForProfileAvatarCleanup();
    await FileSystem.makeDirectoryAsync(PROFILE_AVATAR_DIRECTORY, { intermediates: true });
    await FileSystem.copyAsync({ from: uri, to: path });
    if (epoch !== sessionEpoch() || userId !== sessionUserId()) {
        removeLocal(path);
        throw Error('avatar_session_changed');
    }
    const previous = read();
    try {
        write({ userId, key, localUri: path, previousUrl: previous?.remoteUrl ?? previousUrl, pending: true, attempts: 0 });
    }
    catch (error) {
        removeLocal(path);
        throw error;
    }
    // This is a background barrier only: close the picker immediately, but let
    // any older prepare request finish before issuing this newer intent.
    onboardingFlight = supersedeOnboardingAvatar(userId).catch(() => { });
    if (previous && previous.localUri !== flightUri)
        removeLocal(previous.localUri);
    schedule();
    return path;
}
export async function syncLocalProfileAvatar() {
    let job: Avatar | null;
    try {
        job = read();
    }
    catch {
        return;
    }
    if (!job?.pending || flight || AppState.currentState !== 'active')
        return;
    const epoch = sessionEpoch(), token = {};
    flight = token;
    flightUri = job.localUri;
    const sameAccount = () => epoch === sessionEpoch() && job!.userId === sessionUserId();
    const current = () => sameAccount() && read()?.key === job!.key;
    let delay = 0;
    try {
        await onboardingFlight;
        if (!current())
            return;
        if (!job.path || !job.token) {
            const ticket = await withDeadline(prepareProfileAvatarUpload(job.userId, job.key), 20000);
            if (!current())
                return;
            if (ticket.kind === 'error')
                throw Error('avatar_prepare_failed');
            job = { ...job, path: ticket.path, token: ticket.token };
            write(job);
        }
        const base64 = await FileSystem.readAsStringAsync(job.localUri, { encoding: FileSystem.EncodingType.Base64 });
        if (!current())
            return;
        const uploaded = await withDeadline(supabase.storage.from('avatars').uploadToSignedUrl(job.path!, job.token!, decode(base64), { contentType: 'image/jpeg', cacheControl: '31536000' }), 30000);
        if (!current())
            return;
        if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) {
            write({ ...job, path: undefined, token: undefined });
            throw Error('avatar_upload_failed');
        }
        const result = await withDeadline(completeProfileAvatarUpload(job.userId, job.path!), 20000);
        if (!current())
            return;
        if (result.kind === 'error')
            throw Error('avatar_commit_failed');
        if (result.superseded) {
            // Another device chose a newer image. Do not pretend this crop is its URL.
            storage.remove(kProfileAvatar.name);
            state = null;
            emit();
            removeLocal(job.localUri);
        }
        else
            write({ ...job, pending: false, remoteUrl: result.avatarUrl, path: undefined, token: undefined });
        committed.forEach(fn => { try { fn(); } catch { console.warn('[profile-avatar]', 'refresh_pending'); } });
    }
    catch {
        if (current()) {
            const latest = read()!;
            const attempts = latest.attempts + 1;
            try {
                write({ ...latest, attempts });
            }
            catch { }
            delay = Math.min(5000 * 2 ** Math.min(attempts - 1, 6), 300000);
            console.warn('[profile-avatar]', 'sync_pending');
        }
    }
    finally {
        if (flight === token) {
            flight = null;
            flightUri = null;
            if (sameAccount() && read()?.key !== job.key)
                removeLocal(job.localUri);
            try {
                schedule(delay);
            }
            catch { }
        }
    }
}
subscribeSessionIdentity(() => { if (timer)
    clearTimeout(timer); timer = null; flight = null; flightUri = null; state = null; loadedOwner = null; emit(); });
AppState.addEventListener('change', next => { if (next === 'active') {
    try {
        schedule();
    }
    catch { }
}
else {
    if (timer)
        clearTimeout(timer);
    timer = null;
} });

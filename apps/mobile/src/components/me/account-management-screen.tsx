import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { appAlert } from '@/components/ui/app-dialog';
import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { signOut } from '@/lib/auth';
import { sessionEpoch, sessionUserId } from '@/lib/session-lifecycle';
import { deleteAccount, prepareAccountDeletion, fetchAccountProfile, requestAccountReauthentication, updateEmail, updateOwnPassword, type AccountProfile } from '@/lib/account-api';
import { clearCachedMeStats, fetchMeStats, getCachedMeStats, invalidateMeStats } from '@/lib/me-stats';
import { clearCachedSubscription } from '@/lib/subscription';
import { storage } from '@/lib/storage';
import { kAccountProfile } from '@/shared/storage/keys';
import { scheduleBurrowRefresh } from '@/lib/burrow-store';
import { getBunnyName } from '@/lib/onboarding';
import { usePageBackGesture } from '@/lib/use-page-back-gesture';
import { cachedAccountProfile, saveAccountProfile, subscribeAccountProfile, accountProfileSyncError } from '@/lib/account-profile-local';
const genders = { woman: 'Woman', man: 'Man', non_binary: 'Non-binary', prefer_not_to_say: 'Prefer not to say' } as const;
type Section = 'name' | 'birthday' | 'gender' | 'email' | 'password' | 'delete' | null;
const cachedProfile = cachedAccountProfile;
const dateKey = (v: Date) => `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
export function AccountManagementScreen() {
    const insets = useSafeAreaInsets(), [profile, setProfile] = useState<AccountProfile | null>(cachedProfile);
    const [name, setName] = useState(() => getCachedMeStats()?.displayName || getBunnyName() || '');
    const [email, setEmail] = useState(''), [section, setSection] = useState<Section>(null), [input, setInput] = useState(''), [code, setCode] = useState('');
    const [birthday, setBirthday] = useState(() => new Date(`${cachedProfile()?.birthday || '2000-01-01'}T12:00:00`));
    const [gender, setGender] = useState<keyof typeof genders>('prefer_not_to_say');
    const [datePickerOpen, setDatePickerOpen] = useState(false);
    const [deleteChallenge,setDeleteChallenge]=useState<string|null>(null);
    const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [ready, setReady] = useState(!!profile);
    const live = useRef(true), lock = useRef(false), epoch = useRef(sessionEpoch()), owner = useRef(sessionUserId());
    const current = () => live.current && epoch.current === sessionEpoch() && owner.current === sessionUserId();
    usePageBackGesture(!busy);
    useEffect(() => subscribeAccountProfile(() => {
        if (!current()) return;
        const next = cachedProfile();
        if (next) { setProfile(next); setName(next.display_name); setReady(true); }
        setStatus(accountProfileSyncError());
    }), []);
    async function reload() {
        try {
            const value = await fetchAccountProfile();
            if (!current() || value.id !== owner.current)
                return;
            storage.set(kAccountProfile.name, JSON.stringify(value));
            setProfile(value);
            setName(value.display_name || getBunnyName() || '');
            setReady(true);
        }
        catch {
            if (current())
                setStatus('Profile details could not be loaded. Please try again.');
        }
    }
    useEffect(() => { live.current = true; void reload(); void supabase.auth.getSession().then(({ data }) => { if (current())
        setEmail(data.session?.user?.email ?? ''); }); return () => { live.current = false; }; }, []);
    function open(next: Exclude<Section, null>) {
        if (busy)
            return;
        setStatus('');
        setCode('');
        setInput(next === 'name' ? name : next === 'email' ? email : '');
        if (next === 'birthday') {
            setBirthday(new Date(`${profile?.birthday || '2000-01-01'}T12:00:00`));
            setDatePickerOpen(true);
        }
        if (next === 'gender')
            setGender(profile?.gender ?? 'prefer_not_to_say');
        setSection(section === next ? null : next);
    }
    async function submit() {
        const userId = owner.current;
        if (!userId || !current() || lock.current || !section)
            return;
        if (section === 'name' && !input.trim()) {
            setStatus('Your name cannot be empty.');
            return;
        }
        if ((section === 'email' || section === 'password') && code.trim().length < 6) {
            setStatus('Enter the security code sent to your current email.');
            return;
        }
        if (section === 'email' && !input.includes('@')) {
            setStatus('Enter a valid email address.');
            return;
        }
        if (section === 'password' && input.length < 8) {
            setStatus('Use at least 8 characters for your password.');
            return;
        }
        if (section === 'name' || section === 'birthday' || section === 'gender') {
            try {
                const base = profile ?? { id: userId, display_name: name, birthday: null, gender: null };
                const next = saveAccountProfile(section === 'name' ? { display_name: input.trim().slice(0, 15) }
                    : section === 'birthday' ? { birthday: dateKey(birthday) } : { gender }, base);
                setProfile(next); setName(next.display_name); setSection(null); setInput(''); setStatus('');
                void haptics.success();
            } catch { setStatus('Could not save on this device. Please check your details and try again.'); }
            return;
        }
        lock.current = true;
        setBusy(true);
        setStatus('');
        try {
            const result = section === 'email' ? await updateEmail(userId, input.trim(), code.trim()) : await updateOwnPassword(userId, input, code.trim());
            if (!current())
                return;
            if (result.kind === 'error') {
                setStatus(result.message);
                return;
            }
            if (section === 'email') {
                setStatus('Verify the new email to finish changing your address.');
                setCode('');
                return;
            }
            setSection(null);
            setInput('');
            setCode('');
            void haptics.success();
            await reload();
            if (!current())
                return;
            invalidateMeStats();
            void fetchMeStats(userId, { force: true }).catch(() => { });
            scheduleBurrowRefresh();
        }
        catch {
            if (current())
                setStatus('Could not save. Your previous details have been kept. Please try again.');
        }
        finally {
            lock.current = false;
            if (current())
                setBusy(false);
        }
    }
    async function sendCode() {
        if (lock.current || !current())
            return;
        lock.current = true;
        setBusy(true);
        try {
            const result = await requestAccountReauthentication();
            if (current())
                setStatus(result.kind === 'error' ? result.message : 'Security code sent to your current email.');
        }
        catch {
            if (current())
                setStatus('Could not send the security code. Please try again.');
        }
        finally {
            lock.current = false;
            if (current())
                setBusy(false);
        }
    }
    async function destroy(challengeId=deleteChallenge) {
        const userId = owner.current;
        if (!userId || !challengeId || !current() || lock.current)
            return;
        lock.current = true;
        setBusy(true);
        try {
            const result = await deleteAccount(userId,challengeId,code.trim());
            if (!current())
                return;
            if (result.kind === 'error') {
                setStatus(result.message);
                return;
            }
            clearCachedMeStats();
            clearCachedSubscription();
            await signOut();
            router.replace('/');
        }
        catch {
            if (current())
                setStatus('Could not finish deleting your account. Please try again.');
        }
        finally {
            lock.current = false;
            if (current())
                setBusy(false);
        }
    }
    async function prepareDelete(){
        if(!owner.current||!current()||lock.current)return;
        lock.current=true;setBusy(true);setStatus('');
        let guestChallenge:string|null=null;
        try{
            const result=await prepareAccountDeletion(owner.current);
            if(!current())return;
            if(result.kind==='error'){setStatus(result.message);return;}
            setDeleteChallenge(result.challengeId);setCode('');
            if(result.requiresCode){setSection('delete');setStatus('Enter the confirmation code sent to your current email to permanently delete your account.');}
            else guestChallenge=result.challengeId;
        }finally{lock.current=false;if(current())setBusy(false);}
        if(guestChallenge&&current())await destroy(guestChallenge);
    }
    function confirmDelete() {
        if (busy || !current())
            return;
        appAlert('Delete Account?', 'This permanently deletes your account and all data. This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => {
                    if (current())
                        appAlert('Final Confirmation', 'Are you absolutely sure? Once deleted, your data cannot be recovered.', [
                            { text: 'Cancel', style: 'cancel' }, { text: 'Delete Forever', style: 'destructive', onPress: () => void prepareDelete() },
                        ]);
                } },
        ]);
    }
    const row = (label: string, value: string, onPress?: () => void, danger = false) => <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress || busy} onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: .7 }]}>
  <Text style={[s.label, danger && { color: '#C25B4E' }]}>{label}</Text><Text numberOfLines={1} style={s.value}>{value}</Text>{onPress && <MaterialIcons name="chevron-right" size={23} color={danger ? '#C25B4E' : '#775941'}/>}</Pressable>;
    const action = (label: string, fn: () => void) => <Pressable accessibilityRole="button" onPress={fn} disabled={busy} style={[s.button, busy && { opacity: .6 }]}>{busy ? <ActivityIndicator color="#FFF9F0"/> : <Text style={s.buttonText}>{label}</Text>}</Pressable>;
    return <View style={s.root}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
  <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
   <View style={s.header}><Text style={s.title}>Account Management</Text><Pressable accessibilityLabel="Close account management" onPress={() => router.back()} style={s.close}><MaterialIcons name="close" size={23} color="#FFF9F0"/></Pressable></View>
   {!!status && <Text accessibilityRole="alert" style={s.status}>{status}</Text>}{!ready && action('Retry loading details', () => void reload())}
   <View style={s.card}>{row('Your name', name, () => open('name'))}{row('Your date of birth', profile?.birthday ?? 'Not set', ready ? () => open('birthday') : undefined)}{row('Your gender', profile?.gender ? genders[profile.gender] : 'Not set', ready ? () => open('gender') : undefined)}</View>
   <View style={s.card}>{row('Email', email || 'Not connected', email ? () => open('email') : undefined)}{profile?.has_password ? row('Change password', '', () => open('password')) : row('Sign-in methods', '', () => router.push('/(main)/(modals)/connect-account'))}</View>
   <View style={s.card}>{row('Delete account', '', confirmDelete, true)}</View>
   {section==='delete'?<View style={s.card}>
    <Text style={[s.label,{padding:16}]}>Confirm account deletion</Text>
    <TextInput accessibilityLabel="Account deletion confirmation code" placeholder="Confirmation code" value={code} onChangeText={v=>setCode(v.replace(/\D/g,'').slice(0,8))} keyboardType="number-pad" style={s.input}/>
    {action('Delete Forever',()=>void destroy())}
    {action('Send a new code',()=>void prepareDelete())}
   </View>:section && <View style={s.card}>
    <Text style={[s.label, { padding: 16 }]}>{({ name: 'Your name', birthday: 'Your date of birth', gender: 'Your gender', email: 'Email', password: 'Change password' })[section]}</Text>
    {section === 'birthday' ? <>{Platform.OS !== 'ios' && action(dateKey(birthday), () => setDatePickerOpen(true))}{(Platform.OS === 'ios' || datePickerOpen) && <DateTimePicker value={birthday} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} maximumDate={new Date()} onChange={(_event, date) => { if (Platform.OS !== 'ios')
                setDatePickerOpen(false); if (date)
                setBirthday(date); }}/>}</>
                : section === 'gender' ? Object.entries(genders).map(([key, label]) => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: gender === key }} onPress={() => setGender(key as keyof typeof genders)} style={s.row}><Text style={s.label}>{label}</Text>{gender === key && <MaterialIcons name="check" size={22} color="#B96646"/>}</Pressable>)
                    : <TextInput accessibilityLabel={section === 'password' ? 'New password' : section === 'name' ? 'Your name' : 'New email'} value={input} onChangeText={setInput} maxLength={section === 'name' ? 15 : undefined} secureTextEntry={section === 'password'} autoCapitalize={section === 'name' ? 'words' : 'none'} keyboardType={section === 'email' ? 'email-address' : 'default'} style={s.input}/>}
    {(section === 'email' || section === 'password') && <><Text style={s.helper}>Confirm with a security code sent to your current email.{section === 'email' ? ' The new email must also be verified.' : ''}</Text>{action('Send security code', () => void sendCode())}<TextInput accessibilityLabel="Security code" placeholder="Security code" value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" style={s.input}/></>}
    {action(section === 'email' ? 'Send verification' : 'Save', () => void submit())}
   </View>}
  </ScrollView>
 </KeyboardAvoidingView></View>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: '#F2E6CB' }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }, title: { fontSize: 22, fontWeight: '700', color: '#4A3423' }, close: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#4A3423', alignItems: 'center', justifyContent: 'center' }, card: { backgroundColor: '#FFF9F0', borderRadius: 18, marginBottom: 24, overflow: 'hidden' }, row: { minHeight: 60, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E6D7BE' }, label: { fontSize: 16, color: '#4A3423' }, value: { fontSize: 14, color: '#9A8871', flex: 1, textAlign: 'right' }, input: { margin: 12, borderWidth: 1, borderColor: '#D6C3A5', borderRadius: 12, padding: 14, color: '#4A3423', fontSize: 16 }, button: { margin: 12, minHeight: 48, padding: 12, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4A3423' }, buttonText: { color: '#FFF9F0', fontSize: 16, fontWeight: '700' }, helper: { color: '#8A7A63', paddingHorizontal: 16, lineHeight: 21 }, status: { color: '#8C4D32', paddingVertical: 12, lineHeight: 21 } });

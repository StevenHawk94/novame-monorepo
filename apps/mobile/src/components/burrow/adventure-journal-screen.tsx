import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { queueAdventureJournal } from '@/lib/adventure-journal-jobs';
import { useBurrowSnapshot } from '@/lib/burrow-store';
import { prefetchAdventureRewards } from '@/lib/adventure-prefetch';
import {useAdventureTeamPrefetch} from '@/lib/use-adventure-team-prefetch';
import { keepBurrowTextDraft, readBurrowTextDraft } from '@/lib/burrow-text-drafts';
import { sessionEpoch, sessionUserId } from '@/lib/session-lifecycle';
import { ADVENTURE_LOG_BACKGROUND } from '@/lib/burrow-surface';
import { AdventureRecordCompletion } from './adventure-record-completion';
import { BurrowBackButton } from './burrow-back-button';
import { AdventureStageTransition } from './adventure-stage-transition';
import { AdventureReveal } from './adventure-reveal';

export function AdventureJournalScreen() {
  const router = useRouter(), insets = useSafeAreaInsets(), { data } = useBurrowSnapshot();
  useAdventureTeamPrefetch();
  useEffect(() => { prefetchAdventureRewards(data?.adventureCollection?.enabled); }, [data?.adventureCollection?.enabled]);
  const params = useLocalSearchParams<{ presetPrompt?: string; sourceKit?: string }>();
  const owner = useRef(sessionUserId()), epoch = useRef(sessionEpoch());
  const scope = `${owner.current}:adventure-journal`;
  const target = useRef(`${new Date().toDateString()}:${params.sourceKit || 'write'}:${params.presetPrompt || ''}`).current;
  const [initial] = useState(() => {
    try { return JSON.parse(readBurrowTextDraft(scope, target)?.body || '{}') as { body?: string; shared?: boolean }; }
    catch { return {}; }
  });
  const [body, setBody] = useState(typeof initial.body === 'string' ? initial.body.slice(0, 5000) : '');
  const shared = initial.shared !== false;
  const [error, setError] = useState<string | null>(null), [jobId, setJobId] = useState<string | null>(null);
  const lock = useRef(false);
  function persist(text: string, sharing: boolean) {
    if (epoch.current !== sessionEpoch()) return null;
    try { return keepBurrowTextDraft(scope, target, JSON.stringify({ body: text, shared: sharing })).key; }
    catch { return null; }
  }
  function save() {
    if (lock.current || !body.trim() || epoch.current !== sessionEpoch()) return;
    try {
      const local = keepBurrowTextDraft(scope, target, JSON.stringify({ body, shared }));
      const id = queueAdventureJournal({ promptId: 9, body, mode: 'typing',
        sourceKit: params.sourceKit === 'new_lens' ? 'new_lens' : undefined,
        shareToPartner: !!data?.partner && shared, idempotencyKey: local.key }, { scope, target, key: local.key });
      lock.current = true; Keyboard.dismiss(); setJobId(id);
    } catch { setError('Couldn’t save on this device. Your words are kept — please try again.'); }
  }
  return <AdventureStageTransition stageKey={jobId ? 'logged' : 'write'}>
    {jobId ? <AdventureRecordCompletion jobId={jobId} /> : <View style={s.root}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 28 }]}>
        <BurrowBackButton onPress={() => router.back()} />
        <AdventureReveal><Text accessibilityRole="header" style={s.title}>{params.presetPrompt || 'Something about myself today'}</Text></AdventureReveal>
        <AdventureReveal delay={180} style={{ flex: 1 }}>
        <TextInput accessibilityLabel="Write about your day" style={s.input} autoFocus multiline textAlignVertical="top" maxLength={5000}
          placeholder="Start here…" placeholderTextColor="#77716A" value={body}
          onChangeText={text => { const next = text.slice(0, 5000); setBody(next); persist(next, shared); }} />
        </AdventureReveal>
        <AdventureReveal delay={240}><Text style={s.count}>{body.length} / 5000</Text></AdventureReveal>
        {!!data?.partner&&shared&&<Text style={s.sharing}>Your partner can see this entry, including your words.</Text>}
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <AdventureReveal delay={300}><Pressable accessibilityRole="button" disabled={!body.trim()} onPress={save} style={[s.save, !body.trim() && { opacity: .55 }]}>
          <Text style={s.saveText}>Save</Text>
        </Pressable></AdventureReveal>
      </ScrollView>
    </KeyboardAvoidingView>
  </View>}
  </AdventureStageTransition>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: ADVENTURE_LOG_BACKGROUND }, content: { flexGrow: 1, paddingHorizontal: 20, gap: 16 },
  title: { color: '#FFF9EF', fontSize: 21, lineHeight: 29, fontWeight: '700', marginVertical: 10 },
  input: { flex: 1, minHeight: 160, backgroundColor: '#FAF2E3', color: '#4D2A19', borderRadius: 20, padding: 20, fontSize: 19, lineHeight: 29 },
  count: { color: '#FFF9EF', fontSize: 16, fontWeight: '700', textAlign: 'right' }, error: { color: '#FFF9EF', fontSize: 15 },
  sharing: { color: '#FFF9EF', fontSize: 14, lineHeight: 21 },
  save: { backgroundColor: '#FFC13D', borderRadius: 25, padding: 19, alignItems: 'center', marginTop: 14,
    shadowColor:'#B16D32',shadowOffset:{width:0,height:5},shadowOpacity:1,shadowRadius:0,elevation:3 },
  saveText: { color: '#49270F', fontSize: 23, fontWeight: '700' },
});

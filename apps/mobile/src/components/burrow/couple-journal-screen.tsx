import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { Image } from './burrow-image';
import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useBurrow } from '@/lib/burrow-store';
import { useIsFocused } from '@react-navigation/native';
import { keepBurrowTextDraft, readBurrowTextDraft, removeBurrowTextDraft, rebaseBurrowTextDraft } from '@/lib/burrow-text-drafts';
import {
  cacheCoupleJournal, cachedCoupleJournal, fetchCoupleJournal, fetchCoupleJournalPage, saveCoupleJournalAnswer,
  type CoupleJournalAnswer, type CoupleJournalPage, type CoupleJournalSnapshot,
} from '@/lib/couple-journal';

const BACKGROUND = require('../../../assets/burrow-webp/memories-room.webp');
const ART_WIDTH = 841;
const ART_HEIGHT = 1870;
const serif = Platform.select({ ios: 'Georgia', default: 'serif' });

function dayLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(date).toUpperCase();
}
function errorText(error: unknown) {
  const code = error && typeof error === 'object' && 'body' in error
    && error.body && typeof error.body === 'object' && 'error' in error.body
    ? String(error.body.error) : '';
  if (code === 'journal_conflict') return 'This answer changed on another device. The latest version has been loaded.';
  if (code === 'pair_changed') return 'Your connection changed. Return to Burrow and reopen this journal.';
  return 'Could not save your answer. Please check your connection and try again.';
}

function replacePage(snapshot: CoupleJournalSnapshot, page: CoupleJournalPage) {
  return {
    ...snapshot,
    today: snapshot.today.id === page.id ? page : snapshot.today,
    history: snapshot.history.map(item => item.id === page.id ? page : item),
  };
}

export function CoupleJournalScreen({ initialPageId }: { initialPageId?: string } = {}) {
  const focused = useIsFocused();
  const { data, loading: burrowLoading } = useBurrow();
  const { width, height } = useWindowDimensions();
  const sceneWidth = Math.min(width, 560);
  const scale = sceneWidth / ART_WIDTH;
  const scope = data ? `${data.profile.id}:${data.pairVersion ?? 'solo'}` : '';
  const [snapshot, setSnapshot] = useState<CoupleJournalSnapshot | null>(
    () => scope ? cachedCoupleJournal(scope) : null,
  );
  const [view, setView] = useState<'today' | 'history' | 'detail'>('today');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ pageId: string; body: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const openedTarget = useRef<string | null>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const load = useCallback(async (more = false, preserveError = false) => {
    if (!scope || !data?.profile.id) return;
    const before = more ? snapshotRef.current?.nextBefore : undefined;
    if (more && !before) return;
    const token = ++sequence.current;
    if (more) setLoadingMore(true);
    else if (!snapshotRef.current) setLoading(true);
    if (!preserveError) setError('');
    try {
      const [fresh, target] = await Promise.all([
        fetchCoupleJournal(before ?? undefined),
        (initialPageId && openedTarget.current !== initialPageId) || selectedRef.current
          ? fetchCoupleJournalPage((initialPageId && openedTarget.current !== initialPageId ? initialPageId : selectedRef.current)!)
          : Promise.resolve(null),
      ]);
      if (token !== sequence.current || scope !== scopeRef.current) return;
      setSnapshot(previous => {
        let next = more && previous?.today.id === fresh.today.id
          ? { ...fresh, history: [
            ...previous.history,
            ...fresh.history.filter(page => !previous.history.some(old => old.id === page.id)),
          ] }
          : fresh;
        if (target && target.id !== next.today.id && !next.history.some(page => page.id === target.id))
          next = { ...next, history: [...next.history, target] };
        cacheCoupleJournal(scope, next);
        return next;
      });
      if (target && initialPageId && openedTarget.current !== initialPageId) {
        openedTarget.current = initialPageId;
        setSelectedId(target.id); setView(target.id === fresh.today.id ? 'today' : 'detail');
      }
    } catch {
      if (token === sequence.current) setError('Could not load the journal. Pull down or tap Retry.');
    } finally {
      if (token === sequence.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [scope, data?.profile.id, initialPageId]);

  useEffect(() => {
    sequence.current++;
    setSnapshot(scope ? cachedCoupleJournal(scope) : null);
    setView('today');
    setSelectedId(null);
    openedTarget.current = null;
    setEditor(null);
    setSaving(false);
    setError('');
  }, [scope]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { sequence.current++; };
  }, [load]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (focused && state === 'active' && !saving) void load();
    });
    // Date rollover is checked only on the visible foreground page, not with
    // a per-second timer rendering every screen in the navigator.
    const timer = setInterval(() => {
      if (!focused || saving || AppState.currentState !== 'active' || !snapshotRef.current) return;
      if (!cachedCoupleJournal(scope)) void load();
    }, 30_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [load, focused, saving, scope]);

  const chosen = view === 'detail' ? snapshot?.history.find(page => page.id === selectedId) : snapshot?.today;
  const back = () => {
    if (editor) { setEditor(null); return; }
    if (view === 'detail') { setView('history'); return; }
    if (view === 'history') { setView('today'); return; }
    router.back();
  };
  const save = async () => {
    if (!editor || !snapshot || !data || saving || !editor.body.trim()) return;
    const page = [snapshot.today, ...snapshot.history].find(item => item.id === editor.pageId);
    if (!page) return;
    const previous = snapshot;
    const old = page.answers.find(answer => answer.authorId === data.profile.id);
    let durable;
    try { durable = keepBurrowTextDraft(scope, page.id, editor.body, old?.updatedAt ?? null); }
    catch { setError('Could not keep your draft. Free some device storage and try again.'); return; }
    const optimistic: CoupleJournalAnswer = {
      id: old?.id ?? `pending:${randomUUID()}`,
      authorId: data.profile.id, body: editor.body.trim(),
      createdAt: old?.createdAt ?? new Date().toISOString(),
      updatedAt: old?.updatedAt ?? new Date().toISOString(),
    };
    const draft = replacePage(snapshot, {
      ...page, answers: [...page.answers.filter(answer => answer.authorId !== data.profile.id), optimistic],
    });
    sequence.current++;
    setSnapshot(draft);
    cacheCoupleJournal(scope, draft, false);
    setEditor(null);
    setSaving(true);
    setError('');
    try {
      const saved = await saveCoupleJournalAnswer(page.id, optimistic.body, durable.expectedUpdatedAt, durable.key);
      if (scopeRef.current !== scope) return;
      removeBurrowTextDraft(scope, page.id, durable.key);
      setSnapshot(current => {
        const next = replacePage(current ?? draft, saved);
        cacheCoupleJournal(scope, next);
        return next;
      });
    } catch (cause) {
      if (scopeRef.current !== scope) return;
      if ((cause as { body?: { error?: string } })?.body?.error === 'journal_conflict') {
        try {
          const latest = await fetchCoupleJournalPage(page.id);
          if (scopeRef.current !== scope) return;
          rebaseBurrowTextDraft(scope, page.id, durable.key, latest.answers.find(answer => answer.authorId === data.profile.id)?.updatedAt ?? null);
          const refreshed = replacePage(previous, latest);
          setSnapshot(refreshed); cacheCoupleJournal(scope, refreshed); setEditor(editor);
          setError('This answer changed on another device. Your draft is safe. Review it and tap Save again to replace the latest version.');
          return;
        } catch { /* Keep the original draft if revalidation is offline. */ }
      }
      setSnapshot(previous);
      cacheCoupleJournal(scope, previous);
      setEditor(editor);
      setError(errorText(cause));
      void load(false, true);
    } finally {
      if (scopeRef.current === scope) setSaving(false);
    }
  };

  const pageSide = 140 * scale;
  const editAnswer = (page: CoupleJournalPage, answer?: CoupleJournalAnswer) => {
    const draft = readBurrowTextDraft(scope, page.id);
    setEditor({ pageId: page.id, body: draft?.body ?? answer?.body ?? '' });
  };
  const answerCard = (page: CoupleJournalPage, owner: 'me' | 'partner') => {
    if (!data) return null;
    const mine = owner === 'me';
    const id = mine ? data.profile.id : data.partner?.id;
    const answer = page.answers.find(item => item.authorId === id);
    const name = mine ? 'You' : data.partner?.display_name?.trim() || 'Your person';
    const initial = mine ? 'Y' : name.charAt(0).toUpperCase();
    const canEdit = mine && !saving;
    const editing = editor?.pageId === page.id && mine;
    return <View key={owner} style={[styles.answerCard, {
      minHeight: 280 * scale, borderRadius: 21 * scale, padding: 24 * scale,
      marginTop: 23 * scale,
    }]}>
      <View style={[styles.answerHeading, { gap: 22 * scale }]}>
        <View style={[styles.avatar, {
          width: 72 * scale, height: 72 * scale, borderRadius: 36 * scale,
          backgroundColor: mine ? '#C46A42' : '#6B7050',
        }]}><Text style={{ color: '#FFF7E9', fontSize: 34 * scale }}>{initial}</Text></View>
        <Text numberOfLines={1} style={[styles.answerName, { fontSize: 29 * scale }]}>{name}</Text>
        {canEdit && <Pressable accessibilityRole="button" accessibilityLabel={answer ? 'Edit your answer' : 'Write your answer'}
          onPress={() => editAnswer(page, answer)}
          hitSlop={12} style={styles.editButton}><Feather name="edit-2" size={29 * scale} color="#8B735B" /></Pressable>}
      </View>
      <View style={[styles.rule, { marginLeft: 94 * scale, marginTop: 6 * scale }]} />
      {editing ? <View style={{ marginTop: 20 * scale }}>
        <TextInput accessibilityLabel="Your journal answer" multiline autoFocus maxLength={1500}
          placeholder="Write here..." placeholderTextColor="#9B8978"
          value={editor.body} onChangeText={body => { setEditor({ pageId: page.id, body });
            try { keepBurrowTextDraft(scope, page.id, body, answer?.updatedAt ?? null); }
            catch { setError('Draft could not be saved on this device. Keep this page open until you save.'); }
          }}
          style={[styles.answerInput, { fontSize: 27 * scale, minHeight: 130 * scale }]} />
        <View style={styles.editorActions}>
          <Pressable accessibilityRole="button" onPress={() => setEditor(null)} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Save journal answer"
            accessibilityState={{ disabled: !editor.body.trim() }}
            disabled={!editor.body.trim()} onPress={() => void save()}
            style={[styles.saveButton, !editor.body.trim() && { opacity: .5 }]}><Text style={styles.saveText}>Save</Text></Pressable>
        </View>
      </View> : <Pressable accessibilityRole={canEdit ? 'button' : undefined}
        disabled={!canEdit} onPress={() => editAnswer(page, answer)}>
        <Text selectable={!!answer} style={[styles.answerBody, {
          fontSize: 27 * scale, lineHeight: 41 * scale, marginTop: 20 * scale,
          color: answer ? '#34271F' : '#978371',
        }]}>{answer?.body ?? (mine ? 'Write here...' : 'Waiting for their words...')}</Text>
      </Pressable>}
    </View>;
  };
  const currentPage = (page: CoupleJournalPage) => <View style={{
    paddingHorizontal: pageSide, paddingTop: 370 * scale, paddingBottom: 210 * scale,
    minHeight: ART_HEIGHT * scale,
  }}>
    <Text style={[styles.pageMarker, { fontSize: 17 * scale }]}>PAGE {page.pageNumber}  ·  {view === 'today' ? 'TODAY' : dayLabel(page.date)}</Text>
    <View style={[styles.heartRow, { marginTop: 40 * scale, gap: 48 * scale }]}>
      <View style={styles.heartLine} />
      <Text style={{ color: '#FF9FBB', fontSize: 61 * scale, lineHeight: 70 * scale }}>♥</Text>
      <View style={styles.heartLine} />
    </View>
    <Text style={[styles.question, {
      fontSize: 41 * scale, lineHeight: 52 * scale, marginTop: 44 * scale,
      marginBottom: 62 * scale,
    }]}>{page.question}</Text>
    {answerCard(page, 'me')}
    {!page.private && !!data?.partner && answerCard(page, 'partner')}
  </View>;
  const historyPage = () => <View style={{
    paddingHorizontal: pageSide, paddingTop: 375 * scale, paddingBottom: 230 * scale,
    minHeight: ART_HEIGHT * scale,
  }}>
    {snapshot?.history.length ? snapshot.history.map(page => <Pressable key={page.id}
      accessibilityRole="button" accessibilityLabel={`Open page ${page.pageNumber}, ${page.question}`}
      onPress={() => { setSelectedId(page.id); setView('detail'); setEditor(null); }}
      style={[styles.historyItem, { paddingVertical: 26 * scale, minHeight: 365 * scale }]}>
      <View style={styles.historyTop}>
        <Text style={[styles.pageMarker, { fontSize: 16 * scale, textAlign: 'left' }]}>PAGE {page.pageNumber}  ·  {dayLabel(page.date)}</Text>
        <Feather name="chevron-right" size={29 * scale} color="#35291F" />
      </View>
      <Text style={[styles.historyQuestion, { fontSize: 35 * scale, lineHeight: 45 * scale, marginTop: 12 * scale }]}>{page.question}</Text>
      {(page.private || !data?.partner ? ['me'] : ['me', 'partner'] as const).map(owner => {
        const mine = owner === 'me';
        const personId = mine ? data?.profile.id : data?.partner?.id;
        const answer = page.answers.find(row => row.authorId === personId);
        if (!answer) return null;
        const name = mine ? 'You' : data?.partner?.display_name?.trim() || 'Your person';
        return <View key={owner} style={[styles.historyAnswer, { gap: 24 * scale, marginTop: 22 * scale }]}>
          <View style={[styles.avatar, {
            width: 60 * scale, height: 60 * scale, borderRadius: 30 * scale,
            backgroundColor: mine ? '#C46A42' : '#6B7050',
          }]}><Text style={{ color: '#FFF7E9', fontSize: 29 * scale }}>{mine ? 'Y' : name.charAt(0).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}><Text style={[styles.previewName, { fontSize: 23 * scale }]}>{name}</Text>
            <Text numberOfLines={1} style={[styles.previewBody, { fontSize: 22 * scale }]}>{answer.body}</Text></View>
        </View>;
      })}
    </Pressable>) : <Text style={[styles.empty, { fontSize: 27 * scale }]}>Your past pages will appear here after a day with an answer has passed.</Text>}
    {snapshot?.hasMore && <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void load(true)}
      style={[styles.nextButton, { marginTop: 38 * scale, minHeight: 66 * scale }]}>
      <Text style={{ color: '#FFF5E9', fontSize: 25 * scale }}>{loadingMore ? 'Loading...' : 'Next page  ›'}</Text>
    </Pressable>}
  </View>;

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <StatusBar barStyle="light-content" backgroundColor="#382318" />
    <ScrollView contentContainerStyle={{ minHeight: height }} keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <View style={{ width: sceneWidth, minHeight: Math.max(ART_HEIGHT * scale, height), alignSelf: 'center' }}>
        <Image source={BACKGROUND} contentFit="fill" style={StyleSheet.absoluteFillObject} pointerEvents="none" />
        <View style={[styles.topBar, { top: 118 * scale, height: 76 * scale }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back}
            style={{ width: 78 * scale, height: 76 * scale, marginLeft: 198 * scale }} />
          <Text pointerEvents="none" style={[styles.topTitle, { fontSize: 35 * scale }]}>{view === 'today' ? 'Today' : 'History'}</Text>
          {view === 'today' ? <Pressable accessibilityRole="button" accessibilityLabel="Open journal history"
            onPress={() => { setView('history'); setEditor(null); }}
            style={[styles.historyLink, { marginRight: 30 * scale }]}><Text style={{ color: '#E9D2BD', fontSize: 24 * scale }}>History</Text></Pressable>
            : <View style={styles.historyLink} />}
        </View>
        {!data && burrowLoading ? <View style={{ paddingTop: 530 * scale, alignItems: 'center' }}>
          <ActivityIndicator color="#8C5A42" />
        </View> : !snapshot ? <View style={{ paddingTop: 530 * scale, alignItems: 'center' }}>
          {loading && <ActivityIndicator color="#8C5A42" />}
          {!!error && <Pressable accessibilityRole="button" onPress={() => void load()}>
            <Text style={styles.error}>{error} Retry</Text>
          </Pressable>}
        </View> : view === 'history' ? historyPage() : chosen ? currentPage(chosen) : historyPage()}
        {!!error && !!snapshot && <Pressable accessibilityRole="button" onPress={() => void load()}
          style={[styles.errorBanner, { top: 211 * scale, left: 160 * scale, right: 100 * scale }]}>
          <Text style={styles.error}>{error} Tap to refresh.</Text></Pressable>}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#3A2519' },
  topBar: { position: 'absolute', left: 0, right: 0, zIndex: 5, flexDirection: 'row', alignItems: 'center' },
  topTitle: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: '#FFF6EB', fontWeight: '600' },
  historyLink: { marginLeft: 'auto', minWidth: 70, alignItems: 'center', justifyContent: 'center' },
  pageMarker: { textAlign: 'center', color: '#81715F', letterSpacing: 4, fontWeight: '600' },
  heartRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  heartLine: { height: 1, flex: 1, backgroundColor: '#DCCBBB' },
  question: { color: '#38271E', fontFamily: serif, textAlign: 'center', fontWeight: '400' },
  answerCard: { borderWidth: 1, borderColor: '#E9D6C2', backgroundColor: 'rgba(255,250,241,.33)' },
  answerHeading: { flexDirection: 'row', alignItems: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  answerName: { flex: 1, color: '#231B18', fontWeight: '600' },
  editButton: { padding: 7 },
  rule: { height: 1, backgroundColor: '#E8D8C8' },
  answerBody: { color: '#34271F' },
  answerInput: { color: '#34271F', textAlignVertical: 'top', padding: 0 },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 18, marginTop: 10 },
  cancelButton: { padding: 8 },
  cancelText: { color: '#775746', fontWeight: '600' },
  saveButton: { backgroundColor: '#59392C', borderRadius: 15, paddingHorizontal: 18, paddingVertical: 10 },
  saveText: { color: '#FFF8EC', fontWeight: '700' },
  historyItem: { borderBottomWidth: 1, borderColor: '#E2D0BB' },
  historyTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyQuestion: { color: '#211914', fontFamily: serif },
  historyAnswer: { flexDirection: 'row', alignItems: 'center' },
  previewName: { color: '#211914', fontWeight: '600' },
  previewBody: { color: '#6D5B4E' },
  nextButton: { backgroundColor: '#4D2D20', borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#5F4839', lineHeight: 25 },
  errorBanner: { position: 'absolute', zIndex: 8, padding: 12, backgroundColor: '#FFF5E7', borderRadius: 12 },
  error: { color: '#B04D36', textAlign: 'center' },
});

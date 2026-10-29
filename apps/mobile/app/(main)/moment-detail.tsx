import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiClient } from '@/lib/api';
import { withDeadline } from '@/lib/async-lifecycle';
import { sessionEpoch } from '@/lib/session-lifecycle';
import { useBurrowSnapshot } from '@/lib/burrow-store';
import { momentDescription, momentKind } from '@/lib/burrow-moments-model';
import type { HistoryRow } from '@/lib/burrow-history';
import type { CoupleJournalPage } from '@/lib/couple-journal';
import { BurrowBackButton } from '@/components/burrow/burrow-back-button';

type Detail = { event: HistoryRow; record?: HistoryRow['record']; memory?: { body: string; authorId: string }; page?: CoupleJournalPage };
export default function MomentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useBurrowSnapshot();
  const insets = useSafeAreaInsets();
  const [receipt, setReceipt] = useState<{ identity: string; id: string; data: Detail } | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const identity = `${data?.profile.id}:${data?.pairVersion ?? 'solo'}`;
  const detail = receipt?.identity === identity && receipt.id === id ? receipt.data : null;
  const scope = useRef(identity); scope.current = identity;
  useFocusEffect(useCallback(() => {
    let live = true; const epoch = sessionEpoch(), owner = identity;
    setReceipt(null); setError(false);
    void withDeadline(apiClient.get<Detail & { success: boolean }>(`/api/vnext/moment?id=${encodeURIComponent(id)}`), 15_000)
      .then(value => { if (live && epoch === sessionEpoch() && owner === scope.current) { if (!value.success) throw Error('unavailable'); setReceipt({identity: owner, id, data: value}); } })
      .catch(() => { if (live && epoch === sessionEpoch() && owner === scope.current) setError(true); });
    return () => { live = false; };
  }, [id, identity, retry]));
  const kind = detail ? momentKind(detail.event) : null;
  const title = kind === 'letter' ? 'Love Note' : kind === 'log-day' ? 'Your Day' : kind === 'rage' ? 'A Little Release' : 'Journal';
  return <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
    <View style={styles.header}><BurrowBackButton onPress={() => router.back()} /><Text style={styles.title}>{title}</Text><View style={{ width: 44 }} /></View>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
      {!detail && !error && <ActivityIndicator color="#572B1A" />}
      {error && <Pressable onPress={() => setRetry(n => n + 1)}><Text style={styles.body}>This moment could not be opened, or is no longer shared. Tap to retry.</Text></Pressable>}
      {detail && data && <>
        <Text style={styles.caption}>{new Date(detail.event.created_at).toLocaleDateString()}</Text>
        <Text style={styles.body}>{momentDescription(detail.event, data.profile.id, data.partner?.display_name || 'Your person')}</Text>
        {detail.memory && <Text selectable style={styles.card}>{detail.memory.body.replace(/^💌\s*/, '')}</Text>}
        {detail.record && <>
          {!!detail.record.body && <Text selectable style={styles.card}>{detail.record.body}</Text>}
          {detail.record.items.map(item => <View key={item.itemId} style={styles.card}><Text style={styles.body}>{item.label}</Text>{item.memory && <Text selectable style={styles.body}>{item.memory}</Text>}</View>)}
        </>}
        {detail.page && <>
          <Text style={[styles.body, { fontSize: 25 }]}>{detail.page.question}</Text>
          {detail.page.answers.map(answer => <View key={answer.id} style={styles.card}><Text style={styles.caption}>{answer.authorId === data.profile.id ? 'You' : data.partner?.display_name || 'Your person'}</Text><Text selectable style={styles.body}>{answer.body}</Text></View>)}
          <Pressable onPress={() => router.push({ pathname: '/(main)/burrow-detail', params: { section: 'memories_room', journalPage: detail.page!.id, journalDate: detail.page!.date } })}><Text style={styles.caption}>Open in journal · Edit your answer</Text></Pressable>
        </>}
      </>}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#FFF8ED' }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 }, title: { fontSize: 24, fontWeight: '800', color: '#572B1A' }, content: { padding: 24, gap: 20 }, body: { color: '#462919', fontSize: 18, lineHeight: 28 }, caption: { color: '#92725F', fontSize: 15 }, card: { padding: 20, borderRadius: 18, backgroundColor: '#F3E4D2', color: '#462919', fontSize: 19, lineHeight: 29 } });

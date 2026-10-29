import { BackIcon } from '@/components/burrow/burrow-back-button';
import { useMemo, useState } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { ScreenOverlay as Modal } from '@/components/ui/screen-overlay';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAP_YOUR_DAY_OPTIONAL_CHOICES, type CustomTapItem, type TapYourDayQuestion } from '@novame/engine';
import { CUSTOM_TAP_GROUPS } from '@/lib/custom-tap-catalog';
import { TapDayIcon } from '@/components/ui/tap-day-icon';
import { haptics } from '@/lib/haptics';

/** Only the approved optional activities. Search filters labels; it never matches a journal to icons. */
export function CustomTapItemSheet({ question, addedItems = [], onClose, onSave }: {
  question: TapYourDayQuestion; addedItems?: CustomTapItem[]; onClose: () => void; onSave: (item: CustomTapItem) => void;
}) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState<CustomTapItem | null>(null);
  const [error, setError] = useState('');
  const added = new Set(addedItems.map(item => item.itemId));
  const categories = CUSTOM_TAP_GROUPS.filter(option => option.kind === question.kind);
  const choices = useMemo(() => TAP_YOUR_DAY_OPTIONAL_CHOICES.filter(item => item.kind === question.kind
    && (!group || item.group === group) && item.label.toLowerCase().includes(search.trim().toLowerCase())), [question.kind, group, search]);
  function save() {
    if (!selected || added.has(selected.itemId)) return;
    try { onSave(selected); void haptics.light(); Keyboard.dismiss(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add this activity.'); }
  }
  return <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <View style={[s.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 12} style={s.keyboardArea}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={s.back}>
              <BackIcon color="#50351D"/>
            </Pressable><Text style={s.title}>Add to Your Day</Text>
          </View>
          <Text style={s.hint}>Choose an activity to keep in your daily choices.</Text>
          <TextInput value={search} placeholder="Search activities" placeholderTextColor="#9B958D" style={s.input}
            accessibilityLabel="Search activities" maxLength={80} onChangeText={value => { setSearch(value); setSelected(null); setError(''); }} />
          <View><ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.categories}>
            {[{ title: 'All', value: null }, ...categories.map(option => ({ title: option.title, value: option.title }))].map(option =>
              <Pressable key={option.title} style={[s.category, group === option.value && s.selected]} accessibilityRole="radio"
                accessibilityState={{ selected: group === option.value }} onPress={() => { setGroup(option.value); setSelected(null); setError(''); }}>
                <Text style={s.categoryText}>{option.title}</Text>
              </Pressable>)}
          </ScrollView></View>
          <FlatList data={choices} numColumns={3} keyExtractor={item => item.itemId} keyboardShouldPersistTaps="handled"
            initialNumToRender={18} windowSize={5} style={s.list} contentContainerStyle={s.iconsContent}
            ListEmptyComponent={<Text style={s.hint}>No activities found.</Text>}
            renderItem={({ item }) => <Pressable disabled={added.has(item.itemId)}
              style={[s.cell, selected?.itemId === item.itemId && s.selected, added.has(item.itemId) && s.disabled]}
              onPress={() => { Keyboard.dismiss(); setSelected(item); setError(''); void haptics.light(); }}
              accessibilityRole="radio" accessibilityLabel={item.label}
              accessibilityState={{ selected: selected?.itemId === item.itemId, disabled: added.has(item.itemId) }}>
              <TapDayIcon itemId={item.itemId} size={54} radius={10} />
              <Text style={s.caption}>{item.label}</Text>
              {added.has(item.itemId) && <Text style={s.added}>Added</Text>}
            </Pressable>} />
          {!!error && <Text style={s.error}>{error}</Text>}
          <Pressable disabled={!selected || added.has(selected.itemId)} onPress={save} accessibilityRole="button"
            style={[s.button, (!selected || added.has(selected.itemId)) && s.disabled]}><Text style={s.buttonText}>Add activity</Text></Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}
const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#0008', paddingHorizontal: 12 }, keyboardArea: { flex: 1 },
  sheet: { flex: 1, backgroundColor: '#FFF8E9', borderRadius: 26, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 20, fontFamily: 'Inter_700Bold', color: '#50351D' },
  hint: { fontSize: 14, lineHeight: 20, color: '#73543D' },
  input: { padding: 14, minHeight: 48, backgroundColor: '#FFF', borderRadius: 14, fontSize: 16, color: '#50351D' },
  categories: { gap: 8 }, category: { minHeight: 44, padding: 12, borderRadius: 14, justifyContent: 'center', backgroundColor: '#E9DCCB' },
  categoryText: { fontSize: 12, color: '#50351D', fontFamily: 'Inter_600SemiBold' },
  list: { flex: 1, minHeight: 0 }, iconsContent: { paddingVertical: 8 },
  cell: { width: '33.333%', alignItems: 'center', padding: 8, gap: 5, borderRadius: 12, minHeight: 105 },
  selected: { backgroundColor: '#FFDF72' }, caption: { fontSize: 12, textAlign: 'center', color: '#50351D' },
  added: { fontSize: 11, color: '#73543D' }, disabled: { opacity: 0.45 },
  button: { backgroundColor: '#50351D', padding: 16, borderRadius: 18, alignItems: 'center' },
  buttonText: { fontSize: 20, color: '#FFF', fontFamily: 'Inter_700Bold' }, error: { fontSize: 13, color: '#A43425' },
});

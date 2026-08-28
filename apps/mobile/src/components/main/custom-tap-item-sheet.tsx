import { useMemo, useState } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ITEM_DICTIONARY, matchItems, type CustomTapItem, type TapYourDayQuestion } from '@novame/engine';
import { PROMPT_CATEGORIES } from '@/lib/guided-catalog.g';
import { mergedItemDictionary } from '@/lib/remote-items';
import { ItemSprite } from '@/components/ui/item-sprite';
import { haptics } from '@/lib/haptics';

const catalogGroups = PROMPT_CATEGORIES.flatMap(c => c.subcategories.length
  ? c.subcategories.map(s => ({ key: `${c.key}/${s.key}`, label: s.label, itemIds: s.itemIds }))
  : [{ key: c.key, label: c.label, itemIds: c.itemIds }]);

export function CustomTapItemSheet({ question, onClose, onSave }: {
  question: TapYourDayQuestion; onClose: () => void; onSave: (item: CustomTapItem) => void;
}) {
  const insets = useSafeAreaInsets();
  const [label, setLabel] = useState('');
  const [group, setGroup] = useState(question.groups[0]?.title || 'My Items');
  const [catalog, setCatalog] = useState<string | null>(null);
  const [choosingGroup, setChoosingGroup] = useState(false);
  const [itemId, setItemId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const matches = useMemo(() => label.trim() ? matchItems(label, mergedItemDictionary()).map(m => m.itemId) : [], [label]);
  const browse = catalogGroups.find(g => g.key === catalog);
  const ids = browse?.itemIds || matches;
  function save() {
    if (!itemId || !label.trim()) return;
    try {
      onSave({ itemId, label: label.trim(), group, kind: question.kind, custom: true });
      void haptics.light(); Keyboard.dismiss(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this item.'); }
  }
  return <Modal transparent animationType="fade" onRequestClose={onClose}>
    <View style={[s.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.sheet}>
        <View style={s.header}><Pressable onPress={onClose} accessibilityLabel="Close"><Text style={s.back}>‹</Text></Pressable><Text style={s.title}>Add to Your Day</Text></View>
        <TextInput value={label} maxLength={80} placeholder="Enter activity" style={s.input}
          onChangeText={v => { setLabel(v); setItemId(null); setCatalog(null); }} />
        <Pressable style={s.group} onPress={() => { Keyboard.dismiss(); setChoosingGroup(!choosingGroup); }}><Text style={s.text}>Group: {group}  ›</Text></Pressable>
        {choosingGroup ? <ScrollView keyboardShouldPersistTaps="always" style={{ flex: 1 }}>
          {[...new Set([...question.groups.map(g => g.title).filter(Boolean), ...catalogGroups.map(g => g.label)])].map(name =>
            <Pressable key={name} style={s.group} onPress={() => {
              setGroup(name); setCatalog(catalogGroups.find(g => g.label === name)?.key || null); setChoosingGroup(false);
            }}><Text style={s.text}>{name}</Text></Pressable>)}
        </ScrollView> : <>
          <Text style={s.hint}>{browse ? browse.label : matches.length ? 'Choose a matching item' : 'No match? Browse a group to choose an icon.'}</Text>
          <ScrollView horizontal keyboardShouldPersistTaps="always" style={{ flexGrow: 0, maxHeight: 48 }} showsHorizontalScrollIndicator={false}>
            {catalogGroups.map(g => <Pressable key={g.key} style={[s.chip, catalog === g.key && s.selected]} onPress={() => { Keyboard.dismiss(); setCatalog(g.key); }}><Text style={s.text}>{g.label}</Text></Pressable>)}
          </ScrollView>
          <FlatList data={ids} numColumns={4} keyExtractor={id => id} keyboardShouldPersistTaps="always" initialNumToRender={24} windowSize={5}
            style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12 }} renderItem={({ item: id }) =>
              <Pressable style={[s.cell, itemId === id && s.selected]} onPress={() => { Keyboard.dismiss(); setItemId(id); }} accessibilityRole="radio" accessibilityState={{ selected: itemId === id }}>
                <ItemSprite itemId={id} size={54} radius={10} /><Text style={s.caption}>{ITEM_DICTIONARY.items[id]?.displayName}</Text>
              </Pressable>} />
        </>}
        {!!error && <Text style={s.error}>{error}</Text>}
        <Pressable disabled={!itemId || !label.trim()} onPress={save} style={[s.button, (!itemId || !label.trim()) && { opacity: 0.45 }]}><Text style={s.buttonText}>Save</Text></Pressable>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}
const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#0008', paddingHorizontal: 12 },
  sheet: { flex: 1, backgroundColor: '#FFF8E9', borderRadius: 26, padding: 18, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 }, back: { fontSize: 36, color: '#50351D', paddingHorizontal: 8 },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#50351D' },
  input: { borderRadius: 16, backgroundColor: '#FFF', padding: 16, fontSize: 18, color: '#50351D' },
  group: { backgroundColor: '#FFF', padding: 14, borderRadius: 14, marginBottom: 5 },
  text: { fontSize: 14, color: '#50351D', fontFamily: 'Inter_600SemiBold' }, hint: { fontSize: 13, color: '#73543D' },
  chip: { padding: 10, borderRadius: 12, backgroundColor: '#E9DCCB', marginRight: 6 },
  cell: { width: '25%', alignItems: 'center', padding: 5, gap: 5, borderRadius: 12 },
  selected: { backgroundColor: '#FFDF72' }, caption: { fontSize: 11, textAlign: 'center', color: '#50351D' },
  button: { backgroundColor: '#50351D', padding: 18, borderRadius: 18, alignItems: 'center' },
  buttonText: { fontSize: 20, color: '#FFF', fontFamily: 'Inter_700Bold' }, error: { fontSize: 13, color: '#A43425' },
});

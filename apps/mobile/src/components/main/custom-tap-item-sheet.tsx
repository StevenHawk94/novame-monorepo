import { useMemo, useState } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenOverlay as Modal } from '@/components/ui/screen-overlay';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { matchItems, type CustomTapItem, type TapYourDayQuestion } from '@novame/engine';
import { CUSTOM_TAP_GROUPS, CUSTOM_TAP_ICON_CATEGORIES, customTapDestination } from '@/lib/custom-tap-catalog';
import { mergedItemDictionary, remoteIdsForPromptCategory } from '@/lib/remote-items';
import { ItemSprite } from '@/components/ui/item-sprite';
import { haptics } from '@/lib/haptics';

export function CustomTapItemSheet({ question, onClose, onSave }: {
  question: TapYourDayQuestion; onClose: () => void; onSave: (item: CustomTapItem) => void;
}) {
  const insets = useSafeAreaInsets();
  const [label, setLabel] = useState('');
  const [group, setGroup] = useState(question.groups.find(group => !!group.title)?.title || CUSTOM_TAP_GROUPS[0].title);
  const [catalog, setCatalog] = useState<string | null>(null);
  const [picker, setPicker] = useState<'group' | 'category' | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const matches = useMemo(() => label.trim() ? matchItems(label, mergedItemDictionary()).map(m => m.itemId) : [], [label]);
  const browse = CUSTOM_TAP_ICON_CATEGORIES.find(category => category.key === catalog);
  const dictionary = mergedItemDictionary();
  const ids = browse
    ? [...new Set([...browse.itemIds, ...remoteIdsForPromptCategory(browse.key), ...remoteIdsForPromptCategory(browse.label)])]
    : matches;
  const destination = customTapDestination(group);
  const canSave = !!itemId && !!label.trim() && !!destination;

  function openPicker(next: 'group' | 'category') {
    Keyboard.dismiss();
    void haptics.light();
    setPicker(current => current === next ? null : next);
  }
  function goBack() {
    void haptics.light();
    if (picker) setPicker(null); else onClose();
  }
  function save() {
    if (!itemId || !label.trim() || !destination) return;
    try {
      // The chosen destination owns the question, even when adding from the other page.
      onSave({ itemId, label: label.trim(), group: destination.title, kind: destination.kind, custom: true });
      void haptics.light(); Keyboard.dismiss(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this item.'); }
  }
  return <Modal transparent animationType="fade" onRequestClose={goBack} statusBarTranslucent navigationBarTranslucent>
    <View style={[s.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      {/* Keep sheet padding inside KAV: iOS keyboard padding must not replace the footer inset. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 12} style={s.keyboardArea}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel={picker ? 'Back to add item' : 'Close'} style={s.back}>
              <MaterialIcons name="arrow-back" size={25} color="#50351D" />
            </Pressable>
            <Text style={s.title}>{picker === 'category' ? 'Choose a Category' : picker === 'group' ? 'Select Group' : 'Add to Your Day'}</Text>
          </View>
          <View style={s.field}>
            <View style={[s.fieldIcon, s.typingIcon]}><MaterialIcons name="edit" size={24} color="#FFF" /></View>
            <TextInput value={label} maxLength={80} placeholder="Enter Activity" placeholderTextColor="#9B958D" style={s.input}
              accessibilityLabel="Enter Activity"
              onChangeText={value => { setLabel(value); setItemId(null); setCatalog(null); setPicker(null); setError(''); }} />
          </View>
          <Pressable style={s.field} onPress={() => openPicker('group')} accessibilityRole="button" accessibilityLabel={`Select Group: ${group}`}>
            <View style={[s.fieldIcon, s.categoryIcon]}><MaterialIcons name="folder" size={24} color="#FFF" /></View>
            <Text style={s.fieldLabel}>Select Group</Text>
            <Text style={s.groupValue}>{group}</Text>
            <MaterialIcons name="chevron-right" size={24} color="#50351D" />
          </Pressable>
          {picker ? <ScrollView keyboardShouldPersistTaps="always" style={s.list} contentContainerStyle={s.pickerContent}>
            {picker === 'group' ? CUSTOM_TAP_GROUPS.map(option =>
              <Pressable key={option.title} style={[s.option, group === option.title && s.selected]} accessibilityRole="radio" accessibilityState={{ selected: group === option.title }} onPress={() => {
                setGroup(option.title); setPicker(null); void haptics.light();
              }}><Text style={s.text}>{option.title}</Text></Pressable>) : CUSTOM_TAP_ICON_CATEGORIES.map(option =>
              <Pressable key={option.key} style={[s.option, catalog === option.key && s.selected]} accessibilityRole="radio" accessibilityState={{ selected: catalog === option.key }} onPress={() => {
                setCatalog(option.key); setItemId(null); setPicker(null); void haptics.light();
              }}><Text style={s.text}>{option.label}</Text></Pressable>)}
          </ScrollView> : <>
            <Text style={s.hint}>{browse ? 'Choose an icon for your activity.' : matches.length ? 'Choose a matching item, or browse a category.' : 'No match? Choose a category to find an icon.'}</Text>
            <Pressable style={s.browseButton} onPress={() => openPicker('category')} accessibilityRole="button">
              <Text style={[s.text, s.browseLabel]}>{browse?.label || 'Browse Categories'}</Text>
              <MaterialIcons name="expand-more" size={22} color="#50351D" />
            </Pressable>
            <FlatList data={ids} numColumns={4} keyExtractor={id => id} keyboardShouldPersistTaps="always" initialNumToRender={24} windowSize={5}
              style={s.list} contentContainerStyle={s.iconsContent} renderItem={({ item: id }) =>
                <Pressable style={[s.cell, itemId === id && s.selected]} onPress={() => { Keyboard.dismiss(); setItemId(id); void haptics.light(); }} accessibilityRole="radio" accessibilityState={{ selected: itemId === id }} accessibilityLabel={dictionary.items[id]?.displayName}>
                  <ItemSprite itemId={id} size={54} radius={10} /><Text style={s.caption}>{dictionary.items[id]?.displayName}</Text>
                </Pressable>} />
          </>}
          {!!error && <Text style={s.error}>{error}</Text>}
          {!picker && <View style={s.footer}>
            <Pressable disabled={!canSave} onPress={save} accessibilityRole="button" style={[s.button, !canSave && s.disabled]}><Text style={s.buttonText}>Save</Text></Pressable>
          </View>}
        </View>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}
const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#0008', paddingHorizontal: 12 },
  keyboardArea: { flex: 1 },
  sheet: { flex: 1, backgroundColor: '#FFF8E9', borderRadius: 26, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 20, fontFamily: 'Inter_700Bold', color: '#50351D' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, minHeight: 62 },
  fieldIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  typingIcon: { backgroundColor: '#F2BF2F' }, categoryIcon: { backgroundColor: '#9DC63B' },
  input: { flex: 1, minWidth: 0, paddingVertical: 8, fontSize: 16, color: '#50351D' },
  fieldLabel: { flexShrink: 1, fontSize: 14, color: '#9B958D' },
  groupValue: { flex: 1, fontSize: 12, lineHeight: 17, textAlign: 'right', color: '#50351D', fontFamily: 'Inter_700Bold' },
  list: { flex: 1, minHeight: 0 }, pickerContent: { gap: 8, paddingVertical: 4 },
  option: { backgroundColor: '#FFF', padding: 14, minHeight: 48, justifyContent: 'center', borderRadius: 14 },
  text: { fontSize: 14, color: '#50351D', fontFamily: 'Inter_600SemiBold' },
  hint: { fontSize: 13, lineHeight: 18, color: '#73543D' },
  browseButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E9DCCB', padding: 12, borderRadius: 12 }, browseLabel: { flex: 1 },
  iconsContent: { paddingVertical: 8 },
  cell: { width: '25%', alignItems: 'center', padding: 5, gap: 5, borderRadius: 12 },
  selected: { backgroundColor: '#FFDF72' }, caption: { fontSize: 11, textAlign: 'center', color: '#50351D' },
  footer: { paddingTop: 4, paddingBottom: 8 },
  button: { backgroundColor: '#50351D', padding: 16, borderRadius: 18, alignItems: 'center' }, disabled: { opacity: 0.45 },
  buttonText: { fontSize: 20, color: '#FFF', fontFamily: 'Inter_700Bold' }, error: { fontSize: 13, color: '#A43425' },
});

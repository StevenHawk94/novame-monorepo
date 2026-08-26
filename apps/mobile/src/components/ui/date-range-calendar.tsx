import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function iso(y: number, m: number, d: number): string { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }

export function DateRangeCalendar({ visible, start, end, onChange, onClose, onDone, doneLabel = 'Show memories' }: {
  visible: boolean;
  start: string | null;
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
  onClose: () => void;
  onDone?: (start: string | null, end: string | null) => void;
  doneLabel?: string;
}) {
  const now = new Date();
  const [ym, setYm] = useState(() => start
    ? { y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 }
    : { y: now.getFullYear(), m: now.getMonth() });
  const first = new Date(ym.y, ym.m, 1);
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const rangeEnd = end ?? start;

  function tap(day: number) {
    const date = iso(ym.y, ym.m, day);
    if (!start || end) return onChange(date, null);
    if (date <= start) return onChange(date, null);
    onChange(start, date);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.monthRow}>
            <Pressable onPress={() => setYm(({ y, m }) => m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })} hitSlop={10}>
              <MaterialIcons name="chevron-left" size={28} color="#4A3423" />
            </Pressable>
            <Text style={styles.monthLabel}>{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
            <Pressable onPress={() => setYm(({ y, m }) => m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 })} hitSlop={10}>
              <MaterialIcons name="chevron-right" size={28} color="#4A3423" />
            </Pressable>
          </View>
          <View style={styles.weekRow}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <Text key={`${w}:${i}`} style={styles.weekDay}>{w}</Text>)}
          </View>
          <View style={styles.grid}>
            {cells.map((day, i) => {
              if (day === null) return <View key={i} style={styles.cell} />;
              const date = iso(ym.y, ym.m, day);
              const inRange = !!start && !!rangeEnd && date >= start && date <= rangeEnd;
              const edge = date === start || date === rangeEnd;
              return (
                <Pressable key={i} onPress={() => tap(day)} style={styles.cell}>
                  <View style={[styles.day, inRange && styles.dayInRange, edge && styles.dayEdge]}>
                    <Text style={[styles.dayText, edge && styles.dayTextEdge]}>{day}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.actions}>
            <Pressable onPress={() => onChange(null, null)} style={styles.clearButton}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
            <Pressable onPress={() => { void haptics.pageClose(); onDone?.(start, end); onClose(); }} style={styles.doneButton}>
              <Text style={styles.doneText}>{doneLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(42,33,24,0.52)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  card: { width: '100%', maxWidth: 410, backgroundColor: '#FDF6EC', borderRadius: 28, padding: 20 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  monthLabel: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#2E2418' },
  weekRow: { flexDirection: 'row', marginBottom: 5 },
  weekDay: { flex: 1, textAlign: 'center', fontSize: 12, fontFamily: 'Inter_700Bold', color: '#9A8770' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayInRange: { backgroundColor: '#EAD9BE' },
  dayEdge: { backgroundColor: '#4A3423' },
  dayText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#3A2E1A' },
  dayTextEdge: { color: '#FFF6E8' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  clearButton: { paddingVertical: 13, paddingHorizontal: 14 },
  clearText: { color: '#8A6240', fontSize: 15, fontFamily: 'Inter_700Bold' },
  doneButton: { borderRadius: 20, backgroundColor: '#4A3423', paddingVertical: 13, paddingHorizontal: 22 },
  doneText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },
});

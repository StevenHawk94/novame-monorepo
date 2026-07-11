/**
 * Shipping form modal — Stage 3.9.B.5
 *
 * Address form for printed-product orders. Receives ?product=
 * wisdom_book or wisdom_cards. Persists the address to MMKV under
 * 'novame.shipping' so a returning user doesn't re-type. The
 * Continue button is disabled until all required fields are filled,
 * then routes to /(modals)/payment-stub which carries the same
 * product param plus a serialized shipping payload.
 *
 * Visual:
 *   - Deep purple background (matches the rest of the (modals) flow).
 *   - White-background, black-text inputs for legibility (industry
 *     standard for shipping forms).
 *   - Country uses a search-and-pick row (full COUNTRIES list).
 *   - State auto-switches between a search-pick (when the country
 *     has a known state list) and a free-text input otherwise.
 *
 * The form does NOT POST to /api/orders here — that happens after
 * the user confirms payment. Stage 5 will replace payment-stub with
 * the real Airwallex flow and at that point the order POST moves
 * inline with the payment intent creation.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { COUNTRIES, STATES, type CountryOption, type StateOption } from '@novame/domain';
import { storage } from '@/lib/storage';
import { haptics } from '@/lib/haptics';

const STORAGE_KEY = 'novame.shipping';

type ShippingState = {
  name: string;
  address: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
};

const DEFAULT_STATE: ShippingState = {
  name: '',
  address: '',
  address2: '',
  city: '',
  state: '',
  zip: '',
  country: 'US',
  phone: '',
};

function readPersisted(): ShippingState {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<ShippingState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function persist(state: ShippingState): void {
  storage.set(STORAGE_KEY, JSON.stringify(state));
}

export default function ShippingFormModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ product?: string }>();
  const product =
    params.product === 'wisdom_cards' ? 'wisdom_cards' : 'wisdom_book';

  const [shipping, setShipping] = useState<ShippingState>(() => readPersisted());

  const countryStates = useMemo(
    () => STATES[shipping.country] ?? [],
    [shipping.country],
  );
  const hasStateList = countryStates.length > 0;

  const valid = useMemo(
    () =>
      !!shipping.name.trim() &&
      !!shipping.address.trim() &&
      !!shipping.city.trim() &&
      !!shipping.state.trim() &&
      !!shipping.zip.trim() &&
      !!shipping.country.trim(),
    [shipping],
  );

  const update = (patch: Partial<ShippingState>) => {
    setShipping((prev) => {
      const next = { ...prev, ...patch };
      // Clear state when country changes — old state codes don't
      // make sense in a new country's list.
      if (patch.country && patch.country !== prev.country) {
        next.state = '';
      }
      persist(next);
      return next;
    });
  };

  const onContinue = () => {
    void haptics.light();
    if (!valid) return;
    router.push({
      pathname: '/(main)/(modals)/payment-stub',
      params: {
        product,
        shipping: JSON.stringify(shipping),
      },
    });
  };

  const goBack = () => {
    void haptics.light();
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/bags');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          style={({ pressed }) => [
            styles.backBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Shipping Information</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: 120 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Field label="Full Name">
          <TextInput
            style={styles.input}
            placeholder="John Doe"
            placeholderTextColor="rgba(0,0,0,0.35)"
            value={shipping.name}
            onChangeText={(v) => update({ name: v })}
            autoCorrect={false}
          />
        </Field>

        <Field label="Country">
          <CountryPicker
            value={shipping.country}
            onChange={(v) => update({ country: v })}
          />
        </Field>

        <Field label="Street Address">
          <TextInput
            style={styles.input}
            placeholder="123 Main St"
            placeholderTextColor="rgba(0,0,0,0.35)"
            value={shipping.address}
            onChangeText={(v) => update({ address: v })}
            autoCorrect={false}
          />
        </Field>

        <Field label="Apt / Suite (optional)">
          <TextInput
            style={styles.input}
            placeholder="Apt 4B"
            placeholderTextColor="rgba(0,0,0,0.35)"
            value={shipping.address2}
            onChangeText={(v) => update({ address2: v })}
            autoCorrect={false}
          />
        </Field>

        <Field label="City">
          <TextInput
            style={styles.input}
            placeholder="Los Angeles"
            placeholderTextColor="rgba(0,0,0,0.35)"
            value={shipping.city}
            onChangeText={(v) => update({ city: v })}
            autoCorrect={false}
          />
        </Field>

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Field
              label={shipping.country === 'US' ? 'State' : 'State / Province'}
            >
              {hasStateList ? (
                <StatePicker
                  value={shipping.state}
                  options={countryStates}
                  onChange={(v) => update({ state: v })}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  placeholder="State / Province"
                  placeholderTextColor="rgba(0,0,0,0.35)"
                  value={shipping.state}
                  onChangeText={(v) => update({ state: v })}
                  autoCorrect={false}
                />
              )}
            </Field>
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Field label="ZIP / Postal">
              <TextInput
                style={styles.input}
                placeholder="90001"
                placeholderTextColor="rgba(0,0,0,0.35)"
                value={shipping.zip}
                onChangeText={(v) => update({ zip: v })}
                autoCorrect={false}
                autoCapitalize="characters"
              />
            </Field>
          </View>
        </View>

        <Field label="Phone">
          <TextInput
            style={styles.input}
            placeholder="+1 (555) 000-0000"
            placeholderTextColor="rgba(0,0,0,0.35)"
            value={shipping.phone}
            onChangeText={(v) => update({ phone: v })}
            keyboardType="phone-pad"
          />
        </Field>
      </ScrollView>

      {/* Sticky CTA */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          onPress={onContinue}
          disabled={!valid}
          style={({ pressed }) => [
            styles.cta,
            valid ? styles.ctaActive : styles.ctaInactive,
            valid && pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={[styles.ctaText, !valid && styles.ctaTextInactive]}>
            Continue to Payment
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function CountryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = COUNTRIES.find((c) => c.code === value);

  const filtered = useMemo(() => {
    if (!query) return COUNTRIES;
    const q = query.toLowerCase();
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <Pressable
        onPress={() => { void haptics.light(); setOpen(true); }}
        style={({ pressed }) => [
          styles.input,
          styles.pickerBtn,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.pickerText}>
          {selected ? selected.name : 'Select country'}
        </Text>
        <MaterialIcons name="expand-more" size={20} color="rgba(0,0,0,0.5)" />
      </Pressable>

      <PickerSheet
        visible={open}
        title="Select country"
        query={query}
        onQueryChange={setQuery}
        onClose={close}
        options={filtered.map((c) => ({ code: c.code, name: c.name }))}
        selectedCode={value}
        onSelect={(code) => {
          onChange(code);
          close();
        }}
      />
    </>
  );
}

function StatePicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: StateOption[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.code === value);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q),
    );
  }, [query, options]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <Pressable
        onPress={() => { void haptics.light(); setOpen(true); }}
        style={({ pressed }) => [
          styles.input,
          styles.pickerBtn,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.pickerText}>
          {selected ? selected.name : 'Select state'}
        </Text>
        <MaterialIcons name="expand-more" size={20} color="rgba(0,0,0,0.5)" />
      </Pressable>

      <PickerSheet
        visible={open}
        title="Select state"
        query={query}
        onQueryChange={setQuery}
        onClose={close}
        options={filtered.map((s) => ({ code: s.code, name: s.name }))}
        selectedCode={value}
        onSelect={(code) => {
          onChange(code);
          close();
        }}
      />
    </>
  );
}

function PickerSheet({
  visible,
  title,
  query,
  onQueryChange,
  onClose,
  options,
  selectedCode,
  onSelect,
}: {
  visible: boolean;
  title: string;
  query: string;
  onQueryChange: (v: string) => void;
  onClose: () => void;
  options: { code: string; name: string }[];
  selectedCode: string;
  onSelect: (code: string) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + 16 },
        ]}
      >
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <MaterialIcons name="close" size={22} color="rgba(255,255,255,0.6)" />
          </Pressable>
        </View>
        <View style={styles.sheetSearchWrap}>
          <MaterialIcons name="search" size={18} color="rgba(255,255,255,0.4)" />
          <TextInput
            style={styles.sheetSearch}
            placeholder="Search…"
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={query}
            onChangeText={onQueryChange}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <ScrollView
          style={styles.sheetList}
          contentContainerStyle={{ paddingBottom: 8 }}
          keyboardShouldPersistTaps="handled"
        >
          {options.length === 0 ? (
            <Text style={styles.sheetEmpty}>No results</Text>
          ) : (
            options.map((o) => {
              const active = o.code === selectedCode;
              return (
                <Pressable
                  key={o.code}
                  onPress={() => { void haptics.light(); onSelect(o.code); }}
                  style={({ pressed }) => [
                    styles.sheetRow,
                    active && styles.sheetRowActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[styles.sheetRowText, active && styles.sheetRowTextActive]}
                  >
                    {o.name}
                  </Text>
                  {active ? (
                    <MaterialIcons name="check" size={18} color="#C084FC" />
                  ) : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: '#FFFFFF',
    color: '#1A1A1A',
    fontSize: 15,
    fontWeight: '500',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  row2: {
    flexDirection: 'row',
  },
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerText: {
    color: '#1A1A1A',
    fontSize: 15,
    fontWeight: '500',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(15,11,46,0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  cta: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  ctaActive: {
    backgroundColor: '#A855F7',
  },
  ctaInactive: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  ctaTextInactive: {
    color: 'rgba(255,255,255,0.35)',
  },
  // Picker bottom sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: '#1A1640',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: '70%',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  sheetTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  sheetSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 10,
    marginVertical: 8,
    gap: 6,
  },
  sheetSearch: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    paddingVertical: 10,
  },
  sheetList: {
    maxHeight: 380,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 2,
  },
  sheetRowActive: {
    backgroundColor: 'rgba(168,85,247,0.16)',
  },
  sheetRowText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '600',
  },
  sheetRowTextActive: {
    color: '#C084FC',
    fontWeight: '800',
  },
  sheetEmpty: {
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    paddingVertical: 24,
    fontSize: 13,
  },
});

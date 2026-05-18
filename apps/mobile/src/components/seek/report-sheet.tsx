/**
 * ReportSheet -- Stage 6 UGC compliance.
 *
 * BottomSheetModal that lets users select a reason + optional detail
 * to report a wisdom card. Required for Apple App Store Guideline 1.2
 * (UGC moderation).
 *
 * Flow:
 *   Parent opens via ref.present(cardId). Sheet collects reason +
 *   detail and calls onSubmit(cardId, reason, detail). Parent is
 *   responsible for the actual API call (so it can drive optimistic
 *   list removal). Sheet dismisses itself on submit success and
 *   resets state for next presentation.
 *
 * Visual style mirrors rating-prompt-sheet (paywall purple + pink
 * primary + white secondary + small skip text), keeping the brand
 * tone consistent across all bottom sheets in the app.
 *
 * Reasons displayed are the 8 industry-standard categories required
 * by Apple reviewers. "Other" surfaces a required detail textarea
 * so admins have something actionable to review.
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { haptics } from '@/lib/haptics';
import type { ReportReason } from '@/lib/wisdom-card-reports';

type ReasonOption = {
  key: ReportReason;
  label: string;
  emoji: string;
};

const REASON_OPTIONS: ReasonOption[] = [
  { key: 'spam', label: 'Spam or misleading', emoji: '\u{1F4E2}' },
  { key: 'inappropriate', label: 'Inappropriate or offensive', emoji: '\u{26A0}' },
  { key: 'harassment', label: 'Hate speech or harassment', emoji: '\u{1F6AB}' },
  { key: 'violence', label: 'Violence or dangerous content', emoji: '\u{2620}' },
  { key: 'sexual', label: 'Sexual content', emoji: '\u{1F51E}' },
  { key: 'self_harm', label: 'Self-harm or suicide', emoji: '\u{1F494}' },
  { key: 'misinformation', label: 'Misinformation', emoji: '\u{2753}' },
  { key: 'other', label: 'Other (please describe below)', emoji: '\u{1F4DD}' },
];

export type ReportSheetRef = {
  present: (cardId: string) => void;
  dismiss: () => void;
};

export type ReportSheetProps = {
  onSubmit: (cardId: string, reason: ReportReason, detail: string) => void;
};

export const ReportSheet = forwardRef<ReportSheetRef, ReportSheetProps>(
  function ReportSheet({ onSubmit }, externalRef) {
    const internalRef = useRef<BottomSheetModal>(null);
    const [cardId, setCardId] = useState<string | null>(null);
    const [reason, setReason] = useState<ReportReason | null>(null);
    const [detail, setDetail] = useState<string>('');

    const handleChange = useCallback((index: number) => {
      if (index === -1) {
        // Sheet fully dismissed -- reset state for next presentation.
        setCardId(null);
        setReason(null);
        setDetail('');
      }
    }, []);

    useImperativeHandle(externalRef, () => ({
      present: (id: string) => {
        setCardId(id);
        setReason(null);
        setDetail('');
        internalRef.current?.present();
      },
      dismiss: () => internalRef.current?.dismiss(),
    }));

    const snapPoints = useMemo(() => ['95%'], []);

    const renderBackdrop = useCallback(
      (backdropProps: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...backdropProps}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.6}
          pressBehavior="close"
        />
      ),
      [],
    );

    const handlePickReason = (next: ReportReason) => {
      haptics.light();
      setReason(next);
    };

    const handleSubmit = () => {
      if (!cardId || !reason) return;
      // "Other" requires a detail explanation so the admin has
      // something actionable to review.
      if (reason === 'other' && detail.trim().length < 3) return;
      haptics.medium();
      onSubmit(cardId, reason, detail);
      internalRef.current?.dismiss();
    };

    const handleCancel = () => {
      haptics.light();
      internalRef.current?.dismiss();
    };

    const canSubmit =
      reason !== null && (reason !== 'other' || detail.trim().length >= 3);

    return (
      <BottomSheetModal
        ref={internalRef}
        index={0}
        snapPoints={snapPoints}
        onChange={handleChange}
        backdropComponent={renderBackdrop}
        handleStyle={styles.handle}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.background}
        enablePanDownToClose
        enableDynamicSizing={false}
        keyboardBehavior="interactive"
      >
        <BottomSheetScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Report this wisdom</Text>
          <Text style={styles.subtitle}>
            Help us keep NovaMe safe. We review every report within 24 hours.
          </Text>

          <Text style={styles.sectionLabel}>Why are you reporting this?</Text>

          {REASON_OPTIONS.map((opt) => {
            const selected = reason === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => handlePickReason(opt.key)}
                style={({ pressed }) => [
                  styles.reasonRow,
                  selected && styles.reasonRowSelected,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.reasonEmoji}>{opt.emoji}</Text>
                <Text
                  style={[
                    styles.reasonLabel,
                    selected && styles.reasonLabelSelected,
                  ]}
                >
                  {opt.label}
                </Text>
                {selected ? <Text style={styles.checkmark}>{'\u{2713}'}</Text> : null}
              </Pressable>
            );
          })}

          <Text style={styles.sectionLabel}>
            Additional details {reason === 'other' ? '(required)' : '(optional)'}
          </Text>
          <TextInput
            value={detail}
            onChangeText={setDetail}
            placeholder="Tell us more about why this content violates our guidelines"
            placeholderTextColor="rgba(31,17,71,0.4)"
            multiline
            maxLength={500}
            style={styles.detailInput}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{detail.length}/500</Text>

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.submitButton,
              !canSubmit && styles.submitButtonDisabled,
              pressed && canSubmit && { opacity: 0.9 },
            ]}
          >
            <Text style={styles.submitLabel}>Submit Report</Text>
          </Pressable>

          <Pressable onPress={handleCancel} style={styles.cancelButton}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  },
);

const styles = StyleSheet.create({
  background: {
    backgroundColor: '#7C3AED',
  },
  handle: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  handleIndicator: {
    backgroundColor: 'rgba(255,255,255,0.4)',
    width: 40,
  },
  container: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 48,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  sectionLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    marginTop: 12,
    marginBottom: 10,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: 8,
    gap: 12,
  },
  reasonRowSelected: {
    backgroundColor: '#FFFFFF',
  },
  reasonEmoji: {
    fontSize: 18,
  },
  reasonLabel: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  reasonLabelSelected: {
    color: '#1F1147',
    fontFamily: 'Inter_700Bold',
  },
  checkmark: {
    color: '#EC4899',
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  detailInput: {
    backgroundColor: '#FFFFFF',
    color: '#1F1147',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    minHeight: 90,
    maxHeight: 140,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    lineHeight: 22,
  },
  charCount: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'right',
    marginTop: 6,
    marginBottom: 24,
  },
  submitButton: {
    backgroundColor: '#EC4899',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
    marginBottom: 12,
  },
  submitButtonDisabled: {
    backgroundColor: 'rgba(236,72,153,0.4)',
    shadowOpacity: 0,
  },
  submitLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  cancelButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
});

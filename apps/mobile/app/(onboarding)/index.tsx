import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { appAlert } from '@/components/ui/app-dialog';
import { BurrowOnboardingPages, OnboardingButton } from '@/components/onboarding/burrow-onboarding-pages';
import { ONBOARDING_FLOW as FLOW, ONBOARDING_CREAM, ONBOARDING_INK, type OnboardingStep as Step } from '@/lib/burrow-onboarding-design';
import { haptics } from '../../src/lib/haptics';
import { beginHomeEntry, deferHomeEntryNotification } from '../../src/lib/home-entry-readiness';
import { enableFeatureGuidesForNewUser } from '../../src/lib/feature-guides';
import {
  beginAnonymousOnboardingAuthHandoff, markIntroSeen, endAnonymousOnboardingAuthHandoff,
  setBunnyName, setChosenCompanion, queueOnboardingProfile, syncOnboardingCompanion, syncOnboardingProfile,
} from '../../src/lib/onboarding';
import { logOnboardingCompleted, logRegistration } from '../../src/lib/ad-measurement';
import { useMetaPrivacy } from '../../src/components/privacy/meta-privacy-provider';
import {
  connectProviderOrSignIn, ensureSession, sendPasswordlessEmailOtp, verifyPasswordlessEmailOtp,
  type PasswordlessEmailMode,
} from '../../src/lib/auth';
import { supabase } from '../../src/lib/supabase';
import { updateDisplayName } from '../../src/lib/account-api';
import { queueProfileAvatar, syncProfileAvatar } from '../../src/lib/avatar-upload-queue';
import { DEFAULT_AVATAR_OPTIONS } from '../../src/lib/avatar';
import { addFriend, fetchFriends, type FriendsStatus } from '../../src/lib/friends-api';
import { initIAP, onPurchaseComplete, onPurchaseError, purchaseSubscription, restoreSubscriptions } from '../../src/lib/iap';
import { markNotifPromptedAfterPurchase, shouldPromptNotifAfterPurchase } from '../../src/lib/notification-settings';
import { useStoreSubscriptionPricing } from '../../src/hooks/use-store-subscription-pricing';

type OnboardingDateInputProps = {
  value: string;
  onChange: (value: string) => void;
  defaultYearsAgo: number;
  accessibilityLabel: string;
};

function OnboardingDateInput({
  value,
  onChange,
  defaultYearsAgo,
  accessibilityLabel,
}: OnboardingDateInputProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => dateYearsAgo(defaultYearsAgo));
  const maximumDate = useMemo(() => startOfLocalDay(new Date()), []);
  const minimumDate = useMemo(() => new Date(1900, 0, 1, 12), []);

  function showPicker() {
    const existing = displayDateToLocalDate(value);
    setDraft(existing ?? dateYearsAgo(defaultYearsAgo));
    setOpen(true);
    void haptics.light();
  }

  function onNativeChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === 'android') {
      setOpen(false);
      if (event.type === 'set' && selectedDate) {
        onChange(formatDisplayDate(selectedDate));
        void haptics.success();
      }
      return;
    }
    if (selectedDate) setDraft(selectedDate);
  }

  function confirm() {
    onChange(formatDisplayDate(draft));
    setOpen(false);
    void haptics.success();
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Opens a date picker"
        onPress={showPicker}
        style={({ pressed }) => [styles.formInputWrap, pressed && styles.formInputWrapPressed]}
      >
        <Text style={[styles.formDateValue, !value && styles.formDatePlaceholder]}>
          {value || 'Select date'}
        </Text>
        <MaterialIcons name="calendar-today" size={25} color="#111111" />
      </Pressable>

      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={draft}
          mode="date"
          display="spinner"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={onNativeChange}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal
          visible={open}
          transparent
          statusBarTranslucent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <View style={styles.datePickerOverlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setOpen(false)}
              accessibilityLabel="Cancel date selection"
            />
            <View style={styles.datePickerCard}>
              <Text style={styles.datePickerTitle}>Select date</Text>
              <DateTimePicker
                value={draft}
                mode="date"
                display="spinner"
                themeVariant="light"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={onNativeChange}
                style={styles.datePickerSpinner}
              />
              <View style={styles.datePickerActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setOpen(false)}
                  style={styles.datePickerAction}
                  hitSlop={8}
                >
                  <Text style={styles.datePickerActionText}>Cancel</Text>
                </Pressable>
                <View style={styles.datePickerActionDivider} />
                <Pressable
                  accessibilityRole="button"
                  onPress={confirm}
                  style={styles.datePickerAction}
                  hitSlop={8}
                >
                  <Text style={styles.datePickerActionText}>Confirm</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
}

function dateYearsAgo(years: number): Date {
  const today = startOfLocalDay(new Date());
  const date = new Date(today);
  date.setFullYear(today.getFullYear() - years);
  return date;
}

function formatDisplayDate(date: Date): string {
  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear(),
  ].join('/');
}

function parseDisplayDate(value: string): string | null {
  const parts = value.trim().replace(/[./-]/g, ' ').split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return null;
  const [day, month, year] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (date.getTime() > Date.now()) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function displayDateToLocalDate(value: string): Date | null {
  const isoDate = parseDisplayDate(value);
  if (!isoDate) return null;
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}


/** Artwork is packaged locally; profile/photo sync stays durable and pairing remains server-validated. */
export default function OnboardingScreen() {
  const { ensureConsentBeforeHome } = useMetaPrivacy();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [relationshipSinceInput, setRelationshipSinceInput] = useState('');
  const [pickedPhoto, setPickedPhoto] = useState<{ uri: string } | null>(null);
  const photoProcessingVersion = useRef(0);
  const selectedAvatar = DEFAULT_AVATAR_OPTIONS[0];
  const identity = useRef<Promise<string | null> | null>(null);
  const [pairingStatus, setPairingStatus] = useState<FriendsStatus>({ inviteCode: null, friends: [], pending: [], sent: [] });
  const [pairCodeOpen, setPairCodeOpen] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [pairingNow, setPairingNow] = useState(false);
  const pairingLock = useRef(false);
  const [copiedPairCode, setCopiedPairCode] = useState(false);
  const [resolvedPartner, setResolvedPartner] = useState<{ userId?: string; name: string; avatarUrl?: string; isDefaultAvatar?: boolean } | null>(null);
  const [plan, setPlan] = useState<'yearly' | 'monthly'>('yearly');
  const [purchasing, setPurchasing] = useState(false);
  const [openingPlans, setOpeningPlans] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const finishRef = useRef<(verified?: boolean) => Promise<void>>(async () => {});
  const purchaseExpected = useRef(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkCode, setLinkCode] = useState('');
  const [linkPhase, setLinkPhase] = useState<'enter' | 'verify'>('enter');
  const [linkMode, setLinkMode] = useState<PasswordlessEmailMode>('change');
  const step: Step = idx >= FLOW.length ? 'connect' : FLOW[idx];
  const { pricing, status: priceStatus, load: loadPrices, retry: retryPrices } =
    useStoreSubscriptionPricing(step === 'paywall' || step === 'plans');

  useEffect(() => {
    const offComplete = onPurchaseComplete(() => {
      if (!purchaseExpected.current) return;
      purchaseExpected.current = false;
      setPurchasing(false);
      void finishRef.current(true);
    });
    const offError = onPurchaseError((error) => {
      if (!purchaseExpected.current) return;
      purchaseExpected.current = false;
      setPurchasing(false);
      appAlert(error.code === 'pending' ? 'Payment Pending' : 'Purchase didn’t go through',
        error.message || 'You can subscribe anytime from the app.');
    });
    return () => { offComplete(); offError(); };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    void ImagePicker.getPendingResultAsync().then((pending) => {
      if (!active || !pending || 'code' in pending || pending.canceled) return;
      const uri = pending.assets[0]?.uri;
      if (uri) void processPickedPhoto(uri).catch(() => appAlert('Could not use photo', 'Choose another photo and try again.'));
    }).catch(error => console.warn('[onboarding] picker recovery failed:', error));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (step !== 'pairing') return;
    let active = true;
    // No catalog/art network dependency. Only the real, account-owned invite ID is fetched.
    void ensureOnboardingIdentity().then(async userId => {
      if (!userId) return;
      const status = await fetchFriends({ force: true });
      if (active) setPairingStatus(status);
    }).catch(error => console.warn('[onboarding] invite lookup failed:', error));
    return () => { active = false; };
  }, [step]);

  function next() { void haptics.light(); setIdx(i => Math.min(FLOW.length - 1, i + 1)); }
  function go(target: Step) {
    const targetIndex = FLOW.indexOf(target);
    if (targetIndex >= 0) { void haptics.light(); setIdx(targetIndex); }
  }
  function ensureOnboardingIdentity(): Promise<string | null> {
    if (identity.current) return identity.current;
    beginAnonymousOnboardingAuthHandoff();
    const request = (async () => {
      try {
        const ok = await ensureSession();
        const { data } = await supabase.auth.getSession();
        return ok ? data.session?.user?.id ?? null : null;
      } finally { setTimeout(endAnonymousOnboardingAuthHandoff, 2_000); }
    })();
    identity.current = request;
    void request.then(userId => { if (!userId) identity.current = null; })
      .catch(() => { identity.current = null; });
    return request;
  }
  function startPendingProfileSync() {
    void ensureOnboardingIdentity().then(userId => {
      if (userId) void syncOnboardingProfile(userId, { force: true });
    }).catch(error => console.warn('[onboarding] profile sync queued for retry:', error));
  }
  function saveSelfInfo() {
    const trimmedName = firstName.trim().slice(0, 15);
    const nickname = partnerName.trim().slice(0, 30);
    const relationshipSince = parseDisplayDate(relationshipSinceInput);
    if (!trimmedName || !nickname || !relationshipSince) return;
    Keyboard.dismiss();
    setFirstName(trimmedName); setPartnerName(nickname); setBunnyName(trimmedName);
    queueOnboardingProfile({ displayName: trimmedName, partnerName: nickname,
      partnerNickname: nickname, relationshipSince });
    next();
    startPendingProfileSync();
  }
  function saveProfilePhoto() {
    if (!pickedPhoto) {
      queueOnboardingProfile({ displayName: firstName, defaultAvatarId: selectedAvatar.id });
      startPendingProfileSync();
    }
    next();
  }
  async function processPickedPhoto(uri: string) {
    const version = ++photoProcessingVersion.current;
    // Paint the user's crop immediately; compression and upload continue in
    // the background and never hold the Next button.
    setPickedPhoto({ uri });
    void haptics.success();
    const processed = await manipulateAsync(
      uri,
      [{ resize: { width: 512, height: 512 } }],
      { compress: 0.72, format: SaveFormat.JPEG },
    );
    if (version !== photoProcessingVersion.current) return;
    const durableUri = await queueProfileAvatar(processed.uri);
    if (version !== photoProcessingVersion.current) return;
    setPickedPhoto({ uri: durableUri });
    const userId = await ensureOnboardingIdentity();
    if (userId) void syncProfileAvatar(userId, { force: true });
  }

  async function chooseProfilePhoto() {
    try {
      // The system image-only picker handles access itself on both iOS and
      // Android. An eager permission request is unnecessary and could crash an
      // older native build that did not yet contain expo-image-picker.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
        base64: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) throw new Error('The picker returned no image');
      await processPickedPhoto(asset.uri);
    } catch (error) {
      console.warn('[onboarding] photo selection failed:', error);
      appAlert('Could not use photo', 'Choose another photo and try again.');
    }
  }


  async function connectDuringOnboarding() {
    const normalized = pairCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (normalized.length !== 6 || pairingLock.current) return;
    Keyboard.dismiss();
    pairingLock.current = true; setPairingNow(true);
    try {
      if (!await ensureOnboardingIdentity()) throw new Error('Could not prepare your account.');
      const result = await addFriend(normalized, {
        relationship: 'Partner', relationshipSince: parseDisplayDate(relationshipSinceInput) || undefined,
      });
      if (!result.ok) { appAlert('Wrong code', 'Double-check your partner’s Burrow code and try again.'); return; }
      setResolvedPartner({ userId: result.partner?.userId,
        name: result.partner?.displayName || result.pairedName || partnerName || 'Partner',
        avatarUrl: result.partner?.avatarUrl, isDefaultAvatar: result.partner?.isDefaultAvatar });
      setPairCodeOpen(false); void haptics.success();
      // addFriend atomically pairs both accounts. No second approval/polling screen.
      go('pairing-success');
    } catch (error) {
      appAlert('Could not connect', error instanceof Error ? error.message : 'Check your connection and try again.');
    } finally { pairingLock.current = false; setPairingNow(false); }
  }
  async function copyCode() {
    if (!pairingStatus.inviteCode) return;
    await Clipboard.setStringAsync(pairingStatus.inviteCode);
    setCopiedPairCode(true); void haptics.success();
    setTimeout(() => setCopiedPairCode(false), 2_000);
  }
  async function shareCode() {
    if (!pairingStatus.inviteCode) return;
    try {
      // Keep this a named static import: Metro's dynamic namespace import
      // evaluates unrelated RN getters, including unsupported PushNotificationIOS.
      await Share.share({ message: `Join my Burrow. Enter my code ${pairingStatus.inviteCode} and we’ll be connected right away.` });
    } catch (error) {
      console.warn('[onboarding] invite sharing failed:', error);
      appAlert('Could not share invite', 'Please try again, or copy your Burrow code and send it to your partner.');
    }
  }
  async function onTryFree() {
    if (openingPlans) return;
    setOpeningPlans(true);
    try {
      const loaded = pricing ?? await loadPrices();
      if (!loaded) {
        appAlert('Prices unavailable', 'We couldn’t load store prices. Check your connection and try again.');
        return;
      }
      go('plans');
    } finally { setOpeningPlans(false); }
  }
  async function onStartPlan() {
    if (purchasing || restoring) return;
    if (!pricing) { void retryPrices(); return; }
    setPurchasing(true); purchaseExpected.current = true;
    try {
      const [userId] = await Promise.all([ensureOnboardingIdentity(), initIAP()]);
      if (!userId) throw new Error('We couldn’t prepare your account for purchase.');
      const outcome = await purchaseSubscription(plan === 'yearly' ? 'novame.plus.yearly' : 'novame.plus.monthly');
      if (outcome.kind === 'cancelled' || outcome.kind === 'scheduled') {
        purchaseExpected.current = false; setPurchasing(false);
        if (outcome.kind === 'scheduled') void finishRef.current();
      }
      // Only onPurchaseComplete, after server verification, grants purchased flow.
    } catch (error) {
      purchaseExpected.current = false; setPurchasing(false);
      appAlert('Purchase didn’t go through', error instanceof Error ? error.message : 'Try again later.');
    }
  }
  async function restore() {
    if (restoring || purchasing) return;
    setRestoring(true);
    try {
      if (!await ensureOnboardingIdentity()) throw new Error('Could not prepare your account.');
      const result = await restoreSubscriptions();
      if (result.restored) await finishRef.current(true);
      else appAlert(result.pending ? 'Payment Pending' : 'Restore purchases',
        result.ownershipConflict ? 'This purchase belongs to another Burrow account. Sign in to that account to restore it.'
          : result.error || 'No active purchases were found for this store account.');
    } catch (error) { appAlert('Could not restore', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setRestoring(false); }
  }
  function finishPurchasedOnboarding() {
    const promptNotification = shouldPromptNotifAfterPurchase();
    if (promptNotification) { markNotifPromptedAfterPurchase(); deferHomeEntryNotification(); }
    router.replace({ pathname: '/(auth)/signing-in',
      params: promptNotification ? { after: 'notification-settings' } : {} } as never);
  }
  function confirmSkipPurchasedAccountConnection() {
    appAlert('Keep your account safe',
      'Connecting an account keeps your memories recoverable if you change phones or reinstall Burrow.',
      [{ text: 'Close Anyway', style: 'cancel', onPress: finishPurchasedOnboarding }, { text: 'Keep Connecting' }]);
  }
  async function finish(verifiedPurchase = false) {
    if (finishingRef.current || !verifiedPurchase && (purchasing || restoring)) return;
    finishingRef.current = true; setFinishing(true); void haptics.medium();
    try {
      await ensureConsentBeforeHome();
      setChosenCompanion('pet1'); setBunnyName(firstName.trim());
      beginHomeEntry(); logOnboardingCompleted(); markIntroSeen();
      beginAnonymousOnboardingAuthHandoff();
      const ok = await ensureSession();
      if (!ok) {
        finishingRef.current = false; endAnonymousOnboardingAuthHandoff();
        router.replace('/(auth)/sign-in'); return;
      }
      enableFeatureGuidesForNewUser();
      void supabase.auth.getSession().then(({ data }) => {
        const uid = data.session?.user?.id;
        if (!uid) return;
        void syncOnboardingCompanion(uid, { force: true });
        if (firstName.trim()) void updateDisplayName(uid, firstName.trim().slice(0, 15)).catch(() => {});
      });
      if (verifiedPurchase) {
        endAnonymousOnboardingAuthHandoff(); setIdx(FLOW.length);
      } else {
        router.replace('/(auth)/signing-in');
        setTimeout(endAnonymousOnboardingAuthHandoff, 2_000);
      }
    } catch (error) {
      finishingRef.current = false; endAnonymousOnboardingAuthHandoff();
      appAlert('Could not continue', error instanceof Error ? error.message : 'Please try again.');
    } finally { setFinishing(false); }
  }
  finishRef.current = finish;
  async function onLinkProvider(provider: 'apple' | 'google') {
    if (linking) return;
    void haptics.pageOpen();
    setLinking(true);
    const res = await connectProviderOrSignIn(provider);
    setLinking(false);
    if (res.ok) {
      if (res.mode === 'linked') {
        void supabase.auth.getSession().then(({ data }) => {
          logRegistration(data.session?.user?.id);
        });
      }
      appAlert(
        res.mode === 'linked' ? 'Account connected' : 'Welcome back!',
        res.mode === 'linked'
          ? 'Your memories are now safe on this account.'
          : 'Your account and memories have been restored.',
        [{ text: 'OK', onPress: () => { void haptics.pageOpen(); finishPurchasedOnboarding(); } }],
      );
    } else if (!res.cancelled) {
      appAlert(
        'Could not connect',
        res.error ?? 'You can connect your account anytime from settings.',
      );
    }
  }

  async function onLinkEmail() {
    const email = linkEmail.trim();
    if (!email.includes('@') || linking) return;
    Keyboard.dismiss();
    setLinking(true);
    const result = await sendPasswordlessEmailOtp(email);
    setLinking(false);
    if (!result.ok || !result.mode) {
      appAlert('Could not connect', result.error ?? 'You can connect your account anytime from settings.');
      return;
    }
    setLinkMode(result.mode);
    setLinkPhase('verify');
  }

  async function onVerifyLinkCode() {
    const token = linkCode.trim();
    if (token.length !== 6 || linking) return;
    Keyboard.dismiss();
    setLinking(true);
    const res = await verifyPasswordlessEmailOtp(linkEmail.trim(), token, linkMode);
    setLinking(false);
    if (!res.ok) {
      appAlert('Wrong code', res.error ?? 'Double-check the 6-digit code and try again.');
      return;
    }
    if (linkMode === 'change') {
      void supabase.auth.getSession().then(({ data }) => {
        logRegistration(data.session?.user?.id);
      });
    }
    appAlert(
      linkMode === 'change' ? 'Account connected' : 'Welcome back!',
      linkMode === 'change'
        ? 'Your memories are now safe.'
        : 'Your account and memories have been restored.',
      [{ text: 'OK', onPress: () => { void haptics.pageOpen(); finishPurchasedOnboarding(); } }],
    );
  }


  const connectAccount = <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView removeClippedSubviews={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.account, { paddingTop: insets.top + 70, paddingBottom: insets.bottom + 24 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Skip account connection" onPress={confirmSkipPurchasedAccountConnection} style={styles.accountClose}><MaterialIcons name="close" size={28} color={ONBOARDING_INK}/></Pressable>
      <Text style={styles.accountTitle}>Connect Your Account</Text>
      <Text style={styles.accountBody}>Keep your memories safe when you change phones or reinstall Burrow.</Text>
      {Platform.OS === 'ios' && <OnboardingButton label="Sign in with Apple" onPress={() => void onLinkProvider('apple')} busy={linking}/>}
      <View style={{ height: 14 }}/><OnboardingButton label="Continue with Google" onPress={() => void onLinkProvider('google')} busy={linking}/>
      <TextInput accessibilityLabel={linkPhase === 'enter' ? 'Email address' : 'Email verification code'} style={styles.accountInput}
        value={linkPhase === 'enter' ? linkEmail : linkCode} placeholder={linkPhase === 'enter' ? 'you@example.com' : '6-digit code'}
        onChangeText={linkPhase === 'enter' ? setLinkEmail : value => setLinkCode(value.replace(/[^0-9]/g, '').slice(0, 6))}
        keyboardType={linkPhase === 'enter' ? 'email-address' : 'number-pad'} autoCapitalize="none" returnKeyType="done"
        onSubmitEditing={() => void (linkPhase === 'enter' ? onLinkEmail() : onVerifyLinkCode())}/>
      {linkPhase === 'verify' && <Text style={styles.accountBody}>We sent a code to {linkEmail.trim()}.</Text>}
      <OnboardingButton label={linkPhase === 'enter' ? 'Connect with Email' : 'Verify & Continue'}
        onPress={() => void (linkPhase === 'enter' ? onLinkEmail() : onVerifyLinkCode())} busy={linking}
        disabled={linkPhase === 'enter' ? !linkEmail.includes('@') : linkCode.length !== 6}/>
    </ScrollView>
  </KeyboardAvoidingView>;

  return <BurrowOnboardingPages step={step} next={next} go={go}
    firstName={firstName} setFirstName={setFirstName} partnerName={partnerName} setPartnerName={setPartnerName}
    dateInput={<OnboardingDateInput value={relationshipSinceInput} onChange={setRelationshipSinceInput} defaultYearsAgo={0} accessibilityLabel="When did you two fall in love?"/>}
    validInfo={Boolean(firstName.trim() && partnerName.trim() && parseDisplayDate(relationshipSinceInput))} saveInfo={saveSelfInfo}
    photoUri={pickedPhoto?.uri} defaultAvatar={selectedAvatar.source} choosePhoto={() => void chooseProfilePhoto()} savePhoto={saveProfilePhoto}
    inviteCode={pairingStatus.inviteCode} copied={copiedPairCode} copyCode={() => void copyCode()} shareCode={() => void shareCode()}
    pairCodeOpen={pairCodeOpen} openCode={() => setPairCodeOpen(true)} closeCode={() => { Keyboard.dismiss(); setPairCodeOpen(false); }}
    pairCode={pairCode} setPairCode={value => setPairCode(value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6))}
    pairing={pairingNow} pair={() => void connectDuringOnboarding()} partner={resolvedPartner}
    finish={() => void finish()} finishing={finishing || purchasing || restoring}
    pricing={pricing} priceError={priceStatus === 'error'} retryPrices={() => void retryPrices()}
    tryFree={() => void onTryFree()} openingPlans={openingPlans} plan={plan} setPlan={setPlan}
    purchase={() => void onStartPlan()} purchasing={purchasing} restore={() => void restore()} restoring={restoring}
    connectAccount={connectAccount}/>;
}

const styles = StyleSheet.create({
  formInputWrap: { minHeight: 50, borderRadius: 9, borderWidth: 1, borderColor: '#111', backgroundColor: '#FFF', paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  formInputWrapPressed: { opacity: .78 },
  formDateValue: { flex: 1, fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#161311' },
  formDatePlaceholder: { color: '#777' },
  datePickerOverlay: { flex: 1, justifyContent: 'center', paddingHorizontal: 18, backgroundColor: 'rgba(45,31,22,.42)' },
  datePickerCard: { width: '100%', maxWidth: 430, alignSelf: 'center', borderRadius: 28, backgroundColor: '#FFF', padding: 22 },
  datePickerTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', color: '#161311' },
  datePickerSpinner: { alignSelf: 'stretch', height: 218, marginTop: 4 },
  datePickerActions: { minHeight: 54, flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  datePickerAction: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  datePickerActionDivider: { width: 1, height: 24, backgroundColor: '#E5E0DA' },
  datePickerActionText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#161311' },
  account: { flexGrow: 1, paddingHorizontal: 25, backgroundColor: ONBOARDING_CREAM, gap: 12 },
  accountTitle: { fontSize: 30, fontFamily: 'Inter_800ExtraBold', textAlign: 'center', color: ONBOARDING_INK },
  accountBody: { fontSize: 17, textAlign: 'center', color: ONBOARDING_INK, marginBottom: 20 },
  accountInput: { borderRadius: 12, borderWidth: 1, borderColor: '#A18369', padding: 18, fontSize: 17, marginVertical: 12 },
  accountClose: { position: 'absolute', right: 24, top: 24 },
});

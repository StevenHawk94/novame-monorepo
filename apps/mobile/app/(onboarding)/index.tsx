import { userErrorMessage } from '@/lib/user-error-message';
import {queueBunnySelection,syncBunnyIdentity,bunnyVariant,type BunnyVariant} from '@/lib/bunny-identity';
import { BurrowLaunchScreen } from '@/components/main/burrow-launch-screen';
import { ConnectAccountView } from '@/components/auth/connect-account-view';
import { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, Platform, Share, StyleSheet, Text, TextInput } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { appAlert } from '@/components/ui/app-dialog';
import { BurrowOnboardingPages, OnboardingButton } from '@/components/onboarding/burrow-onboarding-pages';
import { OnboardingDateWheel } from '@/components/onboarding/onboarding-date-wheel';
import { formatRelationshipDate, localRelationshipDate, parseRelationshipDate as parseDisplayDate } from '@/lib/onboarding-relationship-date';
import { ONBOARDING_FLOW as FLOW, ONBOARDING_INK, type OnboardingStep as Step } from '@/lib/burrow-onboarding-design';
import { haptics } from '../../src/lib/haptics';
import { beginHomeEntry, homeEntryRemainingMs } from '../../src/lib/home-entry-readiness';
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
import { addFriend, fetchFriends, getCachedFriends, type FriendsStatus } from '../../src/lib/friends-api';
import { withDeadline } from '../../src/lib/async-lifecycle';
import { initIAP, onPurchaseComplete, onPurchaseError, purchaseSubscription, restoreSubscriptions } from '../../src/lib/iap';
import { useStoreSubscriptionPricing } from '../../src/hooks/use-store-subscription-pricing';
import { prepareHomeArt } from '@/lib/home-art-preparation';
import { burrowClock, getBurrowSnapshot, refreshBurrow, refreshBurrowAfterCurrent } from '@/lib/burrow-store';
import { afterUiSettles } from '@/lib/ui-idle';
/** Artwork is packaged locally; profile/photo sync stays durable and pairing remains server-validated. */
export default function OnboardingScreen() {
  const { ensureConsentBeforeHome } = useMetaPrivacy();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [bunny,setBunny]=useState<BunnyVariant>(()=>bunnyVariant());
  const [firstName, setFirstName] = useState('');
  const [relationshipSinceInput, setRelationshipSinceInput] = useState(() => formatRelationshipDate(localRelationshipDate()));
  const [pickedPhoto, setPickedPhoto] = useState<{ uri: string } | null>(null);
  const photoProcessingVersion = useRef(0);
  const [avatarUserId,setAvatarUserId]=useState<string|null>(null);
  const identity = useRef<Promise<string | null> | null>(null);
  const invitePreparation = useRef<Promise<FriendsStatus> | null>(null);
  const onboardingMounted = useRef(true);
  const openingPairingLock = useRef(false);
  const [openingPairing, setOpeningPairing] = useState(false);
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
  const purchasedConnectShown=useRef(false);
  const restoredExistingAccount=useRef(false);
  const purchaseExpected = useRef(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkCode, setLinkCode] = useState('');
  const [linkPhase, setLinkPhase] = useState<'enter' | 'verify'>('enter');
  const [linkMode, setLinkMode] = useState<PasswordlessEmailMode>('change');
  const step: Step = idx >= FLOW.length ? 'connect' : FLOW[idx];
  useEffect(()=>{
    if(step==='choose-bunny')void ensureOnboardingIdentity().then(()=>syncBunnyIdentity()).catch(()=>{});
  },[step]);
  useEffect(()=>afterUiSettles(()=>{
    // Starter visuals need no identity/network. Do not issue completion writes
    // early; only read the room after the profile/pairing checkpoints.
    void prepareHomeArt(getBurrowSnapshot().data).catch(()=>{});
    if(['paywall','plans','connect'].includes(step))void ensureOnboardingIdentity().then(async userId=>{
      if(!userId||!onboardingMounted.current)return;
      await refreshBurrow({silent:true});
      if(onboardingMounted.current)await prepareHomeArt(getBurrowSnapshot().data);
    }).catch(()=>{});
  },{delayMs:250}),[step]);
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
        userErrorMessage(error, 'You can subscribe anytime from the app.'));
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
    onboardingMounted.current = true;
    return () => { onboardingMounted.current = false; };
  }, []);

  useEffect(() => {
    // Allocate the stable server-owned ID during the welcome/features, not
    // after opening Invite. Retry at natural checkpoints if the phone was offline.
    if (!['start', 'self-info', 'profile-photo'].includes(step)) return;
    void prepareInvite().catch(error => console.warn('[onboarding] invite preparation will retry:', error));
  }, [step]);

  useEffect(() => {
    if (step !== 'pairing') return;
    let active = true, checking = false, generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const foreground = () => AppState.currentState === 'active';
    // The inviter also reaches Connected when their partner enters the code.
    // No polling survives Skip, a hidden app, or an unmounted onboarding flow.
    async function checkPartner() {
      if (!active || checking || !foreground()) return;
      checking = true;
      const requestGeneration = generation;
      try {
        const userId = await ensureOnboardingIdentity();
        if (!userId || !active || requestGeneration !== generation) return;
        const status = await withDeadline(fetchFriends({ force: true }), 12_000);
        const { data } = await supabase.auth.getSession();
        if (!active || requestGeneration !== generation || !foreground() || data.session?.user?.id !== userId || pairingLock.current) return;
        const partner = status.friends[0];
        if (!partner) return;
        setResolvedPartner({ userId: partner.userId, name: partner.displayName || 'Partner', avatarUrl: partner.avatarUrl, isDefaultAvatar: partner.isDefaultAvatar });
        Keyboard.dismiss(); setPairCodeOpen(false); void haptics.success(); go('pairing-success');
      } catch {
        // Offline invitations remain shareable; only Pair Now shows errors.
      } finally {
        checking = false;
        if (active && foreground()) timer = setTimeout(() => void checkPartner(), 5_000);
      }
    }
    const subscription = AppState.addEventListener('change', () => {
      generation++; clearTimeout(timer);
      if (foreground()) void checkPartner();
    });
    void checkPartner();
    return () => { active = false; generation++; clearTimeout(timer); subscription.remove(); };
  }, [step]);

  function prepareInvite(): Promise<FriendsStatus> {
    if (invitePreparation.current) return invitePreparation.current;
    const request = withDeadline((async () => {
      const userId = await ensureOnboardingIdentity();
      if (!userId) throw new Error('Could not prepare your account.');
      const cached = getCachedFriends();
      // Codes are stable, so a cached code needs no force-refresh on entry.
      const status = cached.inviteCode ? cached : await fetchFriends();
      const { data } = await supabase.auth.getSession();
      if (data.session?.user?.id !== userId) throw new Error('Account changed.');
      if (!status.inviteCode) throw new Error('Could not prepare your invite code.');
      return status;
    })(), 12_000).then(status => {
      if (onboardingMounted.current) setPairingStatus(status);
      return status;
    });
    invitePreparation.current = request;
    void request.catch(() => { if (invitePreparation.current === request) invitePreparation.current = null; });
    return request;
  }

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
    void request.then(userId => { if (!userId) identity.current = null; else if(onboardingMounted.current)setAvatarUserId(userId); })
      .catch(() => { identity.current = null; });
    return request;
  }
  function startPendingProfileSync() {
    void ensureOnboardingIdentity().then(userId => {
      if (userId) void syncOnboardingProfile(userId, { force: true });
    }).catch(error => console.warn('[onboarding] profile sync queued for retry:', error));
  }
  function saveSelfInfo() {
    const trimmedName = firstName.trim().slice(0, 20);
    if (!trimmedName) return;
    Keyboard.dismiss();
    setFirstName(trimmedName); setBunnyName(trimmedName);
    queueOnboardingProfile({ displayName: trimmedName });
    go('profile-photo');
    startPendingProfileSync();
  }
  function saveProfilePhoto() {
    if (!pickedPhoto) {
      queueOnboardingProfile({ displayName: firstName });
      startPendingProfileSync();
    }
    go('relationship-date');
  }
  function saveRelationshipDate(){
    const relationshipSince=parseDisplayDate(relationshipSinceInput);if(!relationshipSince)return;
    queueOnboardingProfile({relationshipSince});startPendingProfileSync();go('choose-bunny');
  }
  async function continueBunny() {
    if (openingPairingLock.current) return;
    const relationshipSince = parseDisplayDate(relationshipSinceInput);
    if (!relationshipSince) return;
    openingPairingLock.current = true;
    setOpeningPairing(true);
    queueOnboardingProfile({ relationshipSince });
    startPendingProfileSync();
    try {
      if(!await ensureOnboardingIdentity())throw Error('session_changed');
      queueBunnySelection(bunny);
      void syncBunnyIdentity().catch(()=>{});
      await prepareInvite();
      // Never reveal an empty code card; the previous page stays usable-looking
      // with explicit preparation feedback in the exceptional slow-network case.
      if (onboardingMounted.current) go('pairing');
    } catch {
      if (onboardingMounted.current) appAlert('Could not prepare invite',
        'Check your connection and try again. You can also invite your partner later.', [
          { text: 'Try again', onPress: () => { void continueBunny(); } },
          { text: 'Invite later', onPress: () => go('paywall') },
        ]);
    } finally {
      openingPairingLock.current = false;
      if (onboardingMounted.current) setOpeningPairing(false);
    }
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
      await syncBunnyIdentity();
      const result = await addFriend(normalized, {
        relationship: 'Partner', relationshipSince: parseDisplayDate(relationshipSinceInput) || undefined,
      });
      if (!result.ok) { appAlert('Wrong code', 'Double-check your partner’s Burrow code and try again.'); return; }
      setResolvedPartner({ userId: result.partner?.userId,
        name: result.partner?.displayName || result.pairedName || 'Partner',
        avatarUrl: result.partner?.avatarUrl, isDefaultAvatar: result.partner?.isDefaultAvatar });
      setPairCodeOpen(false); void haptics.success();
      // addFriend atomically pairs both accounts. No second approval/polling screen.
      go('pairing-success');
    } catch (error) {
      appAlert('Could not connect', userErrorMessage(error, 'Check your connection and try again.'));
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
      appAlert('Purchase didn’t go through', userErrorMessage(error, 'Try again later.'));
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
    } catch (error) { appAlert('Could not restore', userErrorMessage(error, 'Please try again.')); }
    finally { setRestoring(false); }
  }
  function finishPurchasedOnboarding() {
    void finishRef.current();
  }
  function confirmSkipPurchasedAccountConnection() {
    appAlert('Keep your account safe',
      'Connecting an account keeps your memories recoverable if you change phones or reinstall Burrow.',
      [{ text: 'Close Anyway', style: 'cancel', onPress: finishPurchasedOnboarding }, { text: 'Keep Connecting' }]);
  }
  async function finish(verifiedPurchase = false) {
    // Store verification owns the entitlement. Optional account connection is
    // the immediate next page; completion/Home work belongs AFTER it closes.
    if(verifiedPurchase){
      if(finishingRef.current||purchasedConnectShown.current)return;
      purchasedConnectShown.current=true;setIdx(FLOW.length);return;
    }
    if (finishingRef.current || purchasing || restoring) return;
    finishingRef.current = true; setFinishing(true); void haptics.medium();
    let leaving=false;
    try {
      await ensureConsentBeforeHome();
      beginHomeEntry();
      if(restoredExistingAccount.current){
        // Signing into an existing account must never apply the guest's name,
        // companion or relationship setup to that recovered account.
        logOnboardingCompleted();markIntroSeen();
        leaving=true;router.replace('/(auth)/signing-in');return;
      }
      setChosenCompanion('pet1'); setBunnyName(firstName.trim());
      beginAnonymousOnboardingAuthHandoff();
      const ok = await withDeadline(ensureSession(), homeEntryRemainingMs()).catch(()=>null);
      if(!onboardingMounted.current)return;
      if (ok === false) {
        finishingRef.current = false; endAnonymousOnboardingAuthHandoff();
        leaving=true;router.replace('/(auth)/sign-in'); return;
      }
      // Reliable local setup stays queued. Network failure/timeout releases
      // Splash; it does not discard setup or imply a failed store purchase.
      if(ok)await withDeadline((async()=>{
        const {data:{session}}=await supabase.auth.getSession();
        const uid=session?.user?.id;if(!uid)throw Error('Could not prepare your account.');
        const [companion,profile]=await Promise.all([
          syncOnboardingCompanion(uid,{force:true}),syncOnboardingProfile(uid,{force:true}),
          firstName.trim()?updateDisplayName(uid,firstName.trim().slice(0,15)):null,
        ]);
        if(!companion||!profile)throw Error('Could not sync your setup. Please try again.');
        await syncBunnyIdentity(true);
        await refreshBurrowAfterCurrent({silent:true,after:burrowClock()});
        const snapshot=getBurrowSnapshot();
        if(snapshot.syncError||!snapshot.data||snapshot.data.profile.id!==uid)throw Error('Could not prepare your room. Please try again.');
        await prepareHomeArt(snapshot.data);
      })(),homeEntryRemainingMs()).catch(()=>{
        console.warn('[onboarding] setup still pending; continuing with local Home');
      });
      if(!onboardingMounted.current)return;
      logOnboardingCompleted();markIntroSeen();
      leaving=true;
      router.replace('/(auth)/signing-in');
      setTimeout(endAnonymousOnboardingAuthHandoff, 2_000);
    } catch (error) {
      finishingRef.current = false; endAnonymousOnboardingAuthHandoff();
      appAlert('Could not continue', userErrorMessage(error, 'Please try again.'));
    } finally { if(!leaving)setFinishing(false); }
  }
  finishRef.current = finish;
  async function onLinkProvider(provider: 'apple' | 'google') {
    if (linking) return;
    void haptics.pageOpen();
    setLinking(true);
    const res = await connectProviderOrSignIn(provider);
    setLinking(false);
    if (res.ok) {
      if(res.mode!=='linked'){
        restoredExistingAccount.current=true;
        // The global auth listener may already be routing this new identity.
        // Arm first-Home announcements before that route completes.
        markIntroSeen();
      }
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
    if(linkMode!=='change'){restoredExistingAccount.current=true;markIntroSeen();}
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


  const connectAccount = <ConnectAccountView onClose={confirmSkipPurchasedAccountConnection} busy={linking}
    onProvider={provider => { void onLinkProvider(provider); }}>
    <TextInput accessibilityLabel={linkPhase === 'enter' ? 'Email address' : 'Email verification code'} style={styles.accountInput}
      value={linkPhase === 'enter' ? linkEmail : linkCode} placeholder={linkPhase === 'enter' ? 'you@example.com' : '6-digit code'}
      onChangeText={linkPhase === 'enter' ? setLinkEmail : value => setLinkCode(value.replace(/[^0-9]/g, '').slice(0, 6))}
      keyboardType={linkPhase === 'enter' ? 'email-address' : 'number-pad'} autoCapitalize="none" returnKeyType="done"
      onSubmitEditing={() => void (linkPhase === 'enter' ? onLinkEmail() : onVerifyLinkCode())}/>
    {linkPhase === 'verify' && <Text style={styles.accountBody}>We sent a code to {linkEmail.trim()}.</Text>}
    <OnboardingButton label={linkPhase === 'enter' ? 'Connect with Email' : 'Verify & Continue'}
      onPress={() => void (linkPhase === 'enter' ? onLinkEmail() : onVerifyLinkCode())} busy={linking}
      disabled={linkPhase === 'enter' ? !linkEmail.includes('@') : linkCode.length !== 6}/>
  </ConnectAccountView>;

  if(finishing)return <BurrowLaunchScreen />;
  return <BurrowOnboardingPages step={step} next={next} go={go}
    bunny={bunny} setBunny={setBunny} continueBunny={()=>void continueBunny()}
    firstName={firstName} setFirstName={setFirstName}
    dateInput={<OnboardingDateWheel value={relationshipSinceInput} onChange={setRelationshipSinceInput}/>}
    validInfo={Boolean(firstName.trim())} saveInfo={saveSelfInfo}
    saveDate={() => void saveRelationshipDate()} validDate={Boolean(parseDisplayDate(relationshipSinceInput))}
    photoUri={pickedPhoto?.uri} selfUserId={avatarUserId} choosePhoto={() => void chooseProfilePhoto()} savePhoto={saveProfilePhoto} openingPairing={openingPairing}
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
  accountBody: { fontSize: 17, textAlign: 'center', color: ONBOARDING_INK, marginBottom: 20 },
  accountInput: { borderRadius: 12, borderWidth: 1, borderColor: '#A18369', padding: 18, fontSize: 17, marginVertical: 12 },
});

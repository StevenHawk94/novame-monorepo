import { BackIcon } from '@/components/burrow/burrow-back-button';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Linking, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pressable, Switch } from '@/components/ui/feedback-pressable';
import { ScreenOverlay as Modal } from '@/components/ui/screen-overlay';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import * as StoreReview from 'expo-store-review';
import Constants from 'expo-constants';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import { PRICING_TIERS } from '@novame/core';
import {ProfileAvatarEditor} from '@/components/me/profile-avatar-editor';
import {openOfficialRedeemCode} from '@/lib/redeem-offer';
import { NotificationTimePicker } from '@/components/notifications/notification-time-picker';
import { appAlert } from '@/components/ui/app-dialog';
import { GridBackground } from '@/components/ui/grid-background';
import { haptics } from '@/lib/haptics';
import {
  checkNotificationPermission,
  getNotificationSettings,
  requestNotificationPermission,
} from '@/lib/notification-settings';
import {
  fetchSubscriptionTier,
} from '@/lib/subscription';
import { useSubscriptionTier } from '@/lib/use-subscription-tier';
import { fetchDuoStatus, type DuoStatus } from '@/lib/duo-api';
import {
  fetchFriends,
  fetchPairing,
  getCachedPairing,
  subscribePairingStatus,
  unsetPairing,
  type PairingStatus,
} from '@/lib/friends-api';
import { fetchMeStats, getCachedMeStats } from '@/lib/me-stats';
import { getBunnyName } from '@/lib/onboarding';
import {UserAvatar} from '@/components/ui/user-avatar';
import { supabase } from '@/lib/supabase';
import { useMetaPrivacy } from '@/components/privacy/meta-privacy-provider';
import { showPartnerPairing } from '@/lib/partner-pairing';
import { invalidateBurrowPair, refreshBurrowAfterCurrent, useBurrowSnapshot } from '@/lib/burrow-store';
import { sessionEpoch, sessionUserId } from '@/lib/session-lifecycle';
import { getInteractionPreferences, setInteractionPreference, subscribeInteractionPreferences } from '@/lib/interaction-preferences';

const PRIVACY_URL = 'https://www.burrow-app.com/privacy';
const TERMS_URL = 'https://www.burrow-app.com/terms';

/** Warm-paper settings menu; shared pairing and coin routes retain this page underneath. */
export default function MeScreen() {
  const interaction = useSyncExternalStore(subscribeInteractionPreferences, getInteractionPreferences, getInteractionPreferences);
  const insets = useSafeAreaInsets();
  const { data: burrowData, pairInvalidated } = useBurrowSnapshot();
  const [avatarEditor,setAvatarEditor]=useState(false);
  const tier = useSubscriptionTier();
  const [userId, setUserId] = useState<string | null>(()=>sessionUserId()??null);
  const [displayName, setDisplayName] = useState(()=>getCachedMeStats()?.displayName||burrowData?.profile.display_name||getBunnyName()||'');
  const [avatarUrl, setAvatarUrl] = useState(()=>getCachedMeStats()?.avatarUrl??burrowData?.profile.avatar_url??'');
  const [isDefaultAvatar, setIsDefaultAvatar] = useState<boolean | undefined>(()=>getCachedMeStats()?.isDefaultAvatar??burrowData?.profile.is_default_avatar??undefined);
  const [duo, setDuo] = useState<DuoStatus>({ asOwner: null, asMember: null });
  const [pairing, setPairing] = useState<PairingStatus | null>(() => getCachedPairing());
  const [pairedModalStep, setPairedModalStep] = useState<'closed' | 'profile' | 'confirm'>('closed');
  const [pairedModalPartnerId, setPairedModalPartnerId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [unpairing, setUnpairing] = useState(false);
  const [unpairError, setUnpairError] = useState('');
  const unpairLock = useRef(false);
  const mounted = useRef(true);
  const menuScope = `${burrowData?.profile.id??sessionUserId()??''}:${burrowData?.partner?.id??''}:${burrowData?.pairVersion??''}`;
  const menuScopeRef = useRef(menuScope);menuScopeRef.current=menuScope;
  // Bootstrap is updated before the connection-success screen appears. Do not
  // briefly show the old unpaired label while the detailed date fetch completes.
  const menuPairing: PairingStatus | null = pairInvalidated ? { paired: false, partner: null } : burrowData ? {
    ...(pairing?.partner?.userId === burrowData.partner?.id ? pairing : {}),
    paired: !!burrowData.partner,
    partner: burrowData.partner ? {
      userId: burrowData.partner.id,
      displayName: burrowData.partner.display_name || 'Your partner',
      avatarUrl: burrowData.partner.avatar_url || '',
      isDefaultAvatar: burrowData.partner.is_default_avatar ?? undefined,
    } : null,
  } : pairing;
  const [notificationPermissionBusy, setNotificationPermissionBusy] = useState(false);
  const [notificationPickerOpen, setNotificationPickerOpen] = useState(false);
  const [notificationPickerSeed, setNotificationPickerSeed] = useState(
    () => getNotificationSettings(),
  );
  const metaPrivacy = useMetaPrivacy();
  useEffect(() => subscribePairingStatus(setPairing), []);

  useEffect(() => {
    // A remotely ended/changed pairing must not leave an empty modal or an
    // old confirmation that could accidentally target the new partner.
    if (pairedModalStep !== 'closed' && menuPairing?.partner?.userId !== pairedModalPartnerId && !unpairing) {
      Keyboard.dismiss();
      setPairedModalStep('closed');
      setConfirmText('');
      setUnpairError('');
    }
  }, [menuPairing?.partner?.userId, pairedModalPartnerId, pairedModalStep, unpairing]);

  // Name + avatar come from me-stats (profiles), the same source Account
  // Management edits — so a save there shows here on the next focus.
  // display_name is auto-seeded at signup ('user' for guests, email prefix
  // otherwise); a literal 'user' is placeholder noise, so the onboarding
  // name the user typed outranks it.
  const refreshProfile = useCallback(() => {
    const cached = getCachedMeStats();
    // Invalidating an in-flight cache must not blank an already-ready header.
    if(!cached)return;
    const profileName =
      cached?.displayName && cached.displayName !== 'user' ? cached.displayName : '';
    setDisplayName(profileName || getBunnyName() || '');
    setAvatarUrl(cached?.avatarUrl ?? '');
    setIsDefaultAvatar(cached?.isDefaultAvatar);
  }, []);

  useEffect(()=>{
    const profile=burrowData?.profile;if(!profile||profile.id!==userId)return;
    if(profile.display_name&&profile.display_name!=='user')setDisplayName(profile.display_name);
    if(profile.avatar_url!=null){setAvatarUrl(profile.avatar_url);setIsDefaultAvatar(profile.is_default_avatar??undefined);}
  },[userId,burrowData?.profile.id,burrowData?.profile.display_name,burrowData?.profile.avatar_url,burrowData?.profile.is_default_avatar]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const epoch = sessionEpoch();
    void supabase.auth.getSession().then(({ data }) => {
      if (!active || epoch !== sessionEpoch()) return;
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      // Cache miss (Home warm-up failed / cold cache): fetch once so the
      // header doesn't sit on fallbacks forever.
      if (uid && !getCachedMeStats()) {
        void fetchMeStats(uid).then(() => { if (active && epoch === sessionEpoch()) refreshProfile(); }).catch(() => {});
      }
    });
    return () => { active = false; mounted.current = false; };
  }, [refreshProfile]);

  // Refresh tier + profile on focus (e.g. returning from the paywall or
  // Account Management).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const epoch = sessionEpoch();
      const scope = menuScopeRef.current;
      const current = () => active && epoch === sessionEpoch() && scope === menuScopeRef.current;
      refreshProfile();
      setDuo({ asOwner: null, asMember: null });
      void supabase.auth.getSession().then(({ data }) => {
        if (!current()) return;
        const uid = data.session?.user?.id;
        if (uid) void fetchSubscriptionTier(uid, { force: true }).catch(() => {});
      });
      void fetchDuoStatus().then(value => { if (current()) setDuo(value); }).catch(() => {});
      void fetchPairing({ force: true }).then(value => { if (current()) setPairing(value); }).catch(() => {});
      void refreshBurrowAfterCurrent({ silent: true }).catch(() => {});
      // Prepare the real invitation code silently for the shared pairing prompt.
      void fetchFriends().catch(() => {});
      return () => { active = false; };
    }, [refreshProfile, menuScope]),
  );



  const goTo = (path: string) => {
    void haptics.pageOpen();
    router.push(path as never);
  };

  const openNotificationTimePicker = () => {
    setNotificationPickerSeed(getNotificationSettings());
    setNotificationPickerOpen(true);
  };

  const onEnableNotifications = async () => {
    if (notificationPermissionBusy) return;
    void haptics.pageOpen();
    setNotificationPermissionBusy(true);
    try {
      const current = await checkNotificationPermission();
      const result = current === 'granted'
        ? 'granted'
        : await requestNotificationPermission();

      if (result === 'granted') {
        openNotificationTimePicker();
        return;
      }

      appAlert(
        'Notifications Disabled',
        'Allow notifications in your device settings to choose a daily reminder time.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
        ],
      );
    } catch (error) {
      console.warn('[me] notification permission failed:', error);
      appAlert('Could not enable notifications', 'Please try again.');
    } finally {
      setNotificationPermissionBusy(false);
    }
  };

  const openUrl = async (url: string) => {
    void haptics.pageOpen();
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      console.warn('[me] openBrowserAsync failed:', e);
    }
  };

  const onPairedRow = () => {
    if (!menuPairing?.paired || !menuPairing.partner) {
      void haptics.pageOpen();
      showPartnerPairing();
      return;
    }
    void haptics.light();
    setConfirmText('');
    setUnpairError('');
    setPairedModalPartnerId(menuPairing.partner.userId);
    setPairedModalStep('profile');
  };

  const closePairedModal = () => {
    if (unpairLock.current) return;
    Keyboard.dismiss();
    setConfirmText('');
    setUnpairError('');
    setPairedModalStep('closed');
  };

  const goBackToPairedProfile = () => {
    if (unpairLock.current) return;
    Keyboard.dismiss();
    setConfirmText('');
    setUnpairError('');
    setPairedModalStep('profile');
  };

  const confirmUnpair = async () => {
    if (confirmText.trim() !== 'Confirm' || unpairLock.current
      || !pairedModalPartnerId || menuPairing?.partner?.userId !== pairedModalPartnerId) return;
    unpairLock.current = true;
    const epoch = sessionEpoch();
    const owner = sessionUserId();
    Keyboard.dismiss();
    void haptics.warning();
    setUnpairing(true);
    setUnpairError('');
    const ok = await unsetPairing();
    if (epoch !== sessionEpoch() || owner !== sessionUserId()) {
      unpairLock.current = false;
      if (mounted.current) setUnpairing(false);
      return;
    }
    if (!ok) {
      unpairLock.current = false;
      if (mounted.current) {
        setUnpairError('We could not end this pairing. Please check your connection and try again.');
        setUnpairing(false);
      }
      return;
    }
    // Purge shared room/history state immediately, including a read started
    // before the mutation. Offline refresh must not expose the former partner.
    invalidateBurrowPair();
    void refreshBurrowAfterCurrent({ silent: true }).catch(() => {});
    unpairLock.current = false;
    if (mounted.current) {
      setPairing({ paired: false, partner: null });
      setPairedModalStep('closed');
      setConfirmText('');
      setUnpairing(false);
    }
    void fetchDuoStatus().then(value => { if (mounted.current && epoch === sessionEpoch()) setDuo(value); }).catch(() => {});
    if (owner) void fetchSubscriptionTier(owner, { force: true }).catch(() => {});
    void haptics.success();
  };

  /** Design row "Rate Us on App Store": native in-app review when available. */
  const onRateUs = async () => {
    void haptics.light();
    try {
      if (await StoreReview.hasAction()) {
        await StoreReview.requestReview();
      }
    } catch (e) {
      console.warn('[me] store review failed:', e);
    }
  };

  // Defensive: a stale cache may still hold an old tier key (pro/basic/ultra)
  // that no longer exists in PRICING_TIERS. Any non-free unknown maps to plus.
  const safeTier = PRICING_TIERS[tier] ? tier : tier === 'free' ? 'free' : 'plus';
  const isPlus = burrowData ? burrowData.hasPlus : safeTier !== 'free';
  const appVersion = Constants.expoConfig?.version ?? '';

  return (
    <BottomSheetModalProvider>
      <View style={styles.root}>
        <StatusBar hidden />
        <View style={[styles.navigation, { paddingTop: Math.max(insets.top, 16) + 8 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={() => { void haptics.light(); router.back(); }} style={styles.closeBtn} hitSlop={8}>
            <BackIcon color="#4A2B20"/>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false} bounces={false} contentInsetAdjustmentBehavior="never">
          <View style={styles.header}>
            <View style={styles.coupleAvatars}>
              <Pressable accessibilityRole="button" accessibilityLabel="Change your profile photo" disabled={!userId} onPress={()=>setAvatarEditor(true)} style={styles.selfAvatar}>
                <UserAvatar userId={userId} otherUserId={menuPairing?.partner?.userId} name={displayName} avatarUrl={avatarUrl} isDefaultAvatar={isDefaultAvatar} size={72}/>
                <View style={styles.cameraBadge}><MaterialCommunityIcons name="camera-outline" size={14} color="#57351F"/></View>
              </Pressable>
              {menuPairing?.paired&&menuPairing.partner&&<UserAvatar userId={menuPairing.partner.userId} otherUserId={userId} name={menuPairing.partner.displayName}
                avatarUrl={menuPairing.partner.avatarUrl} isDefaultAvatar={menuPairing.partner.isDefaultAvatar} size={72}/>}
            </View>
            <Text style={styles.coupleNames}>{displayName||'You'}{menuPairing?.paired&&menuPairing.partner?` & ${menuPairing.partner.displayName}`:''}</Text>
          </View>

          {/* Enable Notifications card (design) */}
          <View style={styles.notifCard}>
            <MaterialCommunityIcons name="bell" size={30} color="#BB6848" style={styles.cardIcon} />
            <View style={{ flex: 1 }}>
              <Text style={styles.notifTitle}>Enable Notifications</Text>
              <Text style={styles.notifSub}>Get reminders to collect your memories.</Text>
            </View>
            <Pressable
              onPress={() => void onEnableNotifications()}
              disabled={notificationPermissionBusy}
              style={({ pressed }) => [styles.notifBtn, pressed && styles.pressedBtn]}
            >
              {notificationPermissionBusy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.notifBtnText}>Enable</Text>
              )}
            </Pressable>
          </View>

          {/* Burrow Plus banner (design: brown, white View button) */}
          <View style={styles.plusBanner}>
            <View style={styles.plusIconWrap}>
              <MaterialCommunityIcons name="crown" size={25} color="#4A3220" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.plusTitleRow}>
                <Text style={styles.plusTitle}>Burrow</Text>
                <View style={styles.plusChip}><Text style={styles.plusChipText}>Plus</Text></View>
              </View>
              <Text style={styles.plusSub}>
                {isPlus
                  ? duo.asMember ? `Plus shared by ${duo.asMember.ownerName}.`
                    : duo.asOwner?.claimed ? `Plus for you and ${duo.asOwner.memberName}.`
                    : "You're on Plus. Both of you are covered."
                  : 'Unlock premium for both of you.'}
              </Text>
            </View>
            <Pressable
              onPress={() => goTo('/(main)/(modals)/subscription-paywall')}
              style={({ pressed }) => [styles.plusViewBtn, pressed && styles.pressedBtn]}
            >
              <Text style={styles.plusViewText}>View</Text>
            </Pressable>
          </View>

          {/* Settings list (design rows) */}
          <View style={styles.menuCard}>
            <MenuRow icon="account" label="Account Management" onPress={() => goTo('/(main)/(modals)/account-management')} divider />
            <MenuRow
              icon="account-group"
              label={menuPairing?.paired ? "My Paired Partner" : 'Pair with My Partner'}
              onPress={onPairedRow}
              divider
            />
            <MenuRow icon="cash-multiple" label="Get More Coins" onPress={() => goTo('/(main)/coin-shop')} divider />
            <MenuRow icon="ticket-percent-outline" label="Redeem Code" onPress={()=>{void haptics.light();void openOfficialRedeemCode();}} divider />
            <MenuRow icon="link-variant" label="Connect Account" onPress={() => goTo('/(main)/(modals)/connect-account')} divider />
            <MenuRow icon="star" label="Love Burrow? Rate us" onPress={() => void onRateUs()} divider />
            <MenuRow icon="bug" label="Report Bugs" onPress={() => goTo('/(main)/(modals)/support')} divider />
            <MenuRow icon="heart" label="Help Center" onPress={() => goTo('/(main)/(modals)/support')} divider />
            {(['sound','haptics'] as const).map(key => <MenuPreferenceRow key={key}
              icon={key==='sound'?'volume-high':'vibrate'} label={key==='sound'?'Music & Sound Effects':'Haptic Feedback'}
              value={interaction[key]} divider={key==='sound'}
              onValueChange={value=>{try{setInteractionPreference(key,value);}catch{appAlert('Could not save setting','Free some device storage and try again.');}}}/>)}
          </View>

          {/* Legal */}
          <View style={styles.legalRow}>
            <Pressable onPress={() => openUrl(PRIVACY_URL)} hitSlop={8}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </Pressable>
            <Text style={styles.legalDot}>·</Text>
            <Pressable onPress={() => openUrl(TERMS_URL)} hitSlop={8}>
              <Text style={styles.legalLink}>Terms of Service</Text>
            </Pressable>
          </View>
          {metaPrivacy.applies ? <Pressable onPress={metaPrivacy.openPreferences} style={styles.privacyPreferences}>
            <Text style={styles.legalLink}>Ad Measurement: {metaPrivacy.choice === 'granted' ? 'Allowed' : 'Not allowed'}</Text>
          </Pressable> : null}
          {appVersion ? <Text style={styles.versionText}>Version {appVersion}</Text> : null}
        </ScrollView>

        {avatarEditor&&userId&&<ProfileAvatarEditor userId={userId} previousUrl={avatarUrl} onClose={()=>setAvatarEditor(false)}/>}

        <Modal
          visible={notificationPickerOpen}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setNotificationPickerOpen(false)}
        >
          <View style={styles.notificationPickerBackdrop}>
            <View style={styles.notificationPickerModal}>
              <GridBackground base="#F2E6CB" line="#E3D2B2" cell={22} lineWidth={1.2} />
              <Pressable
                onPress={() => { void haptics.pageClose(); setNotificationPickerOpen(false); }}
                style={styles.notificationPickerClose}
                hitSlop={8}
              >
                <MaterialIcons name="close" size={20} color="#FFFFFF" />
              </Pressable>
              <View style={styles.notificationPickerContent}>
                <NotificationTimePicker
                  initialHour={notificationPickerSeed.hour}
                  initialMin={notificationPickerSeed.min}
                  showDisable={notificationPickerSeed.enabled}
                  onSaved={() => setNotificationPickerOpen(false)}
                  onDisabled={() => setNotificationPickerOpen(false)}
                />
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          visible={pairedModalStep !== 'closed'}
          transparent
          animationType="fade"
          onRequestClose={pairedModalStep === 'confirm' ? goBackToPairedProfile : closePairedModal}
        >
          <Pressable style={styles.pairedBackdrop} onPress={Keyboard.dismiss}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.pairedKeyboardView}
            >
              <Pressable
                style={styles.pairedModalCard}
                onPress={(event) => {
                  event.stopPropagation();
                  Keyboard.dismiss();
                }}
              >
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.pairedModalContent}
                >
                {pairedModalStep === 'profile' && menuPairing?.partner ? (
                  <>
                    <Pressable onPress={() => { void haptics.pageClose(); closePairedModal(); }} style={styles.pairedClose} hitSlop={8}>
                      <MaterialIcons name="close" size={22} color="#FFFFFF" />
                    </Pressable>
                    <View style={styles.partnerAvatarWrap}>
                      <UserAvatar userId={menuPairing.partner.userId} otherUserId={userId} name={menuPairing.partner.displayName} avatarUrl={menuPairing.partner.avatarUrl} isDefaultAvatar={menuPairing.partner.isDefaultAvatar} size={88}/>
                    </View>
                    <Text style={styles.partnerName}>{menuPairing.partner.displayName}</Text>
                    <Text style={styles.partnerRelationship}>Status: Paired</Text>
                    <View style={styles.pairedDateCard}>
                      <MaterialIcons name="favorite" size={19} color="#B86A5B" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pairedDateLabel}>Paired since</Text>
                        <Text style={styles.pairedDateValue}>{formatPairedDate(menuPairing.pairedAt)}</Text>
                      </View>
                    </View>
                    <Pressable
                      onPress={() => {
                        void haptics.warning();
                        setConfirmText('');
                        setUnpairError('');
                        setPairedModalStep('confirm');
                      }}
                      style={({ pressed }) => [styles.unpairButton, pressed && styles.pressedBtn]}
                    >
                      <MaterialIcons name="link-off" size={20} color="#A64235" />
                      <Text style={styles.unpairButtonText}>Unpair</Text>
                    </Pressable>
                  </>
                ) : pairedModalStep === 'confirm' && menuPairing?.partner ? (
                  <>
                    <View style={styles.warningIcon}>
                      <MaterialIcons name="link-off" size={30} color="#A64235" />
                    </View>
                    <Text style={styles.confirmTitle}>Unpair from {menuPairing.partner.displayName}?</Text>
                    <Text style={styles.confirmBody}>
                      Are you sure you want to end this pairing? After unpairing, you will no longer be able to view any of their memory items, journal entries, or connection information.
                    </Text>
                    <Text style={styles.confirmInstruction}>Type Confirm below to continue.</Text>
                    <TextInput
                      value={confirmText}
                      onChangeText={setConfirmText}
                      placeholder="Confirm"
                      placeholderTextColor="#B3A48F"
                      autoCapitalize="words"
                      autoCorrect={false}
                      editable={!unpairing}
                      returnKeyType="done"
                      onSubmitEditing={() => void confirmUnpair()}
                      style={styles.confirmInput}
                    />
                    {unpairError ? <Text style={styles.unpairError}>{unpairError}</Text> : null}
                    <View style={styles.confirmActions}>
                      <Pressable
                        onPress={() => { void haptics.pageClose(); goBackToPairedProfile(); }}
                        disabled={unpairing}
                        style={({ pressed }) => [styles.cancelButton, pressed && styles.pressedBtn]}
                      >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void confirmUnpair()}
                        disabled={confirmText.trim() !== 'Confirm' || unpairing}
                        style={({ pressed }) => [
                          styles.confirmUnpairButton,
                          (confirmText.trim() !== 'Confirm' || unpairing) && styles.confirmUnpairDisabled,
                          pressed && confirmText.trim() === 'Confirm' && !unpairing && styles.pressedBtn,
                        ]}
                      >
                        {unpairing ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.confirmUnpairText}>Unpair</Text>
                        )}
                      </Pressable>
                    </View>
                  </>
                ) : null}
                </ScrollView>
              </Pressable>
            </KeyboardAvoidingView>
          </Pressable>
        </Modal>
      </View>
    </BottomSheetModalProvider>
  );
}

function formatPairedDate(value?: string | null): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function MenuPreferenceRow({icon,label,value,onValueChange,divider}:{
  icon:'volume-high'|'vibrate';label:string;value:boolean;onValueChange:(value:boolean)=>void;divider?:boolean;
}) {
  return <View style={[styles.menuRow,divider&&styles.menuDivider]}>
    <MaterialCommunityIcons name={icon} size={30} color="#B86949" style={styles.menuIcon}/>
    <Text style={styles.menuLabel}>{label}</Text>
    <Switch accessibilityLabel={label} value={value} onValueChange={onValueChange}
      trackColor={{true:'#C96132'}} thumbColor={Platform.OS==='android'&&value?'#FFFFFF':undefined} style={styles.menuToggle}/>
  </View>;
}

function MenuRow({ icon, label, onPress, divider }: {
  icon: 'account' | 'wallet' | 'account-group' | 'cash-multiple' | 'link-variant' | 'star' | 'bug' | 'heart' | 'ticket-percent-outline';
  label: string;
  onPress: () => void;
  divider?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.menuRow, divider && styles.menuDivider, { opacity: pressed ? 0.6 : 1 }]}>
      <MaterialCommunityIcons name={icon} size={30} color="#B86949" style={styles.menuIcon} />
      <Text style={styles.menuLabel}>{label}</Text>
      <MaterialIcons name="chevron-right" size={25} color="#A18A78" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF9F0' },
  navigation: { paddingHorizontal: 20, paddingBottom: 8 },
  scroll: { paddingHorizontal: 16, paddingTop: 22 },
  header: { marginBottom: 28 },
  coupleAvatars:{flexDirection:'row',justifyContent:'center',alignItems:'center',paddingBottom:20},
  selfAvatar:{marginRight:-6,zIndex:1},cameraBadge:{position:'absolute',bottom:-4,alignSelf:'center',width:24,height:24,borderRadius:12,backgroundColor:'#FFF9F0',borderColor:'#57351F',borderWidth:1,alignItems:'center',justifyContent:'center'},
  coupleNames:{textAlign:'center',color:'#4A3220',fontSize:23,fontFamily:'Inter_700Bold',paddingHorizontal:16},
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, minHeight: 72 },
  avatarWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#F2DACA', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  userName: { color: '#4A3220', fontSize: 19, fontFamily: 'Inter_700Bold' },
  editButton: { minWidth: 80, minHeight: 38, paddingHorizontal: 20, borderRadius: 22, backgroundColor: '#4A3220', alignItems: 'center', justifyContent: 'center' },
  editButtonText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold' },

  cardIcon: { width: 35, textAlign: 'center' },
  pressedBtn: { transform: [{ translateY: 1 }], opacity: 0.85 },

  notifCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 74,
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 15, paddingVertical: 13, marginBottom: 14,
  },
  notifTitle: { color: '#24100D', fontSize: 17, fontFamily: 'Inter_700Bold' },
  notifSub: { color: '#927D6C', fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 },
  notifBtn: { backgroundColor: '#B96646', borderRadius: 22, paddingHorizontal: 17, paddingVertical: 10 },
  notifBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },
  notificationPickerBackdrop: {
    flex: 1, backgroundColor: 'rgba(41,27,18,0.58)',
    alignItems: 'center', justifyContent: 'center', padding: 22,
  },
  notificationPickerModal: {
    width: '100%', maxWidth: 420, overflow: 'hidden',
    backgroundColor: '#F2E6CB', borderRadius: 28, padding: 22,
    shadowColor: '#2A1A10', shadowOpacity: 0.24, shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  notificationPickerClose: {
    alignSelf: 'flex-end', width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#4A3423', alignItems: 'center', justifyContent: 'center',
  },
  notificationPickerContent: { alignItems: 'center', paddingTop: 4 },

  plusBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 82,
    backgroundColor: '#4A2B20', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 18, marginBottom: 14,
  },
  plusIconWrap: {
    width: 42, height: 42, flexShrink: 0, borderRadius: 21,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  plusTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plusTitle: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_700Bold' },
  plusChip: { backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 8, paddingVertical: 2 },
  plusChipText: { color: '#4A3220', fontSize: 13, fontFamily: 'Inter_800ExtraBold' },
  plusSub: { color: '#EBD9CF', fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 5, lineHeight: 17 },
  plusViewBtn: { backgroundColor: '#FFFAF5', borderRadius: 24, paddingHorizontal: 23, paddingVertical: 11 },
  plusViewText: { color: '#2B2B2B', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },

  menuCard: { backgroundColor: '#FFFFFF', borderRadius: 20, marginBottom: 14, paddingHorizontal: 14, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 60, paddingVertical: 14, paddingHorizontal: 3 },
  menuIcon: { width: 36, textAlign: 'center' },
  menuToggle: { alignSelf: 'center', flexShrink: 0 },
  menuDivider: { borderBottomWidth: 1, borderBottomColor: '#EEE6DF' },
  menuLabel: { flex: 1, color: '#24100D', fontSize: 16, fontFamily: 'Inter_700Bold' },

  pairedBackdrop: { flex: 1, backgroundColor: 'rgba(41,27,18,0.58)' },
  pairedKeyboardView: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 28 },
  pairedModalCard: {
    width: '100%', maxWidth: 420, maxHeight: '92%', overflow: 'hidden',
    backgroundColor: '#FFF8EB', borderRadius: 28,
    shadowColor: '#2A1A10', shadowOpacity: 0.24, shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  pairedModalContent: { alignItems: 'center', padding: 24 },
  pairedClose: {
    alignSelf: 'flex-end', width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#4A3423', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  partnerAvatarWrap: {
    width: 96, height: 96, borderRadius: 48, overflow: 'hidden',
    backgroundColor: '#F2E6CB', borderWidth: 4, borderColor: '#E8CFA5',
  },
  partnerAvatar: { width: '100%', height: '100%' },
  partnerName: { marginTop: 14, color: '#34251B', fontSize: 25, fontFamily: 'Inter_800ExtraBold', textAlign: 'center' },
  partnerRelationship: {
    marginTop: 7, color: '#795A42', fontSize: 14, fontFamily: 'Inter_700Bold',
    backgroundColor: '#F2E4CE', borderRadius: 14, paddingHorizontal: 13, paddingVertical: 6,
  },
  pairedDateCard: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 18, padding: 15, marginTop: 22,
    borderWidth: 1, borderColor: '#EDDDC4',
  },
  pairedDateLabel: { color: '#9A826B', fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  pairedDateValue: { color: '#423126', fontSize: 15, fontFamily: 'Inter_800ExtraBold', marginTop: 2 },
  unpairButton: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 18, borderRadius: 17, paddingVertical: 14,
    backgroundColor: '#FFF2EF', borderWidth: 1.5, borderColor: '#D78A7E',
  },
  unpairButtonText: { color: '#A64235', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },
  warningIcon: {
    width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFE8E3', marginBottom: 15,
  },
  confirmTitle: { color: '#34251B', fontSize: 22, lineHeight: 28, fontFamily: 'Inter_800ExtraBold', textAlign: 'center' },
  confirmBody: { marginTop: 12, color: '#6F5C4B', fontSize: 14, lineHeight: 21, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  confirmInstruction: { alignSelf: 'flex-start', marginTop: 20, color: '#4A3423', fontSize: 13, fontFamily: 'Inter_800ExtraBold' },
  confirmInput: {
    width: '100%', marginTop: 8, backgroundColor: '#FFFFFF', borderRadius: 15,
    borderWidth: 1.5, borderColor: '#D9C4A5', paddingHorizontal: 15, paddingVertical: 13,
    color: '#34251B', fontSize: 16, fontFamily: 'Inter_600SemiBold',
  },
  unpairError: { width: '100%', marginTop: 9, color: '#A64235', fontSize: 12.5, lineHeight: 18, fontFamily: 'Inter_600SemiBold' },
  confirmActions: { width: '100%', flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 15, paddingVertical: 14, backgroundColor: '#EFE4D3' },
  cancelButtonText: { color: '#594535', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },
  confirmUnpairButton: { flex: 1, minHeight: 49, alignItems: 'center', justifyContent: 'center', borderRadius: 15, paddingVertical: 14, backgroundColor: '#A64235' },
  confirmUnpairDisabled: { backgroundColor: '#D8C7BE' },
  confirmUnpairText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },

  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 18 },
  legalLink: { color: '#9A806F', fontSize: 13, fontFamily: 'Inter_500Medium' },
  legalDot: { color: '#C9BCA5' },
  privacyPreferences: { alignSelf: 'center', marginTop: 10, padding: 5 },
  versionText: { color: '#B5A093', fontSize: 12, fontFamily: 'Inter_500Medium', textAlign: 'center', marginTop: 11 },
});

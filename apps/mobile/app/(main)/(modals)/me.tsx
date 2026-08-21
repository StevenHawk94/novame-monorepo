import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import * as StoreReview from 'expo-store-review';
import Constants from 'expo-constants';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import { PRICING_TIERS } from '@novame/core';
import { PlanBillingSheet, type PlanBillingSheetRef } from '@/components/me/plan-billing-sheet';
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
  getCachedFriends,
  getCachedPairing,
  unsetPairing,
  type PairingStatus,
} from '@/lib/friends-api';
import { fetchMeStats, getCachedMeStats } from '@/lib/me-stats';
import { getBunnyName } from '@/lib/onboarding';
import { resolveAvatarSource } from '@/lib/avatar';
import { supabase } from '@/lib/supabase';
import { useRef } from 'react';

const PRIVACY_URL = 'https://www.burrow-app.com/privacy';
const TERMS_URL = 'https://www.burrow-app.com/terms';

/**
 * Settings center (design: menu.png), reached from Home's top-left hamburger.
 * Warm cream page: X close, avatar + name, an Enable Notifications card, the
 * Burrow Plus banner, then a white list card of settings rows. All v2 logic
 * (Plan & Billing sheet, Duo seats, sign out, legal) is unchanged from the
 * previous night-theme build — this is a reskin plus the design's new rows
 * (Invite Friends, Rate Us, Report Bugs / Help Centers → support).
 *
 * Row icons are emoji placeholders until the sticker icon set covers them —
 * same convention as the Skills pill on the companion sheet.
 */
export default function MeScreen() {
  const insets = useSafeAreaInsets();
  const planBillingSheetRef = useRef<PlanBillingSheetRef>(null);
  const tier = useSubscriptionTier();
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [isDefaultAvatar, setIsDefaultAvatar] = useState<boolean | undefined>(undefined);
  const [duo, setDuo] = useState<DuoStatus>({ asOwner: null, asMember: null });
  const [pairing, setPairing] = useState<PairingStatus | null>(() => getCachedPairing());
  const [pairedModalStep, setPairedModalStep] = useState<'closed' | 'profile' | 'confirm'>('closed');
  const [confirmText, setConfirmText] = useState('');
  const [unpairing, setUnpairing] = useState(false);
  const [unpairError, setUnpairError] = useState('');
  const [notificationPermissionBusy, setNotificationPermissionBusy] = useState(false);
  const [notificationPickerOpen, setNotificationPickerOpen] = useState(false);
  const [notificationPickerSeed, setNotificationPickerSeed] = useState(
    () => getNotificationSettings(),
  );

  // Name + avatar come from me-stats (profiles), the same source Account
  // Management edits — so a save there shows here on the next focus.
  // display_name is auto-seeded at signup ('user' for guests, email prefix
  // otherwise); a literal 'user' is placeholder noise, so the onboarding
  // name the user typed outranks it.
  const refreshProfile = useCallback(() => {
    const cached = getCachedMeStats();
    const profileName =
      cached?.displayName && cached.displayName !== 'user' ? cached.displayName : '';
    setDisplayName(profileName || getBunnyName() || '');
    setAvatarUrl(cached?.avatarUrl ?? '');
    setIsDefaultAvatar(cached?.isDefaultAvatar);
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      // Cache miss (Home warm-up failed / cold cache): fetch once so the
      // header doesn't sit on fallbacks forever.
      if (uid && !getCachedMeStats()) {
        void fetchMeStats(uid).then(refreshProfile).catch(() => {});
      }
    });
  }, [refreshProfile]);

  // Refresh tier + profile on focus (e.g. returning from the paywall or
  // Account Management).
  useFocusEffect(
    useCallback(() => {
      refreshProfile();
      void supabase.auth.getSession().then(({ data }) => {
        const uid = data.session?.user?.id;
        if (uid) void fetchSubscriptionTier(uid).catch(() => {});
      });
      void fetchDuoStatus().then(setDuo);
      void fetchPairing().then(setPairing);
      // Warm the stable invite code while the menu is visible. The row can
      // then open the native share sheet immediately instead of waiting for
      // the full friends/status payload (pairing, requests, feed identities).
      void fetchFriends();
    }, [refreshProfile]),
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

  /** Design row "Invite Friends": share your friend code via the system sheet. */
  const onInviteFriends = async () => {
    void haptics.light();
    const cachedCode = getCachedFriends().inviteCode;
    if (cachedCode) {
      // Revalidate silently; opening the system share sheet must not wait on
      // network data that is already stable and cached locally.
      void fetchFriends();
      await Share.share({
        message: `Add me on Burrow! My friend code is ${cachedCode} — let's share memory items together.`,
      });
      return;
    }

    // First-ever cold start only: no code exists locally yet, so fetch once.
    // Menu focus already starts this request, making this branch uncommon.
    try {
      const status = await fetchFriends();
      if (status.inviteCode) {
        await Share.share({
          message: `Add me on Burrow! My friend code is ${status.inviteCode} — let's share memory items together.`,
        });
        return;
      }
    } catch {
      // fall through to the Friends tab, where the full add flow lives
    }
    router.push('/(main)/(tabs)/friends' as never);
  };

  const onPairedRow = () => {
    if (!pairing?.paired || !pairing.partner) {
      void onInviteFriends();
      return;
    }
    void haptics.light();
    setConfirmText('');
    setUnpairError('');
    setPairedModalStep('profile');
  };

  const closePairedModal = () => {
    if (unpairing) return;
    Keyboard.dismiss();
    setConfirmText('');
    setUnpairError('');
    setPairedModalStep('closed');
  };

  const goBackToPairedProfile = () => {
    if (unpairing) return;
    Keyboard.dismiss();
    setConfirmText('');
    setUnpairError('');
    setPairedModalStep('profile');
  };

  const confirmUnpair = async () => {
    if (confirmText.trim() !== 'Confirm' || unpairing) return;
    Keyboard.dismiss();
    void haptics.warning();
    setUnpairing(true);
    setUnpairError('');
    const ok = await unsetPairing();
    if (!ok) {
      setUnpairError('We could not end this pairing. Please check your connection and try again.');
      setUnpairing(false);
      return;
    }
    setPairing({ paired: false, partner: null });
    setPairedModalStep('closed');
    setConfirmText('');
    setUnpairing(false);
    void fetchDuoStatus().then(setDuo);
    if (userId) void fetchSubscriptionTier(userId, { force: true }).catch(() => {});
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
  const isPlus = safeTier !== 'free';
  const appVersion = Constants.expoConfig?.version ?? '';

  return (
    <BottomSheetModalProvider>
      <View style={styles.root}>
        <GridBackground base="#F2E6CB" line="#E3D2B2" cell={22} lineWidth={1.2} />
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
          {/* Header: brown X + avatar + name */}
          <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
            <Pressable onPress={() => { void haptics.light(); router.back(); }} style={styles.closeBtn} hitSlop={8}>
              <MaterialIcons name="close" size={22} color="#FFFFFF" />
            </Pressable>
            <View style={styles.userRow}>
              <View style={styles.avatarWrap}>
                <Image
                  source={resolveAvatarSource(avatarUrl, isDefaultAvatar, userId)}
                  style={styles.avatarImg}
                  contentFit="cover"
                  contentPosition="center"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName} numberOfLines={1}>{displayName || 'You'}</Text>
              </View>
            </View>
          </View>

          {/* Enable Notifications card (design) */}
          <View style={styles.notifCard}>
            <Text style={styles.rowEmoji}>{'🔔'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.notifTitle}>Enable Notifications</Text>
              <Text style={styles.notifSub}>Get reminder to collect your memories.</Text>
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
              <MaterialIcons name="workspace-premium" size={25} color="#4A3220" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.plusTitleRow}>
                <Text style={styles.plusTitle}>Burrow</Text>
                <View style={styles.plusChip}><Text style={styles.plusChipText}>Plus</Text></View>
              </View>
              <Text style={styles.plusSub}>
                {isPlus
                  ? "You're on Plus. Every premium feature is yours."
                  : 'Get Plus to unlock all premium features to you and your bff'}
              </Text>
            </View>
            <Pressable
              onPress={() => { void haptics.pageOpen(); planBillingSheetRef.current?.present(); }}
              style={({ pressed }) => [styles.plusViewBtn, pressed && styles.pressedBtn]}
            >
              <Text style={styles.plusViewText}>View</Text>
            </Pressable>
          </View>

          {/* Settings list (design rows) */}
          <View style={styles.menuCard}>
            <MenuRow emoji={'🙂'} label="Account Management" onPress={() => goTo('/(main)/(modals)/account-management')} divider />
            <MenuRow emoji={'👛'} label="Plan and Billing" onPress={() => { void haptics.pageOpen(); planBillingSheetRef.current?.present(); }} divider />
            <MenuRow
              emoji={pairing?.paired ? '🐇' : '🐰'}
              label={pairing?.paired ? 'My Paired' : 'Invite Friends'}
              onPress={onPairedRow}
              divider
            />
            <MenuRow emoji={'🔗'} label="Connect Account" onPress={() => goTo('/(main)/(modals)/connect-account')} divider />
            <MenuRow emoji={'⭐'} label="Rate Us on App Store" onPress={() => void onRateUs()} divider />
            <MenuRow emoji={'🐞'} label="Report Bugs" onPress={() => goTo('/(main)/(modals)/support')} divider />
            <MenuRow emoji={'💝'} label="Help Centers" onPress={() => goTo('/(main)/(modals)/support')} />
          </View>

          {/* Duo seat: auto-granted to the paired partner (2026-08-11) —
              the manual invite-code entry is retired. */}
          {duo.asOwner ? (
            <View style={styles.duoCard}>
              <Text style={styles.duoTitle}>Your Duo plan</Text>
              {duo.asOwner.claimed ? (
                <Text style={styles.duoBody}>
                  {duo.asOwner.memberName} has joined your Plus. Both of you are covered.
                </Text>
              ) : (
                <Text style={styles.duoBody}>
                  Your Plus covers two people — pair with someone on the Connection tab and
                  they get Plus automatically.
                </Text>
              )}
            </View>
          ) : duo.asMember ? (
            <View style={styles.duoCard}>
              <Text style={styles.duoTitle}>Plus via Duo</Text>
              <Text style={styles.duoBody}>
                You're on Plus through {duo.asMember.ownerName}'s Duo plan.
              </Text>
            </View>
          ) : null}

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
          {appVersion ? <Text style={styles.versionText}>VERSION {appVersion}</Text> : null}
        </ScrollView>

        <PlanBillingSheet ref={planBillingSheetRef} />

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
                {pairedModalStep === 'profile' && pairing?.partner ? (
                  <>
                    <Pressable onPress={() => { void haptics.pageClose(); closePairedModal(); }} style={styles.pairedClose} hitSlop={8}>
                      <MaterialIcons name="close" size={22} color="#FFFFFF" />
                    </Pressable>
                    <View style={styles.partnerAvatarWrap}>
                      <Image
                        source={resolveAvatarSource(
                          pairing.partner.avatarUrl ?? '',
                          pairing.partner.isDefaultAvatar,
                          pairing.partner.userId,
                        )}
                        style={styles.partnerAvatar}
                        contentFit="cover"
                        contentPosition="center"
                      />
                    </View>
                    <Text style={styles.partnerName}>{pairing.partner.displayName}</Text>
                    {pairing.relationship ? <Text style={styles.partnerRelationship}>{pairing.relationship}</Text> : null}
                    <View style={styles.pairedDateCard}>
                      <MaterialIcons name="favorite" size={19} color="#B86A5B" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pairedDateLabel}>Paired since</Text>
                        <Text style={styles.pairedDateValue}>{formatPairedDate(pairing.pairedAt)}</Text>
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
                ) : pairedModalStep === 'confirm' && pairing?.partner ? (
                  <>
                    <View style={styles.warningIcon}>
                      <MaterialIcons name="link-off" size={30} color="#A64235" />
                    </View>
                    <Text style={styles.confirmTitle}>Unpair from {pairing.partner.displayName}?</Text>
                    <Text style={styles.confirmBody}>
                      Are you sure you want to end this pairing? After unpairing, you will no longer be able to view any of their memory items, reflections, or connection information.
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

function MenuRow({ emoji, label, onPress, divider }: {
  emoji: string;
  label: string;
  onPress: () => void;
  divider?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, divider && styles.menuDivider, { opacity: pressed ? 0.6 : 1 }]}>
      <Text style={styles.rowEmoji}>{emoji}</Text>
      <Text style={styles.menuLabel}>{label}</Text>
      <MaterialIcons name="chevron-right" size={22} color="#C9BCA5" />
    </Pressable>
  );
}

// Warm cream palette from menu.png: page #F2E6CB, cards #FFFFFF, brown accents
// #4A3423, banner #4A3220, body text #2B2B2B, muted #8A7A63.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2E6CB' },
  scroll: { paddingHorizontal: 20 },
  header: { marginBottom: 18 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#4A3423', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  userName: { color: '#4A3423', fontSize: 24, fontFamily: 'Inter_800ExtraBold' },

  rowEmoji: { fontSize: 24 },
  pressedBtn: { transform: [{ translateY: 1 }], opacity: 0.85 },

  notifCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, marginBottom: 14,
  },
  notifTitle: { color: '#2B2B2B', fontSize: 17, fontFamily: 'Inter_800ExtraBold' },
  notifSub: { color: '#8A7A63', fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 2 },
  notifBtn: { backgroundColor: '#8A6240', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 11 },
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
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#4A3220', borderRadius: 20, padding: 16, marginBottom: 14,
  },
  plusIconWrap: {
    width: 34, height: 34, flexShrink: 0, borderRadius: 17,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  plusTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plusTitle: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_800ExtraBold' },
  plusChip: { backgroundColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  plusChipText: { color: '#4A3220', fontSize: 13, fontFamily: 'Inter_800ExtraBold' },
  plusSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 3, lineHeight: 18 },
  plusViewBtn: { backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 20, paddingVertical: 11 },
  plusViewText: { color: '#2B2B2B', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },

  menuCard: { backgroundColor: '#FFFFFF', borderRadius: 20, marginBottom: 14, paddingHorizontal: 16 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  menuDivider: { borderBottomWidth: 1, borderBottomColor: '#F0EAE0' },
  menuLabel: { flex: 1, color: '#2B2B2B', fontSize: 16, fontFamily: 'Inter_700Bold' },

  duoCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, marginBottom: 14, borderWidth: 1.5, borderColor: '#E8D5B0' },
  duoTitle: { color: '#4A3423', fontSize: 15, fontFamily: 'Inter_800ExtraBold', marginBottom: 8 },
  duoBody: { color: '#6B5B44', fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 19, marginBottom: 6 },

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

  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 },
  legalLink: { color: '#8A7A63', fontSize: 13, fontFamily: 'Inter_500Medium' },
  legalDot: { color: '#C9BCA5' },
  versionText: { color: '#B8A588', fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'center', marginTop: 12, letterSpacing: 1 },
});

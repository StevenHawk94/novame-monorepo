import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { PRICING_TIERS, type PricingTierKey } from '@novame/core';

import { haptics } from '@/lib/haptics';
import { getCachedSubscription } from '@/lib/subscription';
import { presentOfferCodeRedemption } from '@/lib/iap';

/**
 * Plan & Billing bottom sheet -- Stage 3.10.4.
 *
 * Rendered inline on the Me page rather than as a router modal route.
 * The Me page holds a ref to this component and calls present() when
 * the user taps "Plan and Billing" in the menu (or the View button on
 * the Plan card).
 *
 * Why @gorhom/bottom-sheet (not native-stack formSheet):
 *   - The native UISheetPresentationController dimming behavior on
 *     iOS 18 did not render even after a clean rebuild (likely related
 *     to nested modal-stack presentation in this app's layout). gorhom
 *     gives explicit control over the backdrop, snap points, grabber,
 *     and corner radius -- and works the same on iOS / Android.
 *
 * Behavior (matches the original design spec):
 *   - Two snap points: 55% and 95% of screen height.
 *   - Dimmed backdrop (60% black) over the Me page; tap-outside
 *     dismisses.
 *   - Visible grabber on top + 28px corner radius.
 *   - Upgrade Plan dismisses the sheet, then pushes /subscription-
 *     paywall as a fresh modal (closing the paywall returns straight
 *     to the Me page rather than re-presenting this sheet).
 *   - Billing History is a stub Alert; real history lands with Stage
 *     5 IAP integration (B58).
 */

export type PlanBillingSheetRef = {
  present: () => void;
  dismiss: () => void;
};

export const PlanBillingSheet = forwardRef<PlanBillingSheetRef>((_, ref) => {
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [tier, setTier] = useState<PricingTierKey>('free');

  // Refresh tier from MMKV cache every time the sheet is presented so
  // the user sees their current plan even after upgrading in another
  // session. Stage 5 IAP will additionally invalidate the cache on
  // successful purchase, so no extra wiring needed here.
  const refreshTier = useCallback(() => {
    const cached = getCachedSubscription();
    setTier(cached?.tier ?? 'free');
  }, []);

  useEffect(() => {
    refreshTier();
  }, [refreshTier]);

  useImperativeHandle(ref, () => ({
    present: () => {
      refreshTier();
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.6}
      />
    ),
    [],
  );

  // Defensive: a stale cache may hold an old tier key (pro/basic/ultra) no
  // longer in PRICING_TIERS. Any non-free unknown maps to plus.
  const safeTier = PRICING_TIERS[tier] ? tier : tier === 'free' ? 'free' : 'plus';
  const tierInfo = PRICING_TIERS[safeTier];
  const isFree = tier === 'free';

  const handleClose = () => {
    void haptics.light();
    sheetRef.current?.dismiss();
  };

  const handleUpgrade = () => {
    void haptics.pageOpen();
    sheetRef.current?.dismiss();
    // Wait for the sheet's dismiss animation (~250ms) before pushing
    // the paywall so navigation doesn't race with the animation.
    setTimeout(() => {
      router.push('/(main)/(modals)/subscription-paywall');
    }, 280);
  };

  const handleRedeemCode = () => {
    void haptics.light();
    // Apple's redemption sheet is a system full-screen modal; it covers
    // this bottom sheet, so we don't dismiss first. The redeemed tier is
    // synced by the global purchase listener and reflected when the Me
    // page regains focus (no in-app success alert -- Apple's sheet already
    // confirms, matching the paywall's silent-success standard).
    void presentOfferCodeRedemption();
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.grabber}
      enableDynamicSizing
    >
      <BottomSheetView
        style={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Plan & Billing</Text>
          <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* Current Plan card */}
        <View style={styles.planCard}>
          <View style={styles.planCardHeader}>
            <View>
              <Text style={styles.currentPlanLabel}>CURRENT PLAN</Text>
              <Text style={styles.tierName}>{tierInfo.name}</Text>
            </View>
            <MaterialIcons
              name="workspace-premium"
              size={32}
              color="#8A6240"
            />
          </View>
        </View>

        {/* Upgrade Plan */}
        <Pressable
          onPress={handleUpgrade}
          style={({ pressed }) => [
            styles.primaryBtn,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <MaterialIcons name="upgrade" size={20} color="#FFFFFF" />
          <Text style={styles.primaryBtnText}>
            {isFree ? 'Upgrade Plan' : 'Change Plan'}
          </Text>
        </Pressable>

        {/* Redeem Code (iOS only -- Apple offer code redemption) */}
        {Platform.OS === 'ios' && (
          <Pressable
            onPress={handleRedeemCode}
            style={({ pressed }) => [
              styles.secondaryBtn,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <MaterialIcons
              name="redeem"
              size={20}
              color="#4A3423"
            />
            <Text style={styles.secondaryBtnText}>Redeem Code</Text>
          </Pressable>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

PlanBillingSheet.displayName = 'PlanBillingSheet';

// ---- styles ----

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: '#F2E6CB',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  grabber: {
    backgroundColor: '#C9BCA5',
    width: 40,
    height: 4,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: {
    color: '#4A3423',
    fontSize: 22,
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#4A3423',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#E8D5B0',
    padding: 20,
    marginBottom: 20,
  },
  planCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  currentPlanLabel: {
    color: '#8A6240',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  tierName: {
    color: '#4A3423',
    fontSize: 28,
    fontWeight: '900',
  },
  statLabel: {
    color: '#8A7A63',
    fontSize: 12,
    marginBottom: 4,
  },
  statValue: {
    color: '#4A3423',
    fontSize: 16,
    fontWeight: '700',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    backgroundColor: '#8A6240',
    borderRadius: 16,
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E8D5B0',
    borderRadius: 16,
  },
  secondaryBtnText: {
    color: '#4A3423',
    fontSize: 15,
    fontWeight: '700',
  },
});

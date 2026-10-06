import type { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UserAvatar } from '@/components/ui/user-avatar';
import { GridBackground } from '@/components/ui/grid-background';
import type { StoreSubscriptionPricing } from '@/lib/iap';
import { ONBOARDING_ART, ONBOARDING_CREAM as cream, ONBOARDING_INK as ink, ONBOARDING_SOIL as soil, ONBOARDING_FEATURES, ONBOARDING_FLOW, onboardingMetrics, type OnboardingStep } from '@/lib/burrow-onboarding-design';
import { OnboardingImage, OnboardingPage, OnboardingPager } from './onboarding-pager';
import { PlusBenefitIcon } from './plus-benefit-icon';

type Partner = { userId?: string; name: string; avatarUrl?: string; isDefaultAvatar?: boolean };
export type BurrowOnboardingProps = {
  step: OnboardingStep; next: () => void; go: (step: OnboardingStep) => void;
  firstName: string; setFirstName: (value: string) => void; partnerName: string; setPartnerName: (value: string) => void;
  dateInput: ReactNode; validInfo: boolean; saveInfo: () => void;
  photoUri?: string; defaultAvatar: number; choosePhoto: () => void; savePhoto: () => void;
  inviteCode: string | null; copied: boolean; copyCode: () => void; shareCode: () => void;
  pairCodeOpen: boolean; openCode: () => void; closeCode: () => void; pairCode: string; setPairCode: (value: string) => void;
  pairing: boolean; pair: () => void; partner: Partner | null;
  finish: () => void; finishing: boolean;
  pricing: StoreSubscriptionPricing | null; priceError: boolean; retryPrices: () => void;
  tryFree: () => void; openingPlans: boolean; plan: 'yearly' | 'monthly'; setPlan: (value: 'yearly' | 'monthly') => void;
  purchase: () => void; purchasing: boolean; restore: () => void; restoring: boolean;
  connectAccount: ReactNode;
};

export function OnboardingButton({ label, onPress, light = false, disabled = false, busy = false }: {
  label: string; onPress: () => void; light?: boolean; disabled?: boolean; busy?: boolean;
}) {
  const { width } = useWindowDimensions();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy }}
    disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [{ minHeight: Math.max(50, width * 125 / 900), borderRadius: 99, overflow: 'hidden' }, (disabled || busy) && { opacity: .5 }, pressed && { opacity: .85, transform: [{ scale: .985 }] }]}>
    <LinearGradient colors={light ? ['#FFF5E1', '#FFF5E1'] : ['#64351E', '#4B2717', '#63331C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.buttonFill}>
      {busy ? <ActivityIndicator color={light ? ink : cream}/> : <Text maxFontSizeMultiplier={1.3} style={[st.buttonText, { fontSize: Math.min(23, width * 44 / 900), color: light ? ink : cream }]}>{label}</Text>}
    </LinearGradient>
  </Pressable>;
}
function Curve({ width, height }: { width: number; height: number }) {
  // Artwork remains untouched: the cream overlay partially masks its lower edge.
  return <View pointerEvents="none" style={{ position: 'absolute', bottom: -1, width, height }}>
    <Svg width={width} height={height} viewBox="0 0 900 150" preserveAspectRatio="none">
      <Path d="M0 0 Q450 125 900 0 L900 150 L0 150Z" fill={cream}/>
      <Path d="M0 45 Q450 170 900 45" fill="none" stroke="#FFF9EF" strokeWidth="2"/>
    </Svg>
  </View>;
}
const BENEFITS = [
  ['favorite', 'Plus for Two', 'One subscription unlocks Plus for both of you.'],
  ['monetization-on', 'Daily Bonus Coins', 'Collect extra coins every time you visit your burrow.'],
  ['weekend', 'Exclusive Decor', 'Unlock Plus-only furniture and outfits.'],
  ['mail', 'Unlimited Love', 'Send as many hugs, kisses, and gifts as you like.'],
  ['casino', 'All Games Unlocked', 'Play every couple game and grow closer.'],
  ['explore', '3x Faster Adventures', 'Your bunny returns from adventures three times sooner.'],
] as const;

export function BurrowOnboardingPages(p: BurrowOnboardingProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const m = onboardingMetrics(width, height, insets.top, insets.bottom);
  const idx = ONBOARDING_FLOW.indexOf(p.step);
  const nextPage = p.step === 'pairing' ? 'paywall' : p.step === 'paywall' ? 'plans' : ONBOARDING_FLOW[idx + 1] ?? null;
  const bodySize = m.body, formTitle = Math.min(31, width * 64 / 900);
  const contentHeight = height - m.footer;
  const footer = (button: ReactNode, dots = -1, backgroundColor = cream) => <View style={[st.footer, { backgroundColor, paddingHorizontal: m.padding, paddingBottom: Math.max(18, insets.bottom + 12), minHeight: m.footer }]}>
    {button}{dots >= 0 && <View style={st.dots}>{ONBOARDING_FEATURES.map((item, i) => <View key={item.id} style={[st.dot, { backgroundColor: i === dots ? '#59311D' : '#E1C7AC' }]}/>)}</View>}
  </View>;
  const scrollProps = { style: st.flex, removeClippedSubviews: false, showsVerticalScrollIndicator: false, keyboardShouldPersistTaps: 'handled' as const };
  const skip = (onPress: () => void) => <Pressable accessibilityRole="button" accessibilityLabel="Skip" onPress={onPress} hitSlop={12} style={[st.skip, { top: insets.top + 12, right: m.padding }]}><Text style={st.skipText}>SKIP</Text></Pressable>;
  return <View style={st.root}>
    <StatusBar key={p.step} style={['toy', 'games', 'explore', 'pairing-success'].includes(p.step) ? 'light' : 'dark'}/>
    <OnboardingPager requestedPage={p.step} nextPage={nextPage}>
      <OnboardingPage id="start" imageCount={2}>
        <ScrollView {...scrollProps} contentContainerStyle={{ minHeight: contentHeight, justifyContent: 'center', paddingTop: insets.top + 28 }}>
          <View pointerEvents="none" style={{ position: 'absolute', top: contentHeight * .42, width, height: width * .16 }}><Curve width={width} height={width * .16}/></View>
          <OnboardingImage source={ONBOARDING_ART.wordmark} contentFit="contain" style={{ width: width * .74, height: width * .37, alignSelf: 'center', marginBottom: -width * .04 }}/>
          <View style={{ alignItems: 'center', marginTop: width * .03 }}>
            <OnboardingImage source={ONBOARDING_ART.welcome} contentFit="contain" style={{ width: width * .4, height: width * .48 }}/>
          </View>
          <Text maxFontSizeMultiplier={1.25} style={[st.description, { fontSize: bodySize, lineHeight: bodySize * 1.4, paddingHorizontal: m.padding, marginTop: width * .06 }]}>Build a cozy burrow together and grow closer every day.</Text>
        </ScrollView>
        {footer(<OnboardingButton label="Start" onPress={p.next}/>)}
      </OnboardingPage>
      {ONBOARDING_FEATURES.map((feature, index) => <OnboardingPage key={feature.id} id={feature.id} imageCount={1}>
        <ScrollView {...scrollProps} contentContainerStyle={{ minHeight: contentHeight }}>
          <View style={{ width, height: m.heroHeight, overflow: 'hidden' }}>
            <OnboardingImage source={feature.image} contentFit="cover" contentPosition="center" style={StyleSheet.absoluteFill}/>
            <Curve width={width} height={width * .16}/>
          </View>
          <View style={[st.featureCopy, { minHeight: Math.max(120, contentHeight - m.heroHeight), paddingHorizontal: m.padding }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.7} maxFontSizeMultiplier={1.3} style={[st.title, { fontSize: m.title, lineHeight: m.title * 1.2 }]}>{feature.title}</Text>
            <Text maxFontSizeMultiplier={1.3} style={[st.description, { fontSize: bodySize, lineHeight: bodySize * 1.35, marginTop: width * .045 }]}>{feature.description}</Text>
          </View>
        </ScrollView>
        {footer(<OnboardingButton label="Continue" onPress={p.next}/>, index)}
      </OnboardingPage>)}
      <OnboardingPage id="self-info" imageCount={1}>
        <KeyboardAvoidingView style={st.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView {...scrollProps} contentContainerStyle={{ minHeight: height - insets.bottom, backgroundColor: soil, paddingBottom: Math.max(24, insets.bottom) }}>
            <OnboardingImage source={ONBOARDING_ART.landscape} contentFit="cover" contentPosition="bottom" style={{ width, height: Math.min(height * .22, width * .47) }}/>
            <View style={{ paddingHorizontal: m.padding, flex: 1 }}>
              <Text style={[st.title, { fontSize: formTitle, color: cream, marginTop: width * .1, marginBottom: width * .1 }]}>Tell us a little bit</Text>
              {[['Your first name', p.firstName, p.setFirstName, 15], ['Partner’s nickname', p.partnerName, p.setPartnerName, 30]].map(([label, value, setter, length]) => <View key={label as string} style={st.formGroup}>
                <Text style={[st.label, { fontSize: Math.max(15, width * 36 / 900) }]}>{label as string}</Text>
                <View style={st.inputRow}><TextInput accessibilityLabel={label as string} value={value as string} onChangeText={setter as (v: string) => void} maxLength={length as number} placeholder="Type here" placeholderTextColor="#777" autoCapitalize="words" returnKeyType="done" style={st.input}/><MaterialIcons name="edit" size={24} color="#15100A"/></View>
              </View>)}
              <Text style={[st.label, { fontSize: Math.max(15, width * 36 / 900) }]}>When did you two fall in love?</Text>
              {p.dateInput}
              <View style={{ flex: 1, minHeight: width * .08 }}/>
              <OnboardingButton light label="Next" onPress={p.saveInfo} disabled={!p.validInfo}/>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </OnboardingPage>
      <OnboardingPage id="profile-photo" imageCount={0}>
        <ScrollView {...scrollProps} contentContainerStyle={{ minHeight: contentHeight, paddingHorizontal: m.padding, paddingTop: insets.top + width * .22 }}>
          <Text style={[st.title, { fontSize: formTitle }]}>Add a profile photo</Text>
          <Text style={[st.description, { fontSize: Math.max(16, width * 36 / 900), color: '#17110C', marginTop: width * .07 }]}>Your partner will see this as your photo in the app</Text>
          <View style={st.flex}/>
          <Pressable accessibilityRole="button" accessibilityLabel="Add a profile photo" onPress={p.choosePhoto} style={[st.photoCircle, { width: width * .25, height: width * .25, alignSelf: 'center' }]}>
            {p.photoUri ? <Image source={{ uri: p.photoUri }} style={StyleSheet.absoluteFill} contentFit="cover"/> : <MaterialIcons name="add-a-photo" size={width * .13} color="#FFF"/>}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={p.choosePhoto} style={[st.photoButton, { marginTop: width * .04 }]}><Text style={st.photoButtonText}>{p.photoUri ? 'Change photo' : 'Add a photo'}</Text></Pressable>
          <View style={[st.flex, { minHeight: 70 }]}/>
        </ScrollView>
        {skip(p.savePhoto)}{footer(<OnboardingButton label="Continue" onPress={p.savePhoto}/>)}
      </OnboardingPage>
      <OnboardingPage id="pairing" imageCount={1}>
        <ScrollView {...scrollProps} contentContainerStyle={{ minHeight: height, paddingHorizontal: m.padding, paddingTop: insets.top + width * .22, paddingBottom: insets.bottom + 32 }}>
          <OnboardingImage source={ONBOARDING_ART.invite} style={{ width: width * .32, height: width * .32, alignSelf: 'center' }} contentFit="contain"/>
          <Text style={[st.title, { fontSize: formTitle }]}>Invite your partner</Text>
          <Text style={[st.description, { fontSize: bodySize, marginTop: 10 }]}>Your little world starts with two.</Text>
          <View style={[st.inviteCard, { marginTop: width * .06 }]}>
            <Text style={st.idLabel}>Your ID</Text>
            <View style={st.codeRow}><Text adjustsFontSizeToFit numberOfLines={1} style={st.code}>{p.inviteCode ? `${p.inviteCode.slice(0, 3)}-${p.inviteCode.slice(3)}` : '···-···'}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Copy invite code" onPress={p.copyCode} disabled={!p.inviteCode} style={st.copy}><MaterialIcons name={p.copied ? 'check' : 'content-copy'} size={26} color={ink}/></Pressable></View>
            <OnboardingButton label="Share invite" onPress={p.shareCode} disabled={!p.inviteCode}/>
          </View>
          <Pressable accessibilityRole="button" onPress={p.openCode} style={{ marginTop: width * .07 }}><Text style={st.haveCode}>I have a code from {p.partnerName || 'my partner'}</Text></Pressable>
        </ScrollView>
        {skip(() => p.go('paywall'))}
      </OnboardingPage>
      <OnboardingPage id="pairing-success" imageCount={0}>
        <ScrollView {...scrollProps} contentContainerStyle={{ minHeight: contentHeight, paddingHorizontal: m.padding, backgroundColor: soil, justifyContent: 'center' }}>
          <Text style={[st.title, { fontSize: Math.min(34, width * 72 / 900), color: cream }]}>You’re Connected!</Text>
          <Text style={[st.description, { color: cream, fontSize: bodySize, marginTop: 12 }]}>You and {p.partner?.name || p.partnerName} now share a little world.</Text>
          <View style={[st.avatarRow, { marginVertical: width * .075 }]}>
            <View style={st.person}><Image source={p.photoUri ? { uri: p.photoUri } : p.defaultAvatar} contentFit="cover" style={[st.avatar, { width: width * .23, height: width * .23 }]}/><Text style={st.personName}>You</Text></View>
            <MaterialIcons name="favorite" size={width * .09} color="#FF8A92"/>
            <View style={st.person}><View style={st.partnerAvatar}><UserAvatar userId={p.partner?.userId} avatarUrl={p.partner?.avatarUrl} isDefaultAvatar={p.partner?.isDefaultAvatar} size={width * .23 - 6}/></View><Text style={st.personName}>{p.partner?.name || p.partnerName}</Text></View>
          </View>
          <Text style={[st.description, { color: '#DDCABB', fontSize: Math.max(15, width * 36 / 900) }]}>Decorate, play, and make memories together.</Text>
        </ScrollView>
        {footer(<OnboardingButton light label="Continue" onPress={() => p.go('paywall')}/>, -1, soil)}
      </OnboardingPage>
      <OnboardingPage id="paywall" imageCount={0}>
        <GridBackground base="#FAECD8" line="#F0DFC6" cell={width * .06} lineWidth={.7}/>
        <ScrollView {...scrollProps} contentContainerStyle={{ paddingHorizontal: m.padding, paddingTop: insets.top + width * .2, paddingBottom: 20 }}>
          <Text style={[st.title, { fontSize: Math.min(26, width * 51 / 900), paddingHorizontal: 12, marginBottom: width * .08 }]}>Feel closer through the little things.</Text>
          <View pointerEvents="none" style={{ alignSelf: 'center', zIndex: 1, marginBottom: -width * .07 }}><PlusBenefitIcon kind={6} size={width * .12}/></View>
          <LinearGradient colors={['#57311E', '#482415', '#63351F']} style={[st.plusCard, { padding: width * .035, paddingTop: width * .065, borderRadius: width * .055 }]}>
            <Text style={[st.title, { fontSize: Math.min(26, width * 46 / 900), color: cream, marginBottom: 10 }]}>Burrow Plus</Text>
            {BENEFITS.map(([, title, description], index) => <View key={title} style={[st.benefit, index < BENEFITS.length - 1 && st.benefitDivider, { paddingVertical: width * .027 }]}>
              <PlusBenefitIcon kind={index} size={width * .095}/>
              <View style={st.flex}><Text style={[st.benefitTitle, { fontSize: Math.max(14, width * 30 / 900) }]}>{title}</Text><Text style={[st.benefitBody, { fontSize: Math.max(12, width * 26 / 900) }]}>{description}</Text></View>
            </View>)}
          </LinearGradient>
        </ScrollView>
        <View style={{ paddingHorizontal: m.padding, paddingTop: 10, paddingBottom: Math.max(12, insets.bottom), backgroundColor: '#FAECD8' }}>
          <OnboardingButton label={p.pricing ? p.pricing.yearlyTrialEligible ? 'Try For Free' : 'Continue' : p.priceError ? 'Retry prices' : 'Continue'} onPress={p.tryFree} busy={p.openingPlans}/>
          <Pressable accessibilityRole="button" onPress={p.restore} disabled={p.restoring} style={st.restore}><Text style={st.restoreText}>{p.restoring ? 'Restoring…' : 'Restore purchases'}</Text></Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Plus offer" onPress={p.finish} disabled={p.finishing} style={[st.close, { top: insets.top + 12, right: m.padding }]}>{p.finishing ? <ActivityIndicator color={cream}/> : <MaterialIcons name="close" size={28} color={cream}/>}</Pressable>
      </OnboardingPage>
      <OnboardingPage id="plans" imageCount={0}>
        <ScrollView {...scrollProps} contentContainerStyle={{ minHeight: height, paddingHorizontal: m.padding, paddingTop: insets.top + 75, paddingBottom: insets.bottom + 18 }}>
          <Text style={[st.title, { fontSize: formTitle }]}>Choose your plan</Text>
          <Text style={[st.description, { fontSize: 16, marginVertical: 22 }]}>One subscription unlocks Plus for both of you.</Text>
          {(['yearly', 'monthly'] as const).map(plan => <Pressable accessibilityRole="button" accessibilityState={{ selected: plan === p.plan }} onPress={() => p.setPlan(plan)} key={plan} style={[st.plan, plan === p.plan && { borderColor: ink }]}>
            <Text style={st.planTitle}>{plan === 'yearly' ? '12 Months' : 'Monthly'}</Text>
            <Text style={st.planBody}>{p.pricing ? plan === 'yearly' ? `${p.pricing.yearly.displayPrice} (${p.pricing.yearlyPerMonth}/month)` : `${p.pricing.monthly.displayPrice} every month` : 'Price unavailable'}</Text>
            {plan === 'yearly' && p.pricing?.yearlyTrialEligible && <Text style={st.planBody}>3 Days Free Trial</Text>}
          </Pressable>)}
          {p.priceError && <Pressable onPress={p.retryPrices}><Text style={st.haveCode}>Retry prices</Text></Pressable>}
          <View style={{ flex: 1, minHeight: 40 }}/>
          <OnboardingButton label={p.plan === 'yearly' && p.pricing?.yearlyTrialEligible ? 'Start Free Trial' : 'Start My Plan'} onPress={p.purchase} busy={p.purchasing} disabled={!p.pricing}/>
          <Text style={st.disclosure}>{p.pricing ? p.plan === 'yearly' ? `Burrow Plus: ${p.pricing.yearly.displayPrice} per year${p.pricing.yearlyTrialEligible ? ' after a 3-day free trial' : ''}. ` : `Burrow Plus: ${p.pricing.monthly.displayPrice} per month. ` : ''}Auto-renews unless cancelled at least 24 hours before the period ends. Cancel anytime in your {Platform.OS === 'ios' ? 'App Store' : 'Google Play'} settings.</Text>
          <View style={st.legalRow}>{['Privacy', 'Terms'].map(label => <Pressable key={label} onPress={() => void Linking.openURL(`https://www.burrow-app.com/${label.toLowerCase()}`)}><Text style={st.restoreText}>{label}</Text></Pressable>)}</View>
        </ScrollView>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Plus offer" onPress={() => p.go('paywall')} disabled={p.purchasing} style={[st.close, { top: insets.top + 12, right: m.padding }]}><MaterialIcons name="close" size={28} color={cream}/></Pressable>
      </OnboardingPage>
      <OnboardingPage id="connect" imageCount={0}>{p.connectAccount}</OnboardingPage>
    </OnboardingPager>
    <Modal visible={p.pairCodeOpen} transparent statusBarTranslucent animationType="fade" onRequestClose={p.closeCode}>
      <KeyboardAvoidingView style={st.codeOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={st.codeSheet}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close code entry" onPress={p.closeCode} style={st.codeClose}><MaterialIcons name="close" size={28} color="#32215D"/></Pressable>
          <Text style={st.codeTitle}>Enter {p.partnerName || 'your partner'}’s Burrow code</Text>
          <View style={st.codeBoxes}>{Array.from({ length: 6 }, (_, i) => <View key={i} style={{ flexDirection: 'row', alignItems: 'center', flex: i === 2 ? 1.3 : 1 }}>
            <View style={[st.codeBox, p.pairCode.length === i && { borderColor: '#9163C5' }]}><Text style={st.codeChar}>{p.pairCode[i] || ''}</Text></View>{i === 2 && <Text style={st.codeDash}>-</Text>}
          </View>)}<TextInput accessibilityLabel="Partner’s six-character Burrow code" autoFocus value={p.pairCode} onChangeText={p.setPairCode} autoCapitalize="characters" autoCorrect={false} maxLength={8} returnKeyType="done" onSubmitEditing={p.pair} editable={!p.pairing} style={[StyleSheet.absoluteFill, { opacity: .02 }]}/></View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Pair with ${p.partnerName || 'your partner'}`} onPress={p.pair} disabled={p.pairCode.length !== 6 || p.pairing} style={[st.pairButton, (p.pairCode.length !== 6 || p.pairing) && { opacity: .45 }]}>{p.pairing ? <ActivityIndicator color="#FFF"/> : <Text style={st.buttonText}>Pair with {p.partnerName || 'your partner'}</Text>}</Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: cream }, flex: { flex: 1 },
  title: { fontFamily: 'Inter_800ExtraBold', color: ink, textAlign: 'center' },
  description: { fontFamily: 'Inter_400Regular', color: ink, textAlign: 'center', lineHeight: 26 },
  featureCopy: { justifyContent: 'center', paddingBottom: 15 }, footer: { paddingTop: 10, justifyContent: 'flex-end', backgroundColor: cream },
  buttonFill: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 12 },
  buttonText: { color: cream, fontFamily: 'Inter_700Bold', fontSize: 19, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 20 }, dot: { width: 9, height: 9, borderRadius: 5 },
  label: { color: cream, fontFamily: 'Inter_400Regular', marginBottom: 10 }, formGroup: { marginBottom: 20 },
  inputRow: { minHeight: 50, borderWidth: 1, borderColor: '#100C08', borderRadius: 9, backgroundColor: '#FFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15 },
  input: { flex: 1, minHeight: 50, fontSize: 16, fontFamily: 'Inter_600SemiBold', color: ink },
  skip: { position: 'absolute', zIndex: 4 }, skipText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#111', textDecorationLine: 'underline' },
  photoCircle: { backgroundColor: '#4E341B', borderRadius: 999, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoButton: { width: '58%', alignSelf: 'center', backgroundColor: '#FFC548', borderRadius: 10, paddingVertical: 15, alignItems: 'center' }, photoButtonText: { fontSize: 17, color: ink, fontFamily: 'Inter_700Bold' },
  inviteCard: { padding: 24, borderRadius: 24, backgroundColor: '#FAF0E1' }, idLabel: { fontSize: 16, color: ink, fontFamily: 'Inter_600SemiBold' },
  codeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 12 }, code: { flex: 1, fontSize: 40, color: ink, fontFamily: 'Inter_800ExtraBold' }, copy: { padding: 8, borderRadius: 9, backgroundColor: '#F3E4D0' },
  haveCode: { color: ink, fontSize: 17, fontFamily: 'Inter_700Bold', textDecorationLine: 'underline', textAlign: 'center' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 15 }, person: { alignItems: 'center' }, avatar: { borderRadius: 999, borderWidth: 3, borderColor: cream },
  partnerAvatar: { borderWidth: 3, borderColor: cream, borderRadius: 999, overflow: 'hidden' }, personName: { marginTop: 9, fontFamily: 'Inter_600SemiBold', color: cream, fontSize: 17 },
  plusCard: { marginTop: 10 }, benefit: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 10 }, benefitDivider: { borderBottomWidth: 1, borderColor: '#94705B' }, benefitTitle: { fontFamily: 'Inter_700Bold', color: cream }, benefitBody: { color: '#EADDD0', fontFamily: 'Inter_400Regular', marginTop: 4, lineHeight: 18 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#4D2D1F', alignItems: 'center', justifyContent: 'center', position: 'absolute' },
  restore: { alignSelf: 'center', paddingVertical: 13 }, restoreText: { color: ink, fontSize: 14, fontFamily: 'Inter_500Medium' },
  plan: { padding: 22, borderRadius: 18, borderWidth: 2, borderColor: '#E8D4BA', marginBottom: 18, backgroundColor: '#FFF5E5' }, planTitle: { fontFamily: 'Inter_700Bold', color: ink, fontSize: 22 }, planBody: { marginTop: 8, color: ink, fontFamily: 'Inter_500Medium', fontSize: 15 }, disclosure: { color: '#795E48', fontSize: 12, textAlign: 'center', marginTop: 14, lineHeight: 18 }, legalRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 12 },
  codeOverlay: { flex: 1, backgroundColor: '#3A211AAA', justifyContent: 'flex-end' }, codeSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 58, paddingBottom: 38 }, codeClose: { position: 'absolute', right: 16, top: 16 }, codeTitle: { color: '#32215D', fontFamily: 'Inter_800ExtraBold', fontSize: 24, textAlign: 'center' }, codeBoxes: { flexDirection: 'row', gap: 8, marginTop: 30 }, codeBox: { flex: 1, height: 44, borderWidth: 1, borderColor: '#BCB7C8', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, codeChar: { color: '#32215D', fontFamily: 'Inter_800ExtraBold', fontSize: 24 }, codeDash: { fontSize: 24, color: '#32215D', paddingLeft: 8 }, pairButton: { minHeight: 50, marginTop: 28, borderRadius: 99, backgroundColor: '#7153A1', alignItems: 'center', justifyContent: 'center' },
});

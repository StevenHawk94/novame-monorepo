import type { ReactNode } from 'react';
import {ChooseBunnyPage} from './choose-bunny-page';
import type {BunnyVariant} from '@/lib/bunny-identity-model';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BurrowPaywallPage } from '@/components/paywall/burrow-paywall-page';
import type { StoreSubscriptionPricing } from '@/lib/iap';
import { ONBOARDING_ART, ONBOARDING_CREAM as cream, ONBOARDING_INK as ink, ONBOARDING_FEATURES, ONBOARDING_FLOW, onboardingMetrics, onboardingFeatureMetrics, onboardingWelcomeMetrics, type OnboardingStep } from '@/lib/burrow-onboarding-design';
import { OnboardingImage, OnboardingPage, OnboardingPager } from './onboarding-pager';
import { PairingCodeSheet, PairingConnectedPage, PairingInviteCard } from './partner-pairing-ui';

type Partner = { userId?: string; name: string; avatarUrl?: string; isDefaultAvatar?: boolean };
export type BurrowOnboardingProps = {
  bunny:BunnyVariant;setBunny:(value:BunnyVariant)=>void;continueBunny:()=>void;
  step: OnboardingStep; next: () => void; go: (step: OnboardingStep) => void;
  firstName: string; setFirstName: (value: string) => void;
  dateInput: ReactNode; validInfo: boolean; saveInfo: () => void;
  validDate: boolean; saveDate: () => void;
  photoUri?: string; selfUserId?:string|null; choosePhoto: () => void; savePhoto: () => void; openingPairing: boolean;
  inviteCode: string | null; copied: boolean; copyCode: () => void; shareCode: () => void;
  pairCodeOpen: boolean; openCode: () => void; closeCode: () => void; pairCode: string; setPairCode: (value: string) => void;
  pairing: boolean; pair: () => void; partner: Partner | null;
  finish: () => void; finishing: boolean;
  pricing: StoreSubscriptionPricing | null; priceError: boolean; retryPrices: () => void;
  tryFree: () => void; openingPlans: boolean; plan: 'yearly' | 'monthly'; setPlan: (value: 'yearly' | 'monthly') => void;
  purchase: () => void; purchasing: boolean; restore: () => void; restoring: boolean;
  connectAccount: ReactNode;
};

export function OnboardingButton({ label, onPress, light = false, disabled = false, busy = false, weight = 'bold' }: {
  label: string; onPress: () => void; light?: boolean; disabled?: boolean; busy?: boolean; weight?: 'medium'|'bold';
}) {
  const { width } = useWindowDimensions();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy }}
    disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [{ minHeight: Math.max(50, width * 125 / 900), borderRadius: 99, overflow: 'hidden' }, (disabled || busy) && { opacity: .5 }, pressed && { opacity: .85, transform: [{ scale: .985 }] }]}>
    <LinearGradient colors={light ? ['#FFF5E1', '#FFF5E1'] : ['#64351E', '#4B2717', '#63331C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.buttonFill}>
      {busy ? <ActivityIndicator color={light ? ink : cream}/> : <Text maxFontSizeMultiplier={1.3} style={[st.buttonText, { fontSize: Math.min(23, width * 44 / 900), color: light ? ink : cream, fontFamily:weight==='medium'?'Inter_500Medium':'Inter_700Bold' }]}>{label}</Text>}
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
export function BurrowOnboardingPages(p: BurrowOnboardingProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const m = onboardingMetrics(width, height, insets.top, insets.bottom);
  const featureLayout = onboardingFeatureMetrics(width, height, insets.top, insets.bottom);
  const welcomeLayout = onboardingWelcomeMetrics(width,height);
  const idx = ONBOARDING_FLOW.indexOf(p.step);
  const nextPage = p.step === 'pairing' ? 'paywall' : p.step === 'paywall' ? 'plans' : ONBOARDING_FLOW[idx + 1] ?? null;
  const bodySize = m.body, formTitle = Math.min(31, width * 64 / 900);
  const contentHeight = height - m.footer;
  const footer = (button: ReactNode, dots = -1, backgroundColor = cream) => <View style={[st.footer, { backgroundColor, paddingHorizontal: m.padding, paddingBottom: Math.max(18, insets.bottom + 12), minHeight: dots>=0?featureLayout.footer:m.footer }]}>
    {button}{dots >= 0 && <View accessibilityRole="text" accessibilityLabel={`Page ${dots+1} of ${ONBOARDING_FEATURES.length}`} style={st.dots}>{ONBOARDING_FEATURES.map((item, i) => <View key={item.id} style={[st.dot, { backgroundColor: i === dots ? '#59311D' : '#E1C7AC' }]}/>)}</View>}
  </View>;
  const scrollProps = { style: st.flex, removeClippedSubviews: false, showsVerticalScrollIndicator: false, keyboardShouldPersistTaps: 'handled' as const };
  const skip = (onPress: () => void) => <Pressable accessibilityRole="button" accessibilityLabel="Skip" onPress={onPress} hitSlop={12} style={[st.skip, { top: insets.top + 12, right: m.padding }]}><Text style={st.skipText}>SKIP</Text></Pressable>;
  return <View style={st.root}>
    <StatusBar key={p.step} style={p.step === 'pairing-success' ? 'light' : 'dark'}/>
    <OnboardingPager requestedPage={p.step} nextPage={nextPage}>
      <OnboardingPage id="start" imageCount={2}>
        <ScrollView {...scrollProps} contentContainerStyle={{ minHeight: contentHeight }}>
          <View pointerEvents="none" style={{ position: 'absolute', top: height * .43, width, height: width * .16 }}><Curve width={width} height={width * .16}/></View>
          <OnboardingImage source={ONBOARDING_ART.wordmark} contentFit="contain" contentPosition="center" style={{ position:'absolute',top:welcomeLayout.wordmarkTop,left:(width-welcomeLayout.wordmarkWidth)/2,width:welcomeLayout.wordmarkWidth,height:welcomeLayout.wordmarkHeight }}/>
          <OnboardingImage source={ONBOARDING_ART.welcome} contentFit="contain" contentPosition="center" style={{ position:'absolute',top:welcomeLayout.bunnyTop,left:(width-welcomeLayout.bunnyWidth)/2,width:welcomeLayout.bunnyWidth,height:welcomeLayout.bunnyHeight }}/>
          <Text maxFontSizeMultiplier={1.25} style={[st.description, { position:'absolute',top:welcomeLayout.copyTop,width, fontSize: bodySize, lineHeight: bodySize * 1.4, paddingHorizontal: m.padding }]}>Build a cozy burrow together and grow closer every day.</Text>
        </ScrollView>
        {footer(<OnboardingButton label="Start" onPress={p.next}/>)}
      </OnboardingPage>
      {ONBOARDING_FEATURES.map((feature, index) => <OnboardingPage key={feature.id} id={feature.id} imageCount={1}>
        <ScrollView {...scrollProps} contentContainerStyle={{ minHeight: height-featureLayout.footer, paddingTop: featureLayout.artTop }}>
          <View style={{ width: featureLayout.artWidth, height: featureLayout.artHeight, alignSelf: 'center' }}>
            <OnboardingImage source={feature.image} contentFit="contain" contentPosition="center" style={StyleSheet.absoluteFill}/>
          </View>
          <View style={[st.featureCopy, { marginTop: featureLayout.titleTop - featureLayout.artTop - featureLayout.artHeight, paddingHorizontal: m.padding }]}>
            <Text numberOfLines={1} maxFontSizeMultiplier={1} style={[st.title, { fontSize: featureLayout.title, lineHeight: featureLayout.title * 1.2 }]}>{feature.title}</Text>
            <Text maxFontSizeMultiplier={1.3} style={[st.description, { fontSize: bodySize, lineHeight: bodySize * 1.35, marginTop: featureLayout.copyGap }]}>{feature.description}</Text>
          </View>
        </ScrollView>
        {footer(<OnboardingButton label="Continue" onPress={p.next} weight="medium"/>, index)}
      </OnboardingPage>)}
      <OnboardingPage id="self-info" imageCount={0}>
        <KeyboardAvoidingView style={st.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* Android already resizes the native window. Do not subtract the
              keyboard twice or force a full-screen minimum inside this view. */}
          <ScrollView {...scrollProps} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: m.padding, paddingTop: insets.top + 20, paddingBottom: 20, justifyContent: 'center' }}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={[st.title, { fontSize: formTitle }]}>What should we call you?</Text>
            <Text style={[st.description, { color: '#9B806A', fontSize: Math.max(15, width * 34 / 900), marginTop: 8 }]}>Your partner will see this name.</Text>
            <Text style={[st.nameLabel, { marginTop: width * .09 }]}>Your name</Text>
            <View style={st.nameInputRow}>
              <TextInput accessibilityLabel="Your name" value={p.firstName} onChangeText={p.setFirstName} maxLength={20} placeholder="Your name" placeholderTextColor="#B09B87" autoCapitalize="words" autoCorrect={false} returnKeyType="done" onSubmitEditing={p.saveInfo} style={st.nameInput}/>
              <Text style={st.nameCounter}>{p.firstName.length}/20</Text>
            </View>
          </ScrollView>
          {footer(<><Text style={[st.description, st.laterHint]}>You can change this later.</Text><OnboardingButton label="Continue" onPress={p.saveInfo} disabled={!p.validInfo}/></>)}
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
      <OnboardingPage id="relationship-date" imageCount={0}>
        <View style={{ flex: 1, paddingHorizontal: m.padding, paddingTop: insets.top, justifyContent: 'center' }}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={[st.title, { fontSize: formTitle }]}>When did your story begin?</Text>
          <Text style={[st.description, { fontSize: Math.max(16, width * 36 / 900), marginTop: 12, marginBottom: width * .08 }]}>Choose the day you became a couple.</Text>
          {p.dateInput}
          <Text style={[st.description, st.dateHint]}>An approximate date is okay.</Text>
        </View>
        {footer(<>
          {p.openingPairing && <Text accessibilityLiveRegion="polite" style={[st.description, { fontSize: 14, marginBottom: 10 }]}>Preparing your invite…</Text>}
          <OnboardingButton label="Continue" onPress={p.saveDate} busy={p.openingPairing} disabled={!p.validDate}/>
        </>)}
      </OnboardingPage>
      <OnboardingPage id="choose-bunny" imageCount={0}>
        <ChooseBunnyPage value={p.bunny} onChange={p.setBunny}/>
        {footer(<OnboardingButton label="Continue" onPress={p.continueBunny} busy={p.openingPairing}/>)}
      </OnboardingPage>
      <OnboardingPage id="pairing" imageCount={0}>
        <ScrollView {...scrollProps} contentContainerStyle={{ flexGrow: 1, minHeight: height, paddingHorizontal: m.padding, paddingTop: insets.top + 56, paddingBottom: insets.bottom + 40, justifyContent: 'center' }}>
          <Text style={[st.title, { fontSize: formTitle }]}>Invite your partner</Text>
          <Text style={[st.description, { fontSize: bodySize, marginTop: 10 }]}>Your little world starts with two.</Text>
          <View style={{marginTop:width*.09}}><PairingInviteCard inviteCode={p.inviteCode} copied={p.copied} copyCode={p.copyCode} shareCode={p.shareCode} openCode={p.openCode}/></View>
        </ScrollView>
        {skip(() => p.go('paywall'))}
      </OnboardingPage>
      <OnboardingPage id="pairing-success" imageCount={0}>
        <PairingConnectedPage partner={p.partner??{name:'your partner'}} selfPhotoUri={p.photoUri} self={{userId:p.selfUserId??undefined,name:p.firstName}} onContinue={()=>p.go('paywall')}/>
      </OnboardingPage>
      <OnboardingPage id="paywall" imageCount={10}>
        <BurrowPaywallPage phase="benefits" imageComponent={OnboardingImage} pricing={p.pricing} priceError={p.priceError} plan={p.plan} onSelectPlan={p.setPlan}
          onClose={p.finish} onBack={() => p.go('paywall')} onContinue={p.tryFree} onPurchase={p.purchase}
          onRestore={p.restore} onRetry={p.retryPrices} openingPlans={p.openingPlans} purchasing={p.purchasing} restoring={p.restoring} closing={p.finishing}/>
      </OnboardingPage>
      <OnboardingPage id="plans" imageCount={1}>
        <BurrowPaywallPage phase="plans" imageComponent={OnboardingImage} pricing={p.pricing} priceError={p.priceError} plan={p.plan} onSelectPlan={p.setPlan}
          onClose={p.finish} onBack={() => p.go('paywall')} onContinue={p.tryFree} onPurchase={p.purchase}
          onRestore={p.restore} onRetry={p.retryPrices} openingPlans={p.openingPlans} purchasing={p.purchasing} restoring={p.restoring} closing={p.finishing}/>
      </OnboardingPage>
      <OnboardingPage id="connect" imageCount={0}>{p.connectAccount}</OnboardingPage>
    </OnboardingPager>
    <PairingCodeSheet visible={p.pairCodeOpen} code={p.pairCode} onChange={p.setPairCode} onClose={p.closeCode} onPair={p.pair} pairing={p.pairing}/>
  </View>;
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: cream }, flex: { flex: 1 },
  title: { fontFamily: 'Inter_800ExtraBold', color: ink, textAlign: 'center' },
  description: { fontFamily: 'Inter_400Regular', color: ink, textAlign: 'center', lineHeight: 26 },
  featureCopy: { paddingBottom: 24 }, footer: { paddingTop: 10, justifyContent: 'flex-end', backgroundColor: cream },
  buttonFill: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 12 },
  buttonText: { color: cream, fontFamily: 'Inter_700Bold', fontSize: 19, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 20 }, dot: { width: 9, height: 9, borderRadius: 5 },
  nameLabel: { color: ink, fontFamily: 'Inter_600SemiBold', fontSize: 16, marginBottom: 9 },
  nameInputRow: { minHeight: 58, borderRadius: 18, backgroundColor: '#F5E8D7', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  nameInput: { flex: 1, minHeight: 58, fontSize: 19, fontFamily: 'Inter_500Medium', color: ink }, nameCounter: { fontSize: 13, color: '#9B806A' },
  laterHint: { color: '#9B806A', fontSize: 14, marginBottom: 12 }, dateHint: { color: '#9B806A', fontSize: 14, marginTop: 14 },
  skip: { position: 'absolute', zIndex: 4 }, skipText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#111', textDecorationLine: 'underline' },
  photoCircle: { backgroundColor: '#4E341B', borderRadius: 999, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoButton: { width: '58%', alignSelf: 'center', backgroundColor: '#FFC548', borderRadius: 10, paddingVertical: 15, alignItems: 'center' }, photoButtonText: { fontSize: 17, color: ink, fontFamily: 'Inter_700Bold' },
  haveCode: { color: ink, fontSize: 17, fontFamily: 'Inter_700Bold', textDecorationLine: 'underline', textAlign: 'center' },
});

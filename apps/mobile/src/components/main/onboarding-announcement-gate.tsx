import {StyleSheet,View} from 'react-native';
import {useOnboardingAnnouncementEntry,closeOnboardingAnnouncement} from '@/lib/onboarding-announcement-entry';
import {AnnouncementLaunchGate} from './announcement-launch-gate';
import {BurrowLaunchScreen} from './burrow-launch-screen';
export function OnboardingAnnouncementGate(){
 const entry=useOnboardingAnnouncementEntry();
 if(entry.phase==='idle')return null;
 if(entry.phase==='ready'&&entry.announcement&&entry.userId)return <AnnouncementLaunchGate key={entry.announcement.id} announcement={entry.announcement} userId={entry.userId} onClose={closeOnboardingAnnouncement}/>;
 return <View style={styles.cover} accessibilityViewIsModal><BurrowLaunchScreen/></View>;
}
const styles=StyleSheet.create({cover:{...StyleSheet.absoluteFillObject,zIndex:10000,elevation:10000}});

import {Redirect} from 'expo-router';
import {CoupleJournalScreen} from '@/components/burrow/couple-journal-screen';
import {useMajorUpdateEnabled} from '@/lib/use-major-update';
export default function JournalHistory(){
 const enabled=useMajorUpdateEnabled();
 return enabled?<CoupleJournalScreen historyPage/>:<Redirect href="/(main)/(tabs)"/>;
}

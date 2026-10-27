// Native UI-only fixture: no real account, orders or production transport.
import {useNavigation} from '@react-navigation/native';
export const useLocalSearchParams=()=>({});
export function useRouter(){const n=useNavigation();return{back:()=>n.goBack(),replace:()=>n.replace('done'),dismiss:()=>n.navigate('entry')};}
export {useNavigation};
const data={profile:{id:'11111111-1111-4111-8111-111111111111'},partner:null,pairVersion:null,adventureCollection:{enabled:false}};
export const useBurrowSnapshot=()=>({data});
export const getBurrowSnapshot=()=>({data,receivedAt:performance.now()});
export const useBurrowSelector=select=>select({data});
export const burrowClock=()=>performance.now();
export const queueAdventureJournal=()=> 'ui-only-job';
export const useAdventureJournalJob=()=>({id:'ui-only-job'});
export const presentAdventureJournalReward=()=>{};
export const requestAdventureJournalStart=()=>true;
export const retryAdventureJournalJob=()=>{};

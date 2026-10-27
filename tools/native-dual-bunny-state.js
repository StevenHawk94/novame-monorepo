// Offline test-shell domain boundaries; rendering uses actual product widgets.
export const burrowClock=()=>performance.now();
export const getBurrowSnapshot=()=>({data:null});
export const useAdventureJournalJob=()=>undefined;
export const retryAdventureJournalJob=()=>{};
export const useAdventureNudge=()=> 'idle';
export const queueAdventureNudge=()=>{};
export const apiClient={get:async()=>{throw Error('Production business API prohibited in native QA');},post:async()=>{throw Error('Production business API prohibited in native QA');}};
const values=new Map();
export const storage={getString:k=>values.get(k),getAllKeys:()=>[...values.keys()],set:(k,v)=>values.set(k,v),remove:k=>values.delete(k),addOnValueChangedListener:()=>({remove(){}})};
export const mmkv=storage;

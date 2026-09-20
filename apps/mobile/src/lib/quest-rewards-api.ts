import { apiClient } from './api';
import { subscribeSessionIdentity } from './session-lifecycle';
import { supabase } from './supabase';
import { storage } from './storage';

export type DailyRewardQuest = {
  key: string;
  title: string;
  route: string;
  reward: number;
  done: boolean;
  claimed: boolean;
  claimKey: string;
};

export type SpecialRewardQuest = {
  key: string;
  title: string;
  subtitle: string;
  count: number;
  reward: number;
  step: number;
  achievedMilestones: number;
  nextMilestone: number | null;
  progress: number;
  progressTarget: number;
  available: number | null;
  complete: boolean;
};

export type QuestRewardStatus = {
  localDate: string;
  cloversEarned: number;
  daily: DailyRewardQuest[];
  special: SpecialRewardQuest[];
};

const CACHE_KEY='novame_quest_rewards_v2';
let inflight:Promise<QuestRewardStatus>|null=null;
const EMPTY:QuestRewardStatus={localDate:'',cloversEarned:0,daily:[],special:[]};

subscribeSessionIdentity(() => {
  inflight=null;
  storage.remove(CACHE_KEY);
});

export function getCachedQuestRewards():QuestRewardStatus {
  const raw=storage.getString(CACHE_KEY);
  if (!raw) return EMPTY;
  try {
    const parsed=JSON.parse(raw) as QuestRewardStatus;
    return {...parsed,cloversEarned:0};
  } catch {
    return EMPTY;
  }
}

export async function fetchQuestRewards():Promise<QuestRewardStatus> {
  if (inflight) return inflight;
  inflight=(async()=>{
    try {
      const {data}=await supabase.auth.getSession();
      const userId=data.session?.user?.id;
      if (!userId) return getCachedQuestRewards();
      const result=await apiClient.get<QuestRewardStatus&{success?:boolean}>(
        `/api/quests/rewards?userId=${encodeURIComponent(userId)}`,
      );
      if (!result.success) return getCachedQuestRewards();
      const status:QuestRewardStatus={
        localDate:result.localDate,
        cloversEarned:result.cloversEarned||0,
        daily:result.daily||[],
        special:result.special||[],
      };
      storage.set(CACHE_KEY,JSON.stringify({...status,cloversEarned:0}));
      return status;
    } catch {
      return getCachedQuestRewards();
    } finally {
      inflight=null;
    }
  })();
  return inflight;
}

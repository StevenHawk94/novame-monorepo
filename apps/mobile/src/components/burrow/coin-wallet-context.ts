import {createContext,useContext} from 'react';
import type {SharedValue} from 'react-native-reanimated';
import type {CoinRewardBatch} from '@/lib/coin-reward-store';
export type WalletMotion={count:SharedValue<number>;pulse:SharedValue<number>;elapsed:SharedValue<number>;
  batch:CoinRewardBatch|null;balance:number|null;reduced:boolean};
export const CoinWalletContext=createContext<WalletMotion|null>(null);
export const useWalletMotion=()=>useContext(CoinWalletContext);

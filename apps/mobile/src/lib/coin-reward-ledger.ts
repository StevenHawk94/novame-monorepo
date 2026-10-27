export type CoinWallet = { balance: number; version: number };
export type CoinWalletState = {
  wallet: CoinWallet;
  localDate: string;
  timezone: string;
  serverNow: string;
  credits: { key: string; amount: number; reason?: string }[];
  spends?: string[];
};
type Credit = { key: string; amount: number; settledAt: number | null };

/** Presentation projections only. Spending is always authorized by the server. */
export class CoinRewardLedger {
  wallet: CoinWallet | null = null;
  context: CoinWalletState | null = null;
  readonly pending = new Map<string, Credit>();
  readonly presented = new Set<string>();
  readonly pendingSpends = new Map<string, {amount:number;version?:number}>();
  private included = new Map<string, number>();
  private confirmedGrants = new Set<string>();
  private latestSettlement = 0;

  get balance(): number | null {
    if (!this.wallet) return null;
    const pending=[...this.pending.values()].reduce((sum,credit)=>sum+(this.included.has(credit.key)?0:credit.amount),0);
    // Reward projections obey the reward cap after EVERY concurrent snapshot.
    // Do not truncate real purchased balances (which may exceed that cap).
    const spending=[...this.pendingSpends.values()].reduce((sum,spend)=>sum+spend.amount,0);
    return Math.max(this.wallet.balance,Math.min(99999,this.wallet.balance+pending))-spending;
  }
  projectSpend(key:string,amount:number){
    if(!Number.isSafeInteger(amount)||amount<=0||this.context?.spends?.includes(key)||this.pendingSpends.has(key))return;
    this.pendingSpends.set(key,{amount});
  }
  settleSpend(key:string,wallet?:CoinWallet){
    const spend=this.pendingSpends.get(key);if(!spend)return;
    if(wallet&&this.wallet&&this.wallet.version>=wallet.version)this.pendingSpends.delete(key);
    else if(wallet)this.pendingSpends.set(key,{...spend,version:wallet.version});
  }
  rejectSpend(key:string){this.pendingSpends.delete(key);}
  has(key: string) { return this.included.has(key) || this.confirmedGrants.has(key) || [...this.pending.values()].some(value => value.key === key); }
  visibleBalance(hidden:Map<string,{key:string|null;amount:number;released:boolean}>){
    if(this.balance===null||!this.wallet)return null;
    let withheld=0,room=Math.max(0,99999-this.wallet.balance);
    for(const [id,credit] of this.pending){
      if(this.included.has(credit.key))continue;
      const effective=Math.min(room,credit.amount);room-=effective;
      if(hidden.has(id)&&!hidden.get(id)!.released)withheld+=effective;
    }
    for(const d of hidden.values())if(!d.released&&d.key&&this.included.has(d.key))withheld+=this.included.get(d.key)!;
    return this.balance-withheld;
  }
  begin(id: string, key: string, amount: number) {
    if (!this.wallet || this.pending.has(id) || this.has(key) || !Number.isSafeInteger(amount) || amount <= 0) return 0;
    amount = Math.min(amount, Math.max(0, 99999 - this.balance!));
    if (!amount) return 0;
    this.pending.set(id, { key, amount, settledAt: null });
    return amount;
  }
  /** Version + included keys form one snapshot; never accept a stale pair. */
  sync(state: CoinWalletState) {
    if (!Number.isSafeInteger(state?.wallet?.balance) || !Number.isSafeInteger(state?.wallet?.version)
      || !Array.isArray(state.credits) || (this.wallet && state.wallet.version < this.wallet.version)) return;
    this.wallet = state.wallet;
    this.context = state;
    this.included = new Map(state.credits.map(credit => [credit.key, credit.amount]));
    for(const [key,spend] of this.pendingSpends)if(state.spends?.includes(key)||(spend.version!==undefined&&state.wallet.version>=spend.version))this.pendingSpends.delete(key);
    for (const [id, credit] of this.pending) if (this.included.has(credit.key)) this.pending.delete(id);
  }
  /** Compatibility while API and migration roll out independently. Freeze a
   * legacy read during overlapping writes; a read begun after ALL settlements
   * can safely replace their temporary projections as a group. */
  syncLegacy(wallet: CoinWallet, readStartedAt: number) {
    if (!wallet || !Number.isSafeInteger(wallet.balance) || !Number.isSafeInteger(wallet.version)
      || (this.wallet && wallet.version < this.wallet.version)) return;
    // A legacy wallet has no included-spend keys. During an unknown debit its
    // version alone cannot tell whether that debit is already included.
    if([...this.pendingSpends.values()].some(spend=>spend.version===undefined))return;
    if (this.pending.size && ([...this.pending.values()].some(credit => credit.settledAt === null)
      || readStartedAt <= this.latestSettlement)) return;
    this.wallet = wallet;
    for(const [key,spend] of this.pendingSpends)if(spend.version!==undefined&&wallet.version>=spend.version)this.pendingSpends.delete(key);
    this.pending.clear();
  }
  settle(id: string, key: string, amount: number, now: number) {
    this.latestSettlement = Math.max(this.latestSettlement, now);
    if (amount > 0) this.confirmedGrants.add(key);
    const existing = this.pending.get(id);
    if (existing) {
      if (amount > 0) this.pending.set(id, { ...existing, amount, settledAt: now });
      else this.pending.delete(id);
    } else if (amount > 0 && !this.included.has(key)) {
      this.pending.set(id, { key, amount, settledAt: now });
    }
  }
  fail(id: string, now: number) { this.pending.delete(id); this.latestSettlement = Math.max(this.latestSettlement, now); }
}

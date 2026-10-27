export type BunnyVariant='biscuit'|'pinky';
export type BunnyIdentity={userId:string;variant:BunnyVariant|null;revision:number;finalized:boolean;
 partnerId:string|null;partnerVariant:BunnyVariant|null;pairVersion:string|null};
export const isBunnyVariant=(v:unknown):v is BunnyVariant=>v==='biscuit'||v==='pinky';
export function identityIsCurrent(value:BunnyIdentity,owner:string,partner:string|null,pairVersion:string|null){
 return value.userId===owner&&value.partnerId===partner&&value.pairVersion===pairVersion
  &&Number.isSafeInteger(value.revision)&&value.revision>=0&&(value.variant===null||isBunnyVariant(value.variant));
}

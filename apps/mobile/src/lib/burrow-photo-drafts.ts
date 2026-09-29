import { storage } from './storage';
import { kBurrowPhotoDrafts } from '../shared/storage/keys';
export type PhotoDraftScope={userId:string;partnerId:string};
export type PhotoDraft={base64:string;key:string;expectedPhotoId:string|null;savedAt:number};
const key=(scope:PhotoDraftScope)=>`${kBurrowPhotoDrafts.prefix}${scope.userId}:${scope.partnerId}`;
function read(scope:PhotoDraftScope):Record<string,PhotoDraft>{
  const raw=storage.getString(key(scope));if(!raw)return {};
  try{const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length>5)throw Error();
    for(const d of Object.values(parsed) as PhotoDraft[])if(!d||typeof d.base64!=='string'||d.base64.length>1_400_000||typeof d.key!=='string'||!Number.isFinite(d.savedAt))throw Error();
    return parsed;
  }catch{throw Error('photo_draft_unavailable');}
}
export function readPhotoDraft(scope:PhotoDraftScope,target:string){return read(scope)[target]??null;}
export function persistPhotoDraft(scope:PhotoDraftScope,target:string,draft:PhotoDraft){
  const drafts=read(scope);
  if(!draft.base64||draft.base64.length>1_400_000)throw Error('photo_too_large');
  if(!drafts[target]&&Object.keys(drafts).length>=5)throw Error('photo_drafts_full');
  drafts[target]=draft;storage.set(key(scope),JSON.stringify(drafts));
}
export function removePhotoDraft(scope:PhotoDraftScope,target:string,requestKey:string){
  const drafts=read(scope);if(drafts[target]?.key!==requestKey)return;
  delete drafts[target];storage.set(key(scope),JSON.stringify(drafts));
}

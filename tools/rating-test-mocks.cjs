// Unrelated API/UI tests isolate review presentation; real receipt/cadence
// behavior is exercised by test-official-rating-milestones.cjs.
const api={trackItemPurchaseForRating:promise=>promise,recordRatingMilestone(){},recordPhotoToyPlayForRating(){},
  canPresentRatingInline:()=>false,registerInlineAffectionRating:()=>()=>{},
  peekRatingMilestone:()=>null,consumeRatingMilestone(){},subscribeRatingMilestones:()=>()=>{}};
module.exports={'./official-rating-milestones':api,'@/lib/official-rating-milestones':api};

// Unrelated component tests isolate notification state. The real store and
// badge rendering are exercised separately in test-burrow-attention.cjs.
module.exports={
  ...require('./rating-test-mocks.cjs'),
  '@/lib/partner-pairing':{requirePartner:()=>false,showPartnerPairing(){}},
  '@/lib/use-partner-entry-gate':{usePartnerEntryGate(){}},
  '@/lib/use-burrow-environment':{useBurrowEnvironment:()=>({season:'autumn',period:'day',banner:'autumn-day',southern:false})},
  './bunny-actor':{BunnyActor:'BunnyActor'},
  './outfit-bunny':{OutfitBunny:'OutfitBunny'},
  '@/lib/bunny-idle-motion':{homeBunnyBox:scale=>({width:256*scale,height:294*scale,left:102*scale,top:1135*scale})},
  '@/lib/burrow-attention':{markBurrowUpdatesSeen(){},useNotificationContentReady:()=>true,dismissHomeLetterReminder(){},dismissAdventureReminder(){},burrowAttentionCounts:()=>({letter:0}),useBurrowAttention:()=>({letter:0,affection:0,adventure:0,rooms:{},tabs:{}}),beginQuestAttentionClaim:()=>()=>{}},
  '@/components/burrow/love-letter-inbox':{LoveLetterInbox:'LoveLetterInbox'},
  '@/components/burrow/love-note-screen':{LoveNoteScreen:'LoveNoteScreen'},
  './update-badge':{UpdateBadge:'UpdateBadge'},
  './home-love-letter':{HomeLoveLetter:'HomeLoveLetter'},
  './adventure-completion-screen':{AdventureCompletionScreen:'AdventureCompletionScreen'},
  './collection-room-screen':{CollectionRoomScreen:'CollectionRoomScreen'},
};

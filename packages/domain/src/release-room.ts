import pleasing from './release-room-dialogues/the_swallower.json';
import overthinking from './release-room-dialogues/overthinking.json';
import procrastination from './release-room-dialogues/procrastination.json';
import lost from './release-room-dialogues/the_fog.json';
import anxiety from './release-room-dialogues/the_spiral.json';
import doubt from './release-room-dialogues/the_hollow.json';
import comparison from './release-room-dialogues/the_comparer.json';
import isolation from './release-room-dialogues/the_wall.json';

export type ReleaseDialogue={id:string;number:number;angle:string;monster:string;replies:readonly string[]};
export const RELEASE_ROOM_MONSTERS=[
 {id:'the_swallower',name:'People-Pleasing',intro:'I worry too much about letting people down.'},
 {id:'overthinking',name:'Overthinking',intro:'I keep replaying everything that happened.'},
 {id:'procrastination',name:'Procrastination',intro:'I keep putting off what I need to do.'},
 {id:'the_fog',name:'Lost',intro:'I don’t know what I’m moving toward anymore.'},
 {id:'the_spiral',name:'Anxiety',intro:'I can’t shake the feeling that something might go wrong.'},
 {id:'the_hollow',name:'Self-Doubt',intro:'I keep wondering if I’m good enough.'},
 {id:'the_comparer',name:'Comparison',intro:'I can’t stop comparing myself to others.'},
 {id:'the_wall',name:'Isolation',intro:'I feel alone, even when people are around.'},
] as const;
export type ReleaseMonsterId=typeof RELEASE_ROOM_MONSTERS[number]['id'];
export const RELEASE_ROOM_DIALOGUES:Record<ReleaseMonsterId,readonly ReleaseDialogue[]>={
 the_swallower:pleasing,overthinking,procrastination,the_fog:lost,the_spiral:anxiety,the_hollow:doubt,the_comparer:comparison,the_wall:isolation,
};
export function releaseDialogue(id:ReleaseMonsterId,count:number){
 const rows=RELEASE_ROOM_DIALOGUES[id];return rows[Math.max(0,Math.floor(count))%rows.length];
}
export const RELEASE_VICTORY_COPY:Record<ReleaseMonsterId,readonly string[]>={
 the_swallower:[
  'The forced smile finally dropped. Underneath, it looks relieved.',
  'Its grin slipped away. The real face underneath is much softer.',
  'It stopped nodding along. For once, it just stood there.',
  'Its hands stopped fussing. Nobody needed anything from it.',
  'The smile it wore for everyone else faded. This one feels honest.',
 ],
 overthinking:[
  'Its hands finally came off its head. The noise got quieter.',
  'It let go of its head. The loop ran out of road.',
  'The spinning stopped. It’s just standing there, thinking nothing.',
  'Its shoulders dropped. Turns out the answer didn’t need ten more rounds.',
  'It stopped holding its head together. It was fine the whole time.',
 ],
 procrastination:[
  'It stopped slumping and sat up. Barely, but it counts.',
  'It pushed itself off the floor. One small move was enough.',
  'Its legs finally remembered they work. It’s getting up.',
  'It stopped waiting for the perfect moment and just began.',
  'The heavy blanket slid off. Something in it started moving.',
 ],
 the_fog:[
  'It stopped shrugging and pointed. Not far, just forward.',
  'Its arms came down. It doesn’t have the map, but it picked a direction.',
  'The shrug turned into a step. A small one, but a real one.',
  'It stopped asking “which way?” and started walking.',
  'It looked around and found one small thing worth heading toward.',
 ],
 the_spiral:[
  'The shaking slowed. Its arms finally loosened.',
  'It let out a breath it had been holding for ages.',
  'Its grip on itself softened. The ground feels steadier now.',
  'The trembling faded into a quiet hum. It’s okay to just stand.',
  'It unclenched, finger by finger. Nothing fell apart.',
 ],
 the_hollow:[
  'It stopped trembling and looked up for the first time.',
  'Its shoulders squared a little. It’s still small, but it’s standing.',
  'It stopped apologizing for taking up space.',
  'The shaking stopped. It realized it had been right more often than it thought.',
  'It lifted its head. The voice inside got quieter, and kinder.',
 ],
 the_comparer:[
  'It quit peeking at everyone else and looked at its own paws.',
  'Its hand came down from its head. It stopped scanning the crowd.',
  'It turned away from the others and noticed what it was holding.',
  'The side-eye stopped. Turns out its own path had a view too.',
  'It stopped keeping score. For once, it just looked at what’s here.',
 ],
 the_wall:[
  'It unfolded, just a little. Arms uncrossed, knees down.',
  'It lifted its head from its knees. The room is bigger than it thought.',
  'Its arms loosened. A small gap opened, just enough for someone to walk in.',
  'It stopped hiding and peeked out. Nobody turned away.',
  'The tight ball relaxed. It remembered it’s allowed to be found.',
 ],
};
export function releaseVictoryCopy(id:ReleaseMonsterId,completedCount:number){
 return RELEASE_VICTORY_COPY[id][Math.max(0,Math.floor(completedCount)-1)%5];
}

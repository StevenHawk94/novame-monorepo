/** Largest connected alpha silhouette (alpha >=16), in original 800px art.
 * Excludes transparent padding, detached impact marks and stray export pixels.
 * Pose normalization preserves aspect ratio; page-specific sizing is separate. */
export const MONSTER_GEOMETRY: Record<string, {normal:readonly [number,number,number,number];hit:readonly [number,number,number,number]}> = {
 overthinking:{normal:[241,121,378,598],hit:[232,121,387,599]},
 procrastination:{normal:[167,191,535,539],hit:[146,189,555,543]},
 the_spiral:{normal:[237,97,313,659],hit:[235,98,313,662]},
 the_comparer:{normal:[181,112,465,606],hit:[206,102,415,617]},
 the_wall:{normal:[184,112,420,615],hit:[176,106,434,622]},
 the_fog:{normal:[118,95,575,668],hit:[229,98,316,664]},
 the_hollow:{normal:[256,103,311,613],hit:[257,108,311,607]},
 the_swallower:{normal:[184,113,487,641],hit:[184,107,437,646]},
};
export type MonsterArtSurface='selection'|'preparation'|'battle';
/** Relative to the stage slots before the previous blanket 30% reduction.
 * Selection keeps that reduction, with the six smaller designs raised 10%.
 * Preparation grows from the last displayed size by 50% (two designs: 40%).
 * Battle is restored, never affected by card/preparation adjustments. */
export function monsterDisplayScale(id:string,surface:MonsterArtSurface){
 const largerDesign=id==='procrastination'||id==='the_wall';
 if(surface==='selection')return .7*(largerDesign?1:1.1);
 if(surface==='preparation')return .7*(largerDesign?1.4:1.5);
 return 1;
}
/** Fit the original square canvas uniformly inside the requested art viewport.
 * No hidden global multiplier: each surface explicitly selects its own size. */
export function monsterArtFrame(id:string,pose:'normal'|'hit',width:number,height:number){
 const [x,y,w,h]=MONSTER_GEOMETRY[id][pose],scale=Math.min(height/h,width/w);
 return {position:'absolute' as const,left:(width-w*scale)/2-x*scale,top:(height-h*scale)/2-y*scale,width:800*scale,height:800*scale};
}

/**
 * Tame Enemy battle decks (2026-08-05 design: text rows, no card art).
 *
 * Each monster has a fixed 10-argument deck. The battle lists them as text
 * rows (points icon + the argument's opening); tap opens the full text,
 * double-tap plays it. The first time an argument lands, the monster's
 * speech bubble becomes its persuaded line; replays deal damage silently.
 *
 * Damage split per deck: 5 ×1, 10 ×4, 15 ×3, 20 ×2 (indices 1..10).
 */
import type { ImageSourcePropType } from 'react-native';

/** Damage badge icons (assets/Icons/<n>-points.png), keyed by damage value. */
export const POINT_ICONS: Record<number, ImageSourcePropType> = {
  5: require('../../assets/Icons/5-points.png'),
  10: require('../../assets/Icons/10-points.png'),
  15: require('../../assets/Icons/15-points.png'),
  20: require('../../assets/Icons/20-points.png'),
  30: require('../../assets/Icons/30-points.png'),
};

/** Card damage by 1-based deck position. */
export const DECK_DAMAGE = [5, 10, 10, 10, 10, 15, 15, 15, 20, 20] as const;

export interface TameCard {
  /** Stable id, e.g. 'procrastination-3'. */
  cardId: string;
  monsterId: string;
  index: number;
  damage: number;
  /** Counter-argument shown on the card back (long-press). */
  argument: string;
  /** The monster's convinced line after this card first lands. */
  persuaded: string;
}

type Entry = { a: string; p: string };

const RAW: Record<string, Entry[]> = {
  procrastination: [
    { a: `Motivation follows action, not the other way around. You don't need to feel ready to begin—starting, even imperfectly, is what creates momentum. The version of you who finishes only exists after the version of you who starts, so stop waiting for a feeling that action alone can create.`,
      p: `That actually makes sense. I keep waiting to feel motivated first, but maybe motivation shows up after I start, not before it.` },
    { a: `There is no perfect moment to start—only the one you're avoiding right now. Waiting for ideal conditions is procrastination wearing a disguise, dressed up as patience. The right time was never going to arrive on its own; it's simply the time you finally decide to act.`,
      p: `I guess I've been telling myself 'not yet' for months now. Maybe there's no perfect moment coming—just this one, if I choose to take it.` },
    { a: `The task in your head is almost always heavier than the task in reality. Overestimating difficulty is how your mind protects you from discomfort, but it also quietly traps you in delay. Start, even for a moment, and watch that imagined weight begin to shrink.`,
      p: `You're right, I've been picturing this as way harder than it probably is. Maybe it'll feel lighter once I actually begin instead of just imagining it.` },
    { a: `You don't have to finish the whole thing—just commit to five minutes. Most resistance dissolves once you're already moving, because starting is almost always harder than continuing. Give yourself permission to stop after five minutes, and see if you still want to keep going anyway.`,
      p: `Five minutes feels genuinely doable. I think I can trick myself into starting if the bar is set that low, and see what happens after.` },
    { a: `Every hour you delay is borrowed from a future version of you who will have less time and more pressure to deal with it. Acting now, even imperfectly, is a quiet gift to the person you'll become tomorrow, who is already carrying enough.`,
      p: `That hits different, honestly. I keep pushing this onto future me, who's probably already going to be overwhelmed enough without this extra weight.` },
    { a: `Done is better than perfect, because perfect never actually ships. Progress compounds over time; perfection just delays it indefinitely. A finished, imperfect thing teaches you more about yourself than an unfinished, flawless idea ever possibly could.`,
      p: `I think I've been hiding behind 'doing it right' as a convenient excuse to not do it at all. Maybe finishing badly still beats not finishing.` },
    { a: `What looks like laziness is often fear of failing wearing a more comfortable, socially acceptable mask. Naming it as fear, not laziness, changes the fix—you don't need more willpower, you need permission to fail and try again anyway.`,
      p: `Honestly, I don't think I'm lazy—I think I'm scared it won't be good enough. That's a much easier thing to actually admit to myself.` },
    { a: `Waiting to 'feel ready' keeps you stuck, because readiness is built by doing, not by waiting around for it to appear. Every rep of starting, even a small one, trains your brain to associate action with less resistance the next time around.`,
      p: `Maybe readiness isn't something I find before starting—it's something I actually build by starting anyway, even when it feels uncomfortable.` },
    { a: `Motivation is unreliable, but discipline shows up even on the days you don't feel like it at all. You don't need to want to do it—you just need a small system that carries you forward when desire quietly runs out.`,
      p: `That's probably why relying on 'feeling like it' keeps failing me over and over. I think I need a habit instead, not a mood I can't control.` },
    { a: `Every day you avoid this, the discomfort doesn't disappear—it just moves to tomorrow, with interest quietly added on top of it. Acting today, even briefly and imperfectly, is the only real way to stop that debt from continuing to grow.`,
      p: `I hadn't thought of it as debt before, but that's exactly what it feels like—it keeps piling up the longer and longer I wait to deal with it.` },
  ],
  overthinking: [
    { a: `Clarity doesn't come from thinking—it comes from taking action, even when the outcome isn't fully clear yet. You don't need to figure out the whole path right now; you just need to take the very next step and trust yourself to adapt as you go along.`,
      p: `You're right... I keep trying to map out every single variable, which just keeps me frozen. Maybe I should just take one step and figure the rest out.` },
    { a: `Not every thought deserves your attention or your energy. Most of what loops in your head is noise, not signal—your brain generating static, not actual danger worth responding to. You get to choose which thoughts you follow and which ones you simply let pass by.`,
      p: `I think I've been treating every thought like it's important and urgent. Maybe most of them are just noise I don't actually need to chase or believe.` },
    { a: `You cannot think your way into controlling every possible outcome, no matter how long you try. Overthinking is often just anxiety pretending to be careful problem-solving. Real control comes from acting on what you can actually influence, not endlessly rehearsing what you can't.`,
      p: `That's fair. I keep mistaking overthinking for being responsible, when really it's just me trying to feel in control of something uncertain.` },
    { a: `There's a point where more thinking stops producing useful answers and starts producing pure anxiety instead. Past that point, you're not solving anything at all—you're just spinning in place. Recognizing that line clearly is how you know it's finally time to stop.`,
      p: `I think I passed that point quite a while ago. It's not helping me decide anymore—it's honestly just making me more anxious than before.` },
    { a: `You've made good decisions before with far less information than you actually have right now. Trust the version of you who's already navigated uncertainty successfully in the past—you don't need total certainty to move forward again this time.`,
      p: `I forget that I've handled unclear situations before and turned out fine anyway. Maybe I can trust myself a little bit more this time around.` },
    { a: `Overthinking feels productive in the moment, but it rarely changes the actual outcome—it just delays it while quietly draining your energy along the way. Worry is not preparation; it's simply rehearsal for pain that may never actually come to pass.`,
      p: `I always thought worrying meant I was preparing for whatever comes next. Maybe it's just costing me energy without actually helping me at all.` },
    { a: `Give yourself an honest deadline to decide, and actually stick to it. Endless deliberation isn't thoroughness—it's avoidance dressed up nicely as diligence. A decision made today, even an imperfect one, beats a perfect one that never actually arrives at all.`,
      p: `I could set myself a cutoff time instead of thinking about this forever. That actually sounds like relief to me, not risk at all.` },
    { a: `Your mind can loop for hours on end, but the world outside keeps moving forward regardless of what you decide. The longer you stay stuck in thought, the more time and opportunity quietly slip by while you sit there deliberating endlessly.`,
      p: `That's true—while I've been stuck thinking, everything else has just kept going without me the whole time.` },
    { a: `Rehearsing every worst-case scenario in your head doesn't actually prevent it from happening—it just makes you suffer through it twice over, once in your mind and once for real. Preparation is useful; imagined disaster on constant repeat is simply not preparation.`,
      p: `I do that constantly, replaying the worst outcome over and over like it'll somehow protect me. It's probably just making everything worse.` },
    { a: `The simple answer is often the correct one—the complicated, tangled version in your head is usually just fear talking, not actual truth. When you strip away all the spirals, what's left underneath is usually simpler than you originally think.`,
      p: `When I actually simplify it in my head, the answer is pretty obvious honestly. I think fear was just making it seem more complicated than it is.` },
  ],
  the_swallower: [
    { a: `You can't pour from an empty cup, no matter how much you want to keep giving. Constantly prioritizing everyone else's needs eventually leaves you with nothing left to give—to them or to yourself. Taking care of you isn't selfish; it's what makes real generosity possible in the first place.`,
      p: `I keep running myself dry trying to help everyone around me. Maybe filling my own cup first isn't selfish—it's actually necessary.` },
    { a: `Every time you say yes to something you don't actually want, you're quietly saying no to yourself instead. Boundaries aren't rejection—they're simply how you protect the energy you need to show up fully for the things that genuinely matter to you.`,
      p: `I never thought of it that way before. Saying yes to everyone else has really meant saying no to myself, over and over again without noticing.` },
    { a: `People who genuinely respect you will still respect your boundaries, even if they feel disappointed at first when you set them. Anyone who only values you when you comply with them isn't actually valuing you—they're valuing your compliance instead.`,
      p: `That's a hard truth to sit with. Maybe the people upset by my boundaries were only ever attached to my compliance, not really to me.` },
    { a: `Approval fades the moment you stop performing for it, but self-respect stays with you regardless of what other people happen to think. Chasing approval is a race with no finish line at all—self-respect is where you actually end up landing instead.`,
      p: `I keep chasing approval like it'll finally be enough to make me feel okay. It never actually is—maybe respecting myself would be enough.` },
    { a: `You are not responsible for managing other people's emotions, no matter how much guilt tells you otherwise. You can be kind and honest without carrying the full weight of how someone else chooses to feel about your honesty toward them.`,
      p: `I think I've been treating other people's reactions as my job to control. That's exhausting, and honestly it was never actually mine to carry.` },
    { a: `Trying to please everyone usually ends up pleasing no one at all, including yourself in the process. Spread thin across everyone else's expectations, you end up serving nobody well—least of all yourself, who gets forgotten in the middle of it.`,
      p: `That explains why I feel like I'm failing everyone at once, all the time. Maybe trying to please all of them was actually the real problem.` },
    { a: `Real connection is built on authenticity, not on constant agreeableness toward everyone around you. People-pleasing might earn you approval in the short term, but it rarely earns you closeness—because no one truly gets to know the real you underneath it all.`,
      p: `I wonder if people feel close to the version of me I'm performing for them, not who I actually am underneath all of that.` },
    { a: `Your worth was never actually up for a vote from anyone else around you. Other people's opinions can inform you and give you perspective, but they were never meant to define you—you already have value that doesn't depend on their approval at all.`,
      p: `I keep letting other people's opinions decide how I feel about myself every day. Maybe my worth isn't actually theirs to grade.` },
    { a: `It is genuinely okay to disappoint someone in order to stay true to yourself and what you actually need. Discomfort in the moment is far more survivable than years of quiet resentment built from slowly abandoning your own needs over and over again.`,
      p: `I've been so afraid of disappointing people that I keep abandoning myself instead. That trade really doesn't seem worth it anymore.` },
    { a: `Boundaries aren't walls that keep people out of your life entirely—they're actually doors that let the right relationships in more fully. Without them, you tend to attract obligation; with them, you attract people who genuinely respect you as you are.`,
      p: `I always thought boundaries would just push people away from me for good. Maybe they're actually what lets the right people stay close instead.` },
  ],
  the_fog: [
    { a: `Not knowing your entire path doesn't mean you're lost—it simply means you're still exploring what's actually out there for you. Clarity is rarely handed to you in advance; it's usually revealed slowly through the act of moving forward, one small step at a time.`,
      p: `I keep thinking I need the whole map before I even move an inch. Maybe exploring without one is honestly just part of the process itself.` },
    { a: `Direction is often discovered by moving forward, not by endless planning that never actually leads anywhere concrete. You can sit and strategize forever if you want, or you can take one small action and let the feedback show you exactly where to go next.`,
      p: `I've been stuck planning instead of actually doing anything real. Maybe moving forward would show me more than more planning ever possibly could.` },
    { a: `You don't need one grand, singular life purpose in order to feel genuinely directed and grounded. Purpose evolves, shifts, and reveals itself slowly over time as you change. Chasing a single fixed answer might actually be what's keeping you stuck, not the lack of one.`,
      p: `I think I've been waiting to find 'the' purpose this whole time, when maybe it's actually supposed to keep changing as I grow and change too.` },
    { a: `Small, consistent steps compound into real direction far more reliably over time than big, dramatic decisions ever do on their own. You don't need to know the final destination to start walking—you just need to keep choosing the very next small step in front of you.`,
      p: `I keep waiting for one big clear decision instead of just taking small consistent steps forward. Maybe that waiting has been the real barrier.` },
    { a: `It's okay to change your mind as many times as you need to along the way. Clarity often only makes sense looking backward at your own path—you rarely see it clearly while you're still inside of it. Trust that direction will make more sense later than it does right now, in this moment.`,
      p: `I keep beating myself up for not knowing yet where I'm headed. Maybe it's actually supposed to only make sense in hindsight, once I've already moved.` },
    { a: `Comparing your path to someone else's timeline quietly creates a false sense of being lost when you're not actually lost at all. Their direction was built for their life, not yours—your winding road doesn't mean you're behind, it simply means your path is different from theirs.`,
      p: `I think I've been measuring myself against paths that were genuinely never mine to follow in the first place, and it's not fair to me.` },
    { a: `Feeling confused is often a sign of real growth happening, not a sign of failure on your part at all. It usually means you're outgrowing an old direction and just haven't found the new one yet. That gap is uncomfortable, sure, but it isn't the same as being permanently lost forever.`,
      p: `Maybe this confusion just means I'm caught between versions of myself right now, not permanently stuck where I am forever.` },
    { a: `You can build real direction the exact same way you build anything else meaningful in life—by testing small things and adjusting as you go, not by waiting endlessly for certainty to arrive before you're allowed to move at all.`,
      p: `I keep waiting to feel certain before I try anything new at all. Maybe testing things is actually how certainty gets built in the first place.` },
    { a: `Even wandering has genuine value in the long run—it teaches you what you don't actually want, which is often just as useful as knowing exactly what you do want out of life. No time spent honestly exploring is ever truly wasted, even when it feels that way.`,
      p: `I've been treating my detours like they were failures this whole time. Maybe they were actually teaching me something quietly useful all along.` },
    { a: `Direction was never actually meant to be a straight line from point A to point B in the first place. It's built through ongoing trial, error, and constant small course corrections along the way. Expecting a clean, tidy path is exactly what makes the natural zigzag feel like failure.`,
      p: `I think I've been expecting a straight line this whole time, and getting frustrated every single time life zigzags instead of cooperating.` },
  ],
  the_spiral: [
    { a: `Anxiety consistently exaggerates threat, no matter how real or unreal the actual danger is—it's designed to prepare you for danger, not to accurately predict it. Most of what it warns you about never actually happens in reality. Its alarm and reality are rarely the same thing.`,
      p: `It's true, almost none of what I've panicked about has actually come true in the end. Maybe the alarm isn't as accurate as it honestly feels.` },
    { a: `Your nervous system reacts to imagined threats with the exact same intensity as it does to real ones, even when nothing dangerous is actually happening. That doesn't mean the danger itself is real—it means your body simply needs help learning the difference between the two over time.`,
      p: `I keep reacting like it's a real emergency, even when it's genuinely just a passing thought in my head. Maybe my body just needs some retraining.` },
    { a: `Slow, deliberate breathing physically signals safety directly to your nervous system, interrupting the anxiety response at a purely biological level before it fully takes hold. You don't need to think your way calm—you can actually breathe your way there instead, one breath at a time.`,
      p: `I forget that this is physical, not just mental, most of the time. Maybe I can calm my body first instead of trying to out-think it.` },
    { a: `Anxious thoughts are only predictions, not established facts about what will actually happen. Your mind is essentially guessing at a future it cannot actually see clearly, and treating every single guess as certain truth is exactly what keeps that underlying fear alive and well inside you.`,
      p: `I keep treating my worst-case guesses like they're already true and set in stone. Maybe they're honestly just guesses, not facts I should trust.` },
    { a: `You have already survived one hundred percent of your worst days so far, without exception, no matter how impossible they once felt in the moment. Whatever happens next, you already have solid proof that you get through hard things, even the ones that once felt completely unbearable.`,
      p: `I never really think about my track record like that, but it's true—I've genuinely made it through everything so far without exception.` },
    { a: `Anxiety shrinks the more you actually face it head-on, and it grows the more you avoid it and run from it instead. Every small act of facing what genuinely scares you teaches your brain that the perceived threat was actually smaller than it felt at the time.`,
      p: `Avoiding it has only ever made it feel bigger and scarier over time. Maybe facing it, even just a little bit, is the only way it actually shrinks.` },
    { a: `Uncertainty feels completely unbearable in the moment, but it's actually quite survivable in practice—people live inside uncertainty every single day of their lives and still manage to function just fine. You don't need all the answers in hand to keep moving forward regardless.`,
      p: `I keep treating not knowing as something unbearable, when really I've been living with uncertainty this whole time already without realizing it.` },
    { a: `Your body cannot always tell the difference between real danger and merely imagined danger on its own, but you can actually teach it that difference over time. Repeated calm exposure to the feared thing slowly recalibrates what your body treats as genuinely safe versus dangerous.`,
      p: `That makes real sense—maybe my body just hasn't fully learned yet that this particular thing isn't actually dangerous at all to me.` },
    { a: `Anxiety craves total control over everything, but control was never actually the same thing as real peace of mind. Chasing certainty just to feel safe simply feeds the ongoing cycle further—real peace comes from learning to tolerate uncertainty, not from eliminating it completely and entirely.`,
      p: `I keep trying to control everything around me just to feel safe. Maybe peace was actually never about control in the first place.` },
    { a: `Grounding yourself firmly in what's physically true right now—your breath, your surroundings around you—interrupts the anxious spiral before it has a chance to spin any further out of control. The present moment is almost always genuinely safer than the one your anxious mind is busy predicting.`,
      p: `When I actually look around me right now, nothing bad is actually happening in this moment. Maybe the danger really is just in my head.` },
  ],
  the_wall: [
    { a: `Reaching out when you're genuinely struggling is a real sign of strength, not weakness, no matter what your mind tells you in that moment. It takes far more courage to be truly seen than it does to quietly disappear—and real connection only becomes possible once you actually let someone in.`,
      p: `I always thought needing help made me weak somehow. Maybe it actually takes more strength to ask than it does to keep hiding it all.` },
    { a: `Isolation convinces you that you're the only one genuinely struggling right now, but nearly everyone around you carries something they don't openly show to others. You are far less alone in this than the surrounding silence honestly makes it feel like to you.`,
      p: `I keep assuming everyone else around me has it all together somehow. Maybe they're just as hidden about their own struggles as I actually am.` },
    { a: `Small efforts to connect with others—one honest message, one real conversation—compound over time into a genuine support system you can actually rely on. You don't need a huge social circle right away, just one small deliberate step toward someone you trust.`,
      p: `I've been waiting to feel fully ready before reaching out to a lot of people at once. Maybe just one small message is honestly enough to start with.` },
    { a: `Being genuinely vulnerable with someone tends to invite closeness rather than actually repel it, contrary to what fear tells you. Most people end up feeling more connected to you, not less, once they finally see the real, unfiltered version of who you actually are underneath it all.`,
      p: `I've always hidden the real stuff out of fear of rejection. Maybe showing it honestly would actually bring people closer, not push them further away.` },
    { a: `You don't need many people around you at all times—just one honest, genuinely real connection can be enough to fully break the grip of isolation on you. Depth of connection matters far more than the sheer number of people currently in your life.`,
      p: `I keep thinking I need a big circle of friends around me. Maybe just one real connection would honestly be enough to feel less alone.` },
    { a: `Isolation quietly lies to you—it tells you that people don't actually want you around, without any real evidence to genuinely back that claim up at all. That belief keeps you from ever testing it out, so it never actually gets disproven in your own mind.`,
      p: `I've never actually tested whether people genuinely want me around or not—I just assumed it was true and stayed away from everyone instead.` },
    { a: `Rest can sometimes look like solitude on the surface, but true healing usually requires real connection with others at some point along the way. Retreating fully from people may feel safe in the moment, but it can also quietly prevent the recovery you're genuinely seeking underneath it all.`,
      p: `I thought withdrawing completely was actually helping me heal faster. Maybe it's actually been slowing that whole process down instead.` },
    { a: `There is a real difference between being alone and being genuinely lonely inside yourself. Alone by conscious choice can actually be restorative and healing; alone by quiet avoidance usually isn't at all. The real difference lies in whether you're choosing it or simply hiding inside of it.`,
      p: `I think I've actually been hiding, not truly choosing solitude on purpose. That's probably why being alone hasn't actually felt restful to me at all.` },
    { a: `Community is not something you simply find fully formed somewhere out there waiting for you. It's actually built slowly through small, repeated acts of showing up for others. Waiting for it to appear on its own keeps you isolated far longer than actually building it yourself would.`,
      p: `I keep waiting for community to just happen to me on its own somehow. Maybe I actually have to build it myself, one small piece at a time.` },
    { a: `Asking for help is genuinely not a burden placed on other people around you—for most people, actually being trusted enough to help someone is genuinely a real gift to them. You are probably underestimating just how willing people truly are to show up for you when asked.`,
      p: `I always feel like a burden whenever I ask someone for help with something. Maybe people actually want to be trusted with it more than I realize.` },
  ],
  the_comparer: [
    { a: `Comparison measures your own beginning against someone else's carefully curated middle. You're seeing years of their quiet effort compressed into a single visible moment, then judging your own unfinished self against their already finished result.`,
      p: `That's exactly what I do constantly—compare my rough draft to someone else's polished final version. That's honestly not really a fair fight at all.` },
    { a: `There is genuinely no universal timeline for success that applies to everyone. Everyone moves at a fundamentally different pace, shaped by different circumstances—being behind someone else's schedule doesn't mean you're behind on your own personal timeline.`,
      p: `I keep measuring myself against a timeline that was honestly never actually mine to follow in the first place, and that's not fair to me.` },
    { a: `What you're comparing yourself to is usually just someone's carefully curated highlight reel, not their full and honest story underneath it all. You rarely ever see their private doubts, quiet failures, or genuinely bad days—only the carefully chosen parts they actively decide to show the world.`,
      p: `I forget that I'm only ever seeing the edited version of their life, not all the messy parts underneath that they quietly leave out.` },
    { a: `Comparison quietly steals the genuine joy from your own hard-won progress without you even noticing it happening. While you're focused entirely on someone else's milestones and achievements, you stop noticing—and properly celebrating—the real ground you've actually covered yourself along the way.`,
      p: `I've actually made real progress of my own, but I never truly notice it because I'm too busy watching someone else's progress instead.` },
    { a: `Your only real, legitimate competition is genuinely who you were yesterday, not anyone else around you entirely. Measuring against your own past self, rather than against others, gives you a fair, honest, and genuinely useful comparison that you can actually grow from over time.`,
      p: `Comparing myself to other people has honestly never actually helped me improve at all. Maybe comparing myself to my own past self would work better.` },
    { a: `Success is genuinely not a zero-sum game between you and everyone else around you, no matter how it might feel in the moment. Someone else winning does not actually subtract from your own potential to succeed—there's no limited supply of achievement that they're quietly taking a share of.`,
      p: `I think I've been treating their success like it somehow means less is left over for me. That's probably not even actually true at all.` },
    { a: `Constantly looking outward at other people around you blinds you to your own genuine growth happening right in front of you the whole time. The energy spent comparing yourself to others is energy not spent actually noticing how far you've genuinely come on your own journey.`,
      p: `I've been so focused outward on everyone else that I haven't even noticed my own quiet progress happening this entire time.` },
    { a: `Comparison thrives entirely on incomplete information that you don't actually have full access to in the first place. You're comparing your full internal reality to someone else's carefully curated exterior, which was genuinely never a fair or accurate measurement to begin with at all.`,
      p: `I'm comparing everything I know about myself to what I only see on the polished surface of them. That's really not even close to fair to me.` },
    { a: `Different people naturally have different paths, different personal pace, and entirely different purpose in life—comparison quietly assumes a shared race that was never actually happening between the two of you in the first place at all.`,
      p: `I keep acting like we're all somehow running the exact same race together. Maybe we're honestly not even on the same track to begin with.` },
    { a: `Admiration can genuinely inspire you without actually diminishing you in the process at all, if you let it work that way. The subtle shift from envy toward curiosity turns someone else's success into genuinely useful information instead of becoming a quiet, ongoing source of personal pain.`,
      p: `Maybe instead of resenting what they have that I don't, I could get genuinely curious about how they actually got there in the first place.` },
  ],
  the_hollow: [
    { a: `Doubt is simply a passing feeling, not solid evidence of your true capability. It can visit you without ever actually being true—the discomfort of genuine uncertainty doesn't prove that you're incapable, it just proves that you're human like everyone else.`,
      p: `I keep treating my doubt like it's solid proof that I can't do this. Maybe it's just a feeling passing through me, not an actual fact.` },
    { a: `Confidence is genuinely built through repeated action, not felt fully before it ever even begins in the first place. Waiting to feel confident before you actually try keeps you waiting forever without end—real confidence usually shows up after the honest attempt is made, not before it happens.`,
      p: `I keep waiting to feel confident first before doing anything at all. Maybe confidence only comes after I actually try the thing, not before I start.` },
    { a: `Nearly everyone who has genuinely ever achieved something significant in life also doubted themselves seriously along the way at some point. Doubt is not actually a sign that you're on the wrong path entirely—it's often simply just part of walking any meaningful path at all, for everyone.`,
      p: `I always assumed successful people never actually doubted themselves at any point. Maybe doubt was honestly just part of their normal process too.` },
    { a: `You genuinely do not need to feel fully ready in order to be capable of doing something meaningful. Readiness is often just a passing feeling, and it rarely arrives on schedule when you expect it to—real capability was never waiting around for permission from confidence.`,
      p: `I keep separating 'capable' from 'ready,' almost as if I genuinely need both of those things at once. Maybe I only actually need one.` },
    { a: `Self-doubt often shows up right before real growth happens, not right before actual failure, even though it feels that way in the moment. Stepping into anything unfamiliar naturally triggers doubt—it's frequently a clear sign you're stretching yourself, not proof that you're wrong.`,
      p: `Maybe the doubt showing up right now actually means I'm growing into something new, not real proof that I'm genuinely failing at it.` },
    { a: `Mistakes do not define who you are as a person—they actually refine you slowly over time, if you let them. Every misstep carries real information you can use going forward, and treating errors as your identity rather than useful data is what keeps self-doubt alive.`,
      p: `I've been treating my mistakes like they say something permanent and fixed about who I am, instead of just being useful feedback for me to use.` },
    { a: `Your inner critic is genuinely not an accurate judge of your actual true worth as a person, no matter how convincing it sounds in your head. It's simply a loud, biased voice shaped entirely by fear, not a fair or reliable measure of who you really are or what you're truly capable of achieving.`,
      p: `I keep trusting that critical inner voice like it's somehow objective and correct. Maybe it's honestly just loud, not actually accurate.` },
    { a: `Competence genuinely grows through steady repetition and consistent practice over time, not by waiting endlessly for total certainty to arrive first before you even begin. You actually get better by doing the thing imperfectly, over and over again, not by feeling fully sure of yourself beforehand.`,
      p: `I keep waiting to feel certain before I start practicing anything new. Maybe certainty is actually the result of practicing, not a requirement for it.` },
    { a: `You have genuinely already overcome things in your life that once felt completely impossible to you before you actually went ahead and did them anyway. That consistent pattern is real proof that you can handle far more than your current doubt is honestly telling you right now, in this moment.`,
      p: `I forget how many things once felt genuinely impossible until I actually went and did them anyway. That's honestly a pattern worth trusting.` },
    { a: `Self-doubt genuinely shrinks the moment your focus shifts from chasing perfection toward simply tracking honest progress instead. Chasing total flawlessness invites constant, relentless doubt into your life, but tracking small honest improvement gives that doubt far less room to grow.`,
      p: `I think I've genuinely been chasing perfect this whole time instead of tracking my real progress. That's probably feeding the doubt, not fixing it.` },
  ],
};

/** The fixed 10-card deck for one monster. */
export function deckFor(monsterId: string): TameCard[] {
  const entries = RAW[monsterId] ?? [];
  return entries.map((e, i) => ({
    cardId: `${monsterId}-${i + 1}`,
    monsterId,
    index: i + 1,
    damage: DECK_DAMAGE[i] ?? 10,
    argument: e.a,
    persuaded: e.p,
  }));
}

/** Every deck, for the Skills library browser. */
export function allDecks(): { monsterId: string; cards: TameCard[] }[] {
  return Object.keys(RAW).map((monsterId) => ({ monsterId, cards: deckFor(monsterId) }));
}

export interface TameFinalWords {
  variant: string;
  monster: string;
  replies: readonly string[];
}

export const TAME_INTRO_COPY: Record<string, string> = {
  overthinking: 'I keep replaying everything that happened.',
  the_hollow: 'I keep wondering if I’m good enough.',
  the_comparer: 'I can’t stop comparing myself to others.',
  procrastination: 'I keep putting off what I need to do.',
  the_swallower: 'I worry too much about letting people down.',
  the_fog: 'I don’t know what I’m moving toward anymore.',
  the_spiral: 'I can’t shake the feeling that something might go wrong.',
  the_wall: 'I feel alone, even when people are around.',
};

export const TAME_TAMED_COPY: Record<string, string> = {
  overthinking: 'Your thoughts have settled. You’re back in the present.',
  the_hollow: 'You made room for belief in yourself.',
  the_comparer: 'You found your way back to your own path.',
  procrastination: 'You broke through the pause and began.',
  the_swallower: 'You chose your own needs with kindness.',
  the_fog: 'You found one small step to guide you forward.',
  the_spiral: 'The alarm has softened. You’re safe in this moment.',
  the_wall: 'You opened a small door back to connection.',
};

/** Four complete line/reply sets per monster. Sets must never be mixed. */
export const TAME_FINAL_WORD_SETS: Record<string, readonly TameFinalWords[]> = {
  overthinking: [
    {
      variant: 'original',
      monster: 'But what if you miss something important?',
      replies: [
        'I’ve thought about this enough for now.',
        'I don’t need every answer before I begin.',
        'One next step is enough.',
        'You can be here. You don’t get to drive.',
      ],
    },
    {
      variant: 'challenge',
      monster: 'You can’t stop now. There’s still too much to figure out.',
      replies: [
        'I choose one thing, not everything.',
        'I can decide with what I know.',
        'Thinking more won’t make me safer.',
        'My mind can rest now.',
      ],
    },
    {
      variant: 'permission',
      monster: 'If you let this go, you might make the wrong choice.',
      replies: [
        'Maybe. I can handle imperfect choices.',
        'I have enough information for one step.',
        'I’m done replaying this for now.',
        'I’ll deal with what is real, not every possibility.',
      ],
    },
    {
      variant: 'protective',
      monster: 'I’m only trying to protect you from making a mistake.',
      replies: [
        'Thank you, but I can take it from here.',
        'I don’t need every outcome mapped out.',
        'Let’s pause the loop together.',
        'I choose a gentle next step.',
      ],
    },
  ],
  the_hollow: [
    {
      variant: 'original',
      monster: 'You’re not ready. You’ll only prove you can’t do it.',
      replies: [
        'I can learn while I do it.',
        'Being new doesn’t mean I’m incapable.',
        'I don’t need to be perfect to start.',
        'I’m giving myself a real chance.',
      ],
    },
    {
      variant: 'challenge',
      monster: 'You know you’re going to mess this up.',
      replies: [
        'I’m allowed to try anyway.',
        'A mistake won’t define me.',
        'I’m more capable than this fear says.',
        'Watch me learn.',
      ],
    },
    {
      variant: 'permission',
      monster: 'You don’t have proof that you can do this.',
      replies: [
        'I don’t need proof before I begin.',
        'I have done hard things before.',
        'I can ask for help if I need it.',
        'Not knowing yet is okay.',
      ],
    },
    {
      variant: 'protective',
      monster: 'I’m trying to stop you from getting hurt.',
      replies: [
        'I hear you, but I’m still willing to try.',
        'I can be brave and unsure at once.',
        'I’ll be kind to myself if it’s hard.',
        'I don’t need to shrink to stay safe.',
      ],
    },
  ],
  the_comparer: [
    {
      variant: 'original',
      monster: 'Look at them. You’re already behind.',
      replies: [
        'Their path isn’t my deadline.',
        'I can be happy for them and still want more.',
        'I’m building at my own pace.',
        'My next step matters more than their highlight reel.',
      ],
    },
    {
      variant: 'challenge',
      monster: 'They did it faster. What’s your excuse?',
      replies: [
        'I’m not racing their life.',
        'My progress is still progress.',
        'I won’t use someone else to shrink myself.',
        'I’m back on my own path.',
      ],
    },
    {
      variant: 'permission',
      monster: 'Everyone else seems to have it together.',
      replies: [
        'I only see part of their story.',
        'I don’t need their life to validate mine.',
        'My timing is still mine.',
        'I’m focusing on what I want next.',
      ],
    },
    {
      variant: 'protective',
      monster: 'I just don’t want you to fall behind.',
      replies: [
        'My life isn’t a race.',
        'I can want growth without punishing myself.',
        'I’m enough while I’m becoming.',
        'Let’s look at my own next step.',
      ],
    },
  ],
  procrastination: [
    {
      variant: 'original',
      monster: 'Not now. You’ll feel more ready tomorrow.',
      replies: [
        'I only need to start for two minutes.',
        'Small progress still counts.',
        'I can do this badly before I do it well.',
        'Tomorrow doesn’t need to carry today’s work.',
      ],
    },
    {
      variant: 'challenge',
      monster: 'Just scroll a little longer. Starting can wait.',
      replies: [
        'I’m starting before I feel ready.',
        'Two minutes begins now.',
        'I choose progress over avoidance.',
        'Later is not in charge today.',
      ],
    },
    {
      variant: 'permission',
      monster: 'You’re tired. Skipping it won’t matter.',
      replies: [
        'Rest and avoidance are not the same.',
        'I can make this smaller.',
        'I’ll do the first tiny part.',
        'I can stop after I begin.',
      ],
    },
    {
      variant: 'protective',
      monster: 'I’m giving you a break from pressure.',
      replies: [
        'A small start can be gentle too.',
        'I can do less, not nothing.',
        'I don’t have to finish it all today.',
        'Let’s begin with the easiest part.',
      ],
    },
  ],
  the_swallower: [
    {
      variant: 'original',
      monster: 'If you disappoint them, they might not like you.',
      replies: [
        'Their feelings are not mine to manage.',
        'A kind no is still kind.',
        'I can care without abandoning myself.',
        'The right people can handle my boundaries.',
      ],
    },
    {
      variant: 'challenge',
      monster: 'Say yes. Keeping everyone happy is safer.',
      replies: [
        'I can say no and still be kind.',
        'I’m not here to earn permission.',
        'My needs belong in the room too.',
        'I choose honesty over approval.',
      ],
    },
    {
      variant: 'permission',
      monster: 'They’ll think you’re selfish.',
      replies: [
        'They may not like my answer, and I can cope.',
        'My boundary is not an attack.',
        'I can be caring without overgiving.',
        'I’m not responsible for everyone’s comfort.',
      ],
    },
    {
      variant: 'protective',
      monster: 'I’m helping you avoid conflict.',
      replies: [
        'I can survive someone being disappointed.',
        'Being honest can still be loving.',
        'I can protect my energy too.',
        'I’m allowed to choose myself here.',
      ],
    },
  ],
  the_fog: [
    {
      variant: 'original',
      monster: 'You don’t even know where you’re going. Why move?',
      replies: [
        'I don’t need the whole map today.',
        'I can choose one direction for now.',
        'Not knowing yet is not being lost forever.',
        'I’ll follow what feels meaningful next.',
      ],
    },
    {
      variant: 'challenge',
      monster: 'You have no plan. You’ll just get it wrong.',
      replies: [
        'I can find my way by moving.',
        'One small choice creates direction.',
        'I don’t need certainty to continue.',
        'I trust myself to adjust.',
      ],
    },
    {
      variant: 'permission',
      monster: 'What if this isn’t the right path?',
      replies: [
        'I can change course later.',
        'There may not be one perfect path.',
        'I’ll choose what matters today.',
        'Clarity can come after movement.',
      ],
    },
    {
      variant: 'protective',
      monster: 'I’m keeping you still until you feel certain.',
      replies: [
        'I can move before certainty arrives.',
        'It’s okay to explore.',
        'One step can teach me something.',
        'I can trust the next small signal.',
      ],
    },
  ],
  the_spiral: [
    {
      variant: 'original',
      monster: 'Something bad is about to happen. Stay on guard.',
      replies: [
        'This is a feeling, not a prediction.',
        'Right now, I am safe enough.',
        'I can handle one moment at a time.',
        'I’m coming back to my breath.',
      ],
    },
    {
      variant: 'challenge',
      monster: 'Don’t relax. You’ll regret letting your guard down.',
      replies: [
        'I don’t need to solve danger that isn’t here.',
        'I can be alert without panicking.',
        'This moment is mine.',
        'I choose calm over alarm.',
      ],
    },
    {
      variant: 'permission',
      monster: 'Something feels off. You should keep worrying.',
      replies: [
        'Feeling scared doesn’t mean danger is here.',
        'I can check the facts once.',
        'I’m safe enough in this moment.',
        'My body deserves a pause.',
      ],
    },
    {
      variant: 'protective',
      monster: 'I’m trying to keep you prepared.',
      replies: [
        'Thank you. I’m safe enough right now.',
        'I only need to handle this moment.',
        'I can prepare without spiraling.',
        'Let’s breathe before we decide.',
      ],
    },
  ],
  the_wall: [
    {
      variant: 'original',
      monster: 'No one would really understand anyway.',
      replies: [
        'I don’t have to carry this alone.',
        'One small reach-out is enough.',
        'Being quiet doesn’t mean I’m invisible.',
        'I deserve connection, even when it feels hard.',
      ],
    },
    {
      variant: 'challenge',
      monster: 'Don’t reach out. You’ll only bother them.',
      replies: [
        'I’m allowed to take up space.',
        'One message is not too much.',
        'I don’t have to feel ready to connect.',
        'I choose closeness over hiding.',
      ],
    },
    {
      variant: 'permission',
      monster: 'They probably don’t want to hear from you.',
      replies: [
        'I don’t know that for sure.',
        'I can send something simple.',
        'Connection can start small.',
        'I deserve to be heard too.',
      ],
    },
    {
      variant: 'protective',
      monster: 'I’m keeping you from being hurt again.',
      replies: [
        'Connection can be careful and real.',
        'I can reach out in a small way.',
        'Not everyone will hurt me.',
        'I don’t have to hide alone.',
      ],
    },
  ],
};

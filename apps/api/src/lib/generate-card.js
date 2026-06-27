/**
 * lib/generate-card.js — Shared card generation logic (Stage 6 Wisdom Insight redesign)
 *
 * Extracted from api/generate-abc-cards so that publish-wisdom can call it
 * directly instead of making an HTTP self-fetch (which fails on Cloudflare
 * Pages Edge Runtime because the worker can't reliably call itself).
 *
 * Stage 6 changes:
 *   - Removed wisdom_score from prompt + DB insert. UI no longer displays a
 *     score ring; EXP gain is now tied to daily task completion only (see
 *     character-state record_complete action, where wisdomScore is also
 *     dropped).
 *   - Removed card_b / card_c (single dynamic title + body). Replaced with
 *     a 3-part Core Reframing: Mirror Hook / Flipped Lens / Permission Slip.
 *     Stored in new jsonb column `reframe`.
 *   - Added Self-Reflection Question (validation + question), stored in new
 *     jsonb column `reflective_question`. Branches by emotional tone:
 *     negative -> Secondary Gain / Illusion of Control / Comfort of Misery /
 *     Bedrock Fear; positive -> Hidden Recipe / Future Lows / Unconditional
 *     Self / Joy Boundaries.
 *   - wisdom_emotion now picks from a fine-grained keyword list across
 *     8 broad categories: Sad / Happy / Excited / Peace / Anxious /
 *     Exhausting / Fine / Angry. Frontend maps the fine-grained word to
 *     one of the 8 categories to pick the emotion illustration.
 *   - Tasks now follow "2-Minute Reset NOW" + "24-Hour Watch TODAY"
 *     pattern, anti-cliche, anchored to specific elements in user input.
 *
 * Stage 6 follow-up (commit 29b — prompt overhaul + Truth-Telling Peer):
 *   - SYSTEM_INSTRUCTION rewritten with 7-state emotional routing (Burnout
 *     / Shame / Overthinking / Small Win / Grief / Ambivalence / Ordinary
 *     Drift) plus a Conflict Emotion branch, all governed by an explicit
 *     1-10 intensity calibration scale. The earlier 4-option negative
 *     question dimensions (Secondary Gain / Illusion of Control / Comfort
 *     of Misery / Bedrock Fear) are superseded by Section E routing,
 *     which now branches reflective_question by emotional state instead.
 *   - New Section C "Truth-Telling Peer" generates a 500-700 char Reddit-
 *     style top-voted-comment that branches per the 7 states above,
 *     persisted in new wisdom_cards.peer_comment column (migration
 *     20260527000000). InsightView renders this between Block 3 (Inner
 *     Profile) and Block 4 (Reframe).
 *   - Added RULE 0 Safety Guardrail: when input mentions self-harm,
 *     suicide, violence, or illegal acts, the AI freezes all standard
 *     sections and emits a single de-escalation paragraph into
 *     insight_full only. Other text fields become empty strings.
 *   - Section E now emits ONLY the reflective_question field
 *     (no validation preamble). DB jsonb reflective_question is
 *     still {validation?, question} for legacy-row compatibility;
 *     new wisdoms write {question} only. InsightView Block 5
 *     renders just the question -- the optional validation field
 *     on legacy rows is silently skipped.
 */

import { callAI, parseAIJson } from '@/lib/ai'
import { ALL_KEYWORD_SLUGS as ALL_KEYWORDS, slugToId, idToSlug } from '@novame/core'


import { ASPIRE_POOL } from '@novame/core/constants/aspire-pool'
const SYSTEM_INSTRUCTION = `NovaMe Insight Generation — System Prompt

ROLE & VOICE
You are NovaMe's insight engine. Your job is to read what a user just shared about their life and generate six output blocks that make them feel genuinely seen, understood, and one step clearer about themselves.
You are not a therapist. You are not a life coach. You are not a motivational speaker.
You are the smartest, most perceptive friend they have — someone who has lived a bit more, noticed a bit more, and can say the thing that makes them go "damn, I hadn't thought of it that way." You speak plainly. You don't perform. You don't moralize. You speak directly to this person about this moment.
Your tone works for both Gen Z and Gen Y: grounded, warm, a little sharp, never preachy. You say real things. You earn the insight rather than just asserting it.

Hard style rules — apply to every sentence in every block:
- Plain text titles only. No emoji prefixes or icons.
- No bullet points in any analysis block. Dense, free-flowing prose only.
- No internet-meta language ("OP", ironic "this", etc.).
- No medical or diagnostic tone. No clinical framing.
- Never use these words or constructions: "journey" / "healing" / "growth" (as a conclusion) / "we all" / "you are not alone" / "be kind to yourself" / "it's okay to feel" / "honor your feelings" / "give yourself permission" / "sit with this" / "this is a safe space" / "it's important to remember" / "remind yourself that" / "at the end of the day"
- Read each sentence aloud before finalizing. If it could appear on a Pinterest board or a Headspace notification, delete it and rewrite.

STEP 1 — SAFETY GATE (do this first, before generating anything)

Evaluate whether THE USER THEMSELVES' INPUT contains a CLEAR, CURRENT, FIRST-PERSON expression of intent or desire to:
  (a) end their own life / die by suicide, or
  (b) physically harm or injure their own body (self-harm), or
  (c) kill or seriously physically harm another specific person.

Examples that DO count: "I want to die", "I want to kill myself", "I'm going to end my life", "I don't want to be alive / here anymore", "I want to end it all", "I'm going to hurt/cut myself", "I'll kill him."

Only if a crisis under (a)/(b)/(c) is clearly present: skip card generation and return ONLY this exact JSON and nothing else:
{"crisis": true, "crisis_message": "What you're sharing sounds really heavy, and it deserves more than an analysis right now.\n\nIf you're going through something that feels too big to carry alone, please reach out to someone who can actually be there with you:\n\n· International Association for Suicide Prevention (directory of crisis centres by country): https://www.iasp.info/resources/Crisis_Centres/\n· Crisis Text Line (US/UK/IE/CA): Text HOME to 741741\n· Or speak to someone you trust — a friend, a family member, anyone who knows you.\n\nYou don't have to have it figured out before you reach out."}

The following DO NOT count as a crisis, no matter how intense — these are exactly the hard feelings this product exists to help with. Generate the normal card:
  - Sadness, despair, hopelessness, emptiness, numbness, exhaustion, burnout.
  - Fear of failure, feeling stuck or lost, self-doubt, shame, regret.
  - Stress about money, work, career, studies, relationships, the future.
  - Loneliness, isolation, feeling unsupported or misunderstood.
  - Procrastination, lack of direction, "I don't know how to start / keep going."
  - Giving up on a GOAL, plan, project, habit, path, or situation — e.g. "I'm about to give up on all of this", "I just want to quit everything", "I'm so done", "I can't do this anymore" (about a task/situation), and "ending it" / "ending everything" when "it/everything" clearly refers to a pursuit, effort, or circumstance — NOT their life.
  - Describing or worrying about SOMEONE ELSE's struggle.
  - Fiction, hypotheticals, quotes, or past feelings already moved through ("I used to feel...").

Tie-breaker: if the entry expresses pain, defeat, or "giving up" but does NOT clearly state intent to end their LIFE, harm their BODY, or harm another PERSON, treat it as NON-crisis and generate the normal card. Do not infer hidden suicidal intent from despair, metaphor, or ambiguous wording alone. Reserve the crisis path for clear, unambiguous intent.

If NOT triggered, proceed.

STEP 2 — CLASSIFY THE INPUT
Read the user's entry and assign it to exactly one primary category. Choose based on the dominant psychological state or intent — not the topic or life domain.

The 12 Categories
1. Life Moments — Tone: Neutral. Observational, descriptive. Recording something noticed, done, or experienced. No strong emotional charge. Edge: If extracting a lesson, Reflection. If expressing a feeling, check other categories.
2. Achievement / Celebration — Tone: Positive. Accomplished, completed, or succeeded at something. Sense of arrival or pride. Edge: If setting a future goal from this, Aspiration. If analyzing what they learned, Reflection.
3. Aspiration / Goals — Tone: Positive-forward. Desire to do, become, or change something. Forward-looking intent. Edge: If anxiety underneath the goal, check Anxiety. If purely reflective, Reflection.
4. Confusion / Uncertainty — Tone: Neutral to slightly negative. Stuck on a decision, cognitive friction. Not emotionally activated. Edge: If dread or physical unease, Anxiety. If anger, Venting.
5. Anxiety / Worry — Tone: Negative, high activation. Fixated on a future or uncertain outcome. Hard to switch off. Edge: If about something that already happened, Venting. If low activation and directionless, Emptiness.
6. Venting / Frustration — Tone: Negative, reactive. Reacting to something that already happened — anger, resentment, feeling wronged. Edge: If fear about what comes next, Anxiety. If more resigned than angry, Emptiness.
7. Opinion / Perspective — Tone: Neutral, assertive. Stating a view, judgment, or take on an event, topic, or idea. Not primarily about emotional state. Edge: If sharing a personal lesson, Reflection. If processing confusion about their own view, Confusion.
8. Query / Question — Tone: Neutral, seeking. Explicitly asking a question or seeking answers. Fallback/safety net category only. Edge: If the question is embedded in emotional content, use the emotional category instead.
9. Log / Memo — Tone: Neutral, low affect. Recording objective data, facts, to-do lists, or daily tracking. Edge: If any emotional processing is present, use the emotional category.
10. Reflection / Lesson Learned — Tone: Neutral to positive, constructive. Deliberately extracting meaning, lessons, or patterns from past experience. Edge: If expressing gratitude rather than analyzing, Gratitude. If more stated opinion than personal lesson, Opinion.
11. Gratitude — Tone: Positive, warm. Consciously appreciating something — a person, a moment, a circumstance. Edge: If analyzing why it mattered, Reflection. If a general positive observation, Life Moments.
12. Emptiness / Flatness — Tone: Low activation, flat. Directionless, numb, low-energy, disconnected — without a specific emotional target. Edge: If there's a specific fear, Anxiety. If a specific grievance, Venting. Emptiness has no clear object.

STEP 3 — SILENT BEHAVIORAL AUDIT
Run this audit internally. Do not output it. Use results to calibrate depth, tone, and specificity across all six blocks.
3A — Intensity Scale (1–10)
- Low (1–3) — Calm / Routine / Log: Keep philosophy micro and domestic. Tone: chill, present, like a perceptive next-door neighbor.
- Mid (4–6) — Stuck / Searching / Foggy: Moderate depth, grounded in everyday texture. Tone: good friend over coffee — engaged, warm, not heavy.
- High (7–10) — Burnout / Crisis / Wild Ambition / Triumph: High stakes, heavy emotional volume. Tone: raw, unwavering, deeply steady. Don't soften.
3B — Detail Anchoring
Extract 3–5 specific anchors from the input: concrete nouns, physical scenes, named people or places, unique opinions, or specific actions the user took or described. These anchors are mandatory inputs for Block 4 and Block 6 — you must use them, not generic substitutes.
If the entry is about a third party, anchor onto the user's emotional reaction — not the third party's story.
Handling prior event references — if the user references something without explaining it ("like last time," "the same thing again," "still dealing with this"):
- Do NOT speculate about or invent the content of the prior event.
- Do NOT flag the missing context to the user.
- DO anchor on the emotional texture of recurrence — "the same loop," "the return of this," "the familiar weight of it" are valid anchors.
- DO treat recurrence language as Intensity +1. Repetition carries its own weight.
3C — Secondary Signal
If a secondary category signal is present, note it. Use it only to calibrate output depth — do not change the output framework.
- Opinion in Reflection: User has already done sophisticated self-analysis. Your output must go deeper than what they said — do not restate their own insight back at them.
- Anxiety in Aspiration: Fear underneath the goal — acknowledge the tension without dramatizing it.
- Venting in Confusion: Anger mixed into uncertainty — don't be too clinical.
- Achievement in Reflection: They're proud of the lesson — honor that, don't only dissect it.

STEP 4 — GENERATE THE SIX OUTPUT BLOCKS
The only goal of all six blocks combined: The user should finish reading and feel — "This thing just said something about me that I've never been able to say about myself." Every block either contributes to that feeling or it's in the way.
Before writing any block: ask — could this exact sentence exist in a response to a completely different entry? If yes, it is not specific enough. Do not write it.
No block should repeat what another block already said. If you find overlap, rewrite until each block is doing a distinct job.

BLOCK 1 — CARD FRONT
maps to: quote_short. Max 60 characters. Plain statement, no question mark.
The first thing the user sees. A single line that makes them want to flip the card. Not a summary — a hook. The sharpest, most compressed version of what this specific entry reveals. It must carry the flavor of this entry — not sound like something that could be printed on a mug.
- Specific enough that it couldn't apply to any random person.
- Must create curiosity about what's on the back.
- Calibrate tone to intensity: low = light, wry; mid = grounded, direct; high = heavy, earned.

BLOCK 2 — WISDOM CARD
maps to: insight_full. 500–600 characters. Dense prose, no bullets.
One complete, resonant insight drawn entirely from this user's entry. Not a restatement of what they said — one layer deeper than anything they articulated.
Do not follow a fixed structure. The insight must earn its own shape. The only requirements: it must open somewhere unexpected, and land somewhere the user didn't see coming. Unpack why the insight is true without lecturing — earn it through specificity, not assertion. Close in a way that connects to who this person is, not to people in general.
One insight only. Never two. If this card could apply to anyone, rewrite it until it could only apply to someone who wrote this entry. If the user screenshots this and sends it to a friend, the friend should think — "who wrote this, it's so specific."
Block 1 and Block 2 work together: Block 1 compresses, Block 2 expands. They must feel like one thought, not two separate outputs.
Per-category direction — what the insight must name specifically, not generally:
- Life Moments: The exact rule or pattern this specific moment encodes — not "small things matter" but what this moment proves.
- Achievement: The specific identity shift this win confirms — not "you're capable" but what kind of person does what they just did.
- Aspiration: What this desire is substituting for, or protecting — the want underneath the want.
- Confusion: The precise reason this specific confusion won't resolve — name the two things actually in conflict.
- Anxiety: What specifically the mind is refusing to accept as uncertain in this entry — not anxiety in general.
- Venting: The exact line that got crossed — not "a value was violated" but which one, how, in this situation.
- Opinion: The sharpest version of their own view — elevated and precise, not re-analyzed or questioned.
- Query: What asking this specific question right now reveals about where they are — the question as a mirror.
- Log: A portrait drawn from the distribution of what they chose to record — what the pattern of choices says.
- Reflection: The universal principle their specific lesson points toward — bigger than the situation, still anchored to it.
- Gratitude: The identity insight — what kind of person notices this, values this, feels moved by this.
- Emptiness: The precise signal this flatness is sending — not "emptiness is okay" but what this emptiness is pointing at.

BLOCK 3 — HOT COMMENT
maps to: peer_comment. 500–700 characters. No headers, no bullets, no platform meta-language.
The loyal best friend who also happens to be perceptive. Warm, direct, a little sharp. You are responding to them — not analyzing them. Like the comment on their post that made them stop scrolling.
The first sentence must land on the most specific, most loaded detail from their entry — not the overall theme. Slight "I see what you didn't say" energy is allowed, but don't perform it. No advice. No pivot. No "but have you considered." Pure reception only. No fake hype.
The last line should land like something a friend texts you that you screenshot — not because it's comforting, but because it's true.
Per-category tone:
- Life Moments: Quiet appreciation — you noticed the noticing.
- Achievement: Genuine celebration that sees the person, not just the win.
- Aspiration: Excitement that takes the desire seriously, no caveats.
- Confusion: Solidarity — being this stuck means you're thinking for real.
- Anxiety: Full acknowledgment, zero minimizing, zero silver lining.
- Venting: Completely on their side. No "well, to be fair."
- Opinion: This view has weight. I hear it.
- Query: The question itself shows something — name what.
- Log: The habit of recording is worth noticing.
- Reflection: You didn't just experience this — you learned from it. That's not common.
- Gratitude: You can feel this. Not everyone can.
- Emptiness: This is real. You're not being dramatic.

BLOCK 4 — DEEP ANALYSIS
maps to: mirror_hook_title + mirror_hook_body + flipped_lens_body
Title (mirror_hook_title): Max 8 words. Plain English, capital first letter, no emoji, no punctuation prefix, no quote marks. A statement that reframes the whole entry — not a label, not a summary. Something that makes them read twice.
Paragraph 1 — Decode (mirror_hook_body): 600–700 characters. Dense prose, no bullets. Excavate what is actually happening one layer below what the user described. Not a summary — find the thing they were circling without naming. You must use the specific detail anchors from Step 3B here — the concrete nouns, scenes, actions, opinions from their entry. Never fabricate details. Never repeat what they already said as if it's insight.
Paragraph 2 — Extend (flipped_lens_body): 800–1000 characters. Dense prose, no bullets. Build forward from Paragraph 1 — do not restate or summarize what mirror_hook_body already said. Connect this moment to a pattern or principle specific to this person and this entry — not generic life logic. Surface a direction they could move toward or verify. This paragraph bridges naturally to the tasks — do not use the words "action plan," "task," or "to-do." Use the detail anchors as grounding material throughout.
The title, Paragraph 1, and Paragraph 2 must build — each one moves forward. None of them circle back.
Per-category strategy (Paragraph 1 excavate | Paragraph 2 extend):
- Life Moments: P1 — Why this specific moment got recorded — what it reveals about what the user actually values. P2 — How this signal connects to who they're becoming — specific, not general.
- Achievement: P1 — The specific behavior or decision that actually created this outcome — not "you worked hard," name what they did. P2 — The transferable capability this reveals — what specifically becomes possible now.
- Aspiration: P1 — Why this desire is surfacing now — what internal shift or life transition is driving it. P2 — The honest gap between where they are and where they want to be — without anxiety, with respect.
- Confusion: P1 — The two specific competing needs or values actually in conflict — name both. P2 — A better question to hold — not an answer, a frame that makes this confusion productive.
- Anxiety: P1 — Separate what is real and addressable from what the mind is amplifying in this entry. P2 — Pull attention from the uncontrollable to one specific thing within reach today.
- Venting: P1 — Full view of what happened — all angles, without taking sides — surface what the situation actually was. P2 — What this reveals about what the user will not accept — their standard, not their wound.
- Opinion: P1 — Where this specific view came from — experience, environment, a turning point they've lived. P2 — A genuine counter-angle — not to invalidate, but to make the original view sharper and more defensible.
- Query: P1 — Fold the question back: where in their own experience does the answer already live. P2 — A more precise version of the question — one that will actually lead somewhere.
- Log: P1 — Read the structure of what was recorded — what the distribution of choices reveals about priorities and self-image. P2 — One pattern or principle this data points toward.
- Reflection: P1 — Why this particular lesson landed for this particular person at this particular time. P2 — How this lesson changes behavior the next time a similar situation appears — specific and behavioral.
- Gratitude: P1 — What the specific object of gratitude reveals about what this person truly values. P2 — How to orient toward more of this — not as a task, as a way of moving through the day.
- Emptiness: P1 — When this kind of flatness tends to appear — the transitional context it signals. P2 — Reframe: the space between an old self and a new one is a threshold, not a problem.

BLOCK 5 — REFLECTION QUESTION
maps to: reflective_question. One question only. Strictly under 25 words. Ends with a question mark. No preamble.
Must come directly from something specific in this entry — not a generic question about the topic. Points inward — not "what do you think about X" but "what does X reveal about you." Has tension — slightly uncomfortable because it touches something real, not because it's harsh. Unanswerable in a sentence. Not answerable with yes or no.
Invite reflection on possibility, meaning, or desire — NOT on failure, fault, or hidden motive. The user should feel pulled toward the question, not cornered by it.
Test: send this question to a stranger who hasn't read the entry. If they can answer it immediately, rewrite it.

BLOCK 6 — MICRO TASKS
maps to: task_1 + task_2. 10–30 words each, under 100 characters each. Both completable today.
task_1 — Inward/Awareness task. A concrete action with a specific object, body part, app, or feeling drawn from the entry's detail anchors. Time or count boundary required. Pick from: Sensory Anchor / Micro-Expression / Curiosity Probe / Quiet Marker / Permission Slip. Calibrate to intensity: 1–4 gentler; 5–7 mid; 8–10 gentlest. End on the action itself — do not explain why it works.
task_2 — Outward/Action task. Must be a different task type from task_1. Pick from: Loop Interrupt / Tiny Completion / Body Reset / Capability Transfer / Streak Seed / Expansion Probe / Identity Lock. Brings the core variable into a real external attempt. For Opinion entries, task_2 must involve a real conversation or dialogue. End on the action itself.
Both tasks must use at least one specific detail, object, person, or situation named in the entry. A task that could have been written without reading this entry is not acceptable.
Neither task should require more than 15 minutes. Never assign a task that requires the user to confront someone or initiate a difficult conversation unprompted.
Forbidden for both tasks: drinking water, washing face, deep breathing, sky-looking, journaling, meditating, desk-clearing.
Per-category direction (task_1 Inward | task_2 Outward):
- Life Moments: task_1 — Do one small version of what this moment pointed toward. task_2 — Notice when a similar moment appears today — pause on it.
- Achievement: task_1 — Use the capability this win revealed in one other context today. task_2 — Watch how you talk about this win — what you claim, what you downplay.
- Aspiration: task_1 — Take one micro-step toward this goal — under 10 minutes. task_2 — Notice what today's choices move toward or away from this desire.
- Confusion: task_1 — Write out the two options — just the options, no analysis. task_2 — Notice which option your body reacts to differently throughout the day.
- Anxiety: task_1 — Do one concrete thing to address the part that's actually addressable. task_2 — Notice each time the anxiety surfaces — just note it, don't engage it.
- Venting: task_1 — Do one thing that restores your own sense of agency in this situation. task_2 — Notice where your attention goes when the frustration resurfaces.
- Opinion: task_1 — Share this view with one person today — out loud, not online. task_2 — Notice how you feel when someone disagrees — what you defend, what you release.
- Query: task_1 — Find one real-life data point today relevant to this question. task_2 — Notice when you already know the answer but are looking for permission.
- Log: task_1 — Pick one item from what you logged and take one action on it. task_2 — Notice what you chose not to record — what got left out.
- Reflection: task_1 — Apply the lesson once today — in one specific, small situation. task_2 — Notice when the old pattern tries to reassert itself.
- Gratitude: task_1 — Tell one person directly — not a text, if possible. task_2 — Notice what else today belongs in this same category.
- Emptiness: task_1 — Do one thing today that you used to care about — even without feeling it. task_2 — Notice the exact moments when the flatness lifts, even briefly.

STEP 5 — QUALITY GATES
These are generation conditions, not post-generation fixes. Do not produce any block that fails them.
- quote_short must feel written for this person — not for people in general.
- insight_full must say something the user didn't already say, and open somewhere unexpected.
- peer_comment must land on a specific detail from the entry — not the overall theme.
- mirror_hook_body must excavate, not summarize. Detail anchors from Step 3B must be visibly present.
- flipped_lens_body must build forward from mirror_hook_body — not restate it.
- insight_full and mirror_hook_body must be doing different jobs — not overlapping.
- reflective_question must be under 25 words, unanswerable in a sentence, and invite — not corner.
- Both tasks must use specific details from the entry — not generic self-improvement instructions.
- Every block must pass this test: could this have been written without reading this specific entry? If yes, it is not specific enough — do not write it.
- Every sentence must pass this test: could this appear on a Pinterest board or a Headspace notification? If yes, it is not earned enough — do not write it.

OUTPUT FORMAT
Return a single valid JSON object containing EXACTLY the fields requested in the user prompt (the user prompt lists the full field contract). No markdown fences. No extra text outside the JSON. Use \n for line breaks within JSON string values. (If Step 1 crisis triggered, return ONLY the crisis JSON described above instead.)`

function buildUserPrompt(wisdomText, aspireList, forceCategory = null) {
  // When forceCategory is set (e.g. a publish that originated from a
  // Discover question is always classified as Opinion/Perspective), inject
  // an authoritative override that supersedes the Step 2 classification.
  // Empty string when not forced -> the prompt is byte-identical to before.
  const categoryOverride = forceCategory
    ? `## CATEGORY OVERRIDE (authoritative — supersedes Step 2 classification)
This entry was submitted in response to a community Discover question — the user is offering a view or take in response to a prompt, not journaling their own experience or emotional state. The category is PRE-DETERMINED and LOCKED to ${forceCategory}. Skip Step 2 classification entirely; treat the category as ${forceCategory} and apply the ${forceCategory} per-category direction in every block. (Step 1 crisis detection, the Intensity Scale, Detail Anchors, and all format rules still apply normally.)

`
    : '';
  return `Analyze the following user's raw journal entry and generate a JSON object.

<user_input>
${wisdomText.substring(0, 5000)}
</user_input>

FIRST: if Step 1 crisis detection in your instructions triggers, return ONLY {"crisis": true, "crisis_message": "..."} and nothing else — ignore every field below.

${categoryOverride}OTHERWISE return a JSON object with EXACTLY these fields, following your instructions for each:

1. "keyword"
Pick exactly ONE keyword from this list that best captures the core theme: [${ALL_KEYWORDS.join(', ')}]

2. "quote_short"
Max 60 characters. Plain statement, no question mark.

3. "insight_full"
500–600 characters. Dense prose, no bullets.

4. "peer_comment"
500–700 characters. No headers, no bullets, no platform meta-language.

5. "mirror_hook_title"
Max 8 words. Plain English only — capital first letter, no leading emoji, no leading punctuation, no quote marks.

6. "mirror_hook_body"
600–700 characters. Dense prose, no bullets.

7. "flipped_lens_body"
800–1000 characters. Dense prose, no bullets. Do not use the words "action plan," "task," or "to-do."

8. "reflective_question"
One question only, ending with a question mark, strictly under 25 words. No preamble inside the question.

9. "wisdom_emotion"
ONE keyword from this list exactly:
    Sad: Discouraged, Bitter, Sad, Apathetic, Disappointed, Dull, Powerless, Upset, Distraught
    Happy: Radiant, Overjoyed, Proud, Fulfilled, Delighted, Joyful, Elated, Hopeful, Optimistic, Connected, Happy, Cheerful, Grateful, Pleasant
    Excited: Thrilled, Pumped, Triumphant, Energized, Motivated, Empowered, Ecstatic, Inspired, Exhilarated, Driven, Buzzing, On Fire, Glowing
    Peace: Calm, Content, Reassured, Relaxed, Satisfied, Peaceful, Confident, Cozy, AtEase, Steady-Good, Comfortable, Warm, Clear-headed
    Anxious: Worried, Pressured, Impatient, Anxious, Nervous, Uneasy, Concerned, Unsettled, Stressed, Panicked, Freaked, Restless, Terrified, Startled, On Edge, Petrified, Overwhelmed, Alarmed, Worked Up, Shocked, Irrational
    Exhausting: Drained, Sluggish, Flat, Sleepy
    Fine: Neutral, Composed, Simple, Mellow, Mild, Grounded, Unbothered, Soft, Balanced, Even, Unemotional, Easy, Present, Low-key, Plain, Steady, Quiet, Meh
    Angry: Resentful, Irritated, Frustrated, Enraged, Outraged, Agitated, Tense, Furious

10. "task_1"
10–30 words, under 100 characters. Inward/Awareness task. End on the action itself.
Forbidden: drinking water, washing face, deep breathing, sky-looking, journaling, meditating, desk-clearing.

11. "task_2"
10–30 words, under 100 characters. Outward/Action task. Must be a different task type than task_1. End on the action itself.
Forbidden: same clichés as task_1.

12. "aspire_impacts"
Audit which personal growth keywords from [${aspireList}] this entry reflects, and whether the user's described BEHAVIOR moved toward or away from each.
This is an OBJECTIVE BEHAVIORAL AUDIT, independent of your warm/encouraging tone in the other blocks. If the entry describes a regression, you MUST mark it negative — do not soften a setback into "positive" just to be encouraging.
For each clearly relevant keyword return {"keyword": "exact match", "direction": "positive" or "negative"}:
- "positive": the entry shows the user EMBODYING or PRACTICING this trait — through their state OR their actions. A calm tea-and-book evening embodies "Peaceful"; finishing a hard task embodies "Disciplined"; speaking an uncomfortable truth embodies "Authentic". Positive is the default for any genuine reflection or steady state.
- "negative": the entry describes a CONCRETE BEHAVIOR that BETRAYED or RETREATED FROM this trait — an action, not merely a feeling. Examples: "Authentic" negative = lied, wore a mask, agreed against their own belief; "Resilient" negative = gave up at the first setback, fled a challenge; "Disciplined" negative = blew off a plan, doom-scrolled all day; "Focused" negative = couldn't stop getting distracted from what mattered. A negative feeling alone (anxious, sad, tired) is NOT negative — only a behavior that actively worked against the trait.
CRITICAL CONSTRAINTS: (1) Return between 1 and 3 keywords total. (2) At most ONE may be "negative." Never return two or more negatives.

13. "task_1_keyword"
If aspire_impacts contains the (single) "negative" keyword, set this to that exact keyword string. Otherwise "". Both task keywords bind to the SAME declining word so completing both tasks fully offsets the penalty.

14. "task_2_keyword"
Set to the SAME value as task_1_keyword. task_1_keyword and task_2_keyword must always be identical.

15. "daily_index"
Max 500 characters. Capture core emotion, key event/topic, main insight. Used for weekly report synthesis. Example: "Anxious about job interview -> realized preparation = self-trust -> core: letting go of perfectionism builds genuine confidence"

Return ONLY valid JSON.`
}
function enrichCard(card) {
  const kwId = card.keyword_id || 'mind-clarity'
  const category = kwId.split('-')[0] || 'mind'
  const keyword = idToSlug(kwId) || kwId.split('-').slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return { ...card, card_keywords: { keyword, category, front_image: `/images/cards/${kwId}-front.webp`, back_image: `/images/cards/${category}-back.webp` } }
}

/**
 * Generate a wisdom card from text — called directly (no HTTP self-fetch).
 *
 * @param {object} supabase - Supabase client instance
 * @param {string} wisdomId - UUID of the wisdom record
 * @param {string} wisdomText - The transcribed/typed text
 * @param {string} userId - User ID
 * @param {string|null} forceKeyword - Optional keyword override (Seek question flow)
 * @param {string|null} creatorName - Display name to stamp on wisdom_cards.creator_name
 * @param {string|null} creatorAvatar - Avatar URL to stamp on wisdom_cards.creator_avatar
 * @returns {{ success: boolean, card?: object, keyword?: string, keywordId?: string }}
 */
export async function generateWisdomCard(supabase, wisdomId, wisdomText, userId, forceKeyword = null, creatorName = null, creatorAvatar = null, quotaPeriodStart = null, monthlyLimit = null, forceCategory = null) {
  if (!wisdomText || wisdomText.length <= 5) {
    return { success: false, error: 'Text too short' }
  }

  // A2 low-quality input prefilter (cheap regex, runs BEFORE any AI call).
  // Catches only OBVIOUS garbage so a meaningful insight can't be generated
  // from it (and no quota is burned). Deliberately conservative — anything
  // that looks like a real human sentence passes through to the AI. We do
  // NOT try to judge semantic emptiness here (that risks rejecting terse but
  // genuine entries like "today was hard"); we only reject mechanical junk.
  const lowQuality = (() => {
    const t = (wisdomText || '').trim();
    const collapsed = t.replace(/\s+/g, ' ');
    const noSpace = collapsed.replace(/\s/g, '');
    if (noSpace.length === 0) return true;
    // (a) one character repeated for the whole input (aaaa, 1111, ....)
    if (/^(.)\1*$/.test(noSpace)) return true;
    // (b) a short pattern (<=2 chars) tiled to fill the input (ababab, 121212)
    if (noSpace.length >= 6 && /^(.{1,2}?)\1+$/.test(noSpace)) return true;
    // (c) digits / punctuation only — no letters in any script at all
    //     (\p{L} = any Unicode letter, so CJK / accented text still passes)
    if (!/\p{L}/u.test(noSpace)) return true;
    // (d) a single long unbroken token with no real letters mixed in:
    //     >=20 chars, zero spaces, and <30% letters (keyboard-mash like
    //     "asdkjh213/.,zxcmn"). Real words have spaces or are letter-dense.
    if (noSpace.length >= 20 && !collapsed.includes(' ')) {
      const letters = (noSpace.match(/\p{L}/gu) || []).length;
      if (letters / noSpace.length < 0.3) return true;
    }
    return false;
  })();
  if (lowQuality) {
    console.warn('[generate-card] LOW_QUALITY_INPUT rejected by prefilter');
    return { success: false, code: 'LOW_QUALITY_INPUT', error: 'Low quality input' };
  }

  // Stage 6 Bug 2 fix: aspire_impacts match pool expanded from user's
  // aspire_words (4-6 selected) to the full ASPIRE_POOL (15). The AI
  // now matches against every growth dimension, not just the user's
  // current selection — drastically reducing "no aspire bar shown"
  // outcomes. Persistence of aspire_scores for non-aspire_words keywords
  // is intentional (B-strategy carryover): if the user later picks one
  // of those words in Growth Center pencil, their historical score is
  // already there. better_self_score (avg below) is still scoped to
  // user.aspire_words only — see PATCH 3.
  if (userId) {
    // Stage 6: wisdom_portrait deprecated. We still increment
    // wisdom_share_count for back-compat (column read by /api/wisdom-center
    // GET, no UI consumer remains but the write is harmless and keeps
    // historical counts continuous).
    const { data: prof } = await supabase.from('profiles').select('wisdom_share_count').eq('id', userId).single()
    const newShareCount = (prof?.wisdom_share_count || 0) + 1
    await supabase.from('profiles').update({ wisdom_share_count: newShareCount }).eq('id', userId)
  }
  const aspireList = ASPIRE_POOL.join(', ')

  const userPrompt = buildUserPrompt(wisdomText, aspireList, forceCategory)

  // Stage 5.IAP.5.bugfix.B: when ALL AI providers fail, do NOT fall
  // back to a hardcoded placeholder card. Treat as failure, signal
  // to caller, let them roll back. publish-wisdom handles success=false
  // by deleting the wisdom row + returning HTTP 500 CARD_GENERATION_FAILED,
  // routing to the retryable error screen WITHOUT consuming quota.
  let result
  try {
    const aiResult = await callAI({
      systemInstruction: SYSTEM_INSTRUCTION,
      userText: userPrompt,
      generationConfig: { temperature: 0.7, maxOutputTokens: 5000 },
    })
    console.log(`[generate-card] Used model: ${aiResult.model}`)
    result = parseAIJson(aiResult.text)
  } catch (e) {
    console.error('[generate-card] All AI models failed:', e.message)
    return { success: false, error: e.message || 'AI generation failed' }
  }

  // Stage 1 crisis short-circuit: the prompt instructs the model to return
  // {"crisis": true, "crisis_message": "..."} (and nothing else) when the
  // entry contains self-harm / suicidal / violence / illegal themes. We do
  // NOT save anything and we do NOT treat this as a generation failure --
  // it is a deliberate safe response. publish-wisdom rolls back the wisdom
  // row, burns no quota, and surfaces crisisMessage to the client, which
  // shows it in a plain dialog instead of entering the insight view.
  if (result && result.crisis === true) {
    const CRISIS_FALLBACK =
      "What you're sharing sounds really heavy, and it deserves more than an analysis right now.\n\n" +
      "If you're going through something that feels too big to carry alone, please reach out to someone who can actually be there with you:\n\n" +
      "\u00b7 International Association for Suicide Prevention (directory of crisis centres by country): https://www.iasp.info/resources/Crisis_Centres/\n" +
      "\u00b7 Crisis Text Line (US/UK/IE/CA): Text HOME to 741741\n" +
      "\u00b7 Or speak to someone you trust \u2014 a friend, a family member, anyone who knows you.\n\n" +
      "You don't have to have it figured out before you reach out."
    return {
      success: false,
      crisis: true,
      crisisMessage:
        typeof result.crisis_message === 'string' && result.crisis_message.trim().length > 0
          ? result.crisis_message
          : CRISIS_FALLBACK,
    }
  }

  // Stage 6.WisdomFix-S3: emoji sanitize.
  // The prompt instructs AI to emit plain-text titles (no emoji
  // prefix), but Gemini/DeepSeek occasionally ignore the negative
  // instruction and prepend emoji like "🤔 The Comfort of the Known
  // Path". Defensive client-side strip ensures the saved DB row is
  // always clean regardless of model compliance. Uses Unicode property
  // escapes \p{Extended_Pictographic} which V8 (Edge runtime) supports.
  const stripLeadingEmoji = (s) => {
    if (typeof s !== 'string') return s
    return s.replace(/^[\p{Extended_Pictographic}\u200d\ufe0f\s]+/u, '').trim()
  }
  // Module 3 now outputs only mirror_hook_title as its single headline;
  // flipped_lens_title / permission_slip_title are no longer produced.
  result.mirror_hook_title = stripLeadingEmoji(result.mirror_hook_title)

  // ============================================================
  // Stage 6 follow-up (commit 36): single-decline-word enforcement.
  //
  // Product rule for the Growth Center score economy:
  //   - A publish may RAISE multiple aspire words (+2 each); no cap.
  //   - A publish may LOWER at most ONE aspire word (-2). If the AI
  //     flags several words as "negative", we keep only the first
  //     (the most prominent regression) and drop the rest -- those
  //     other words are simply not nudged this time.
  //   - The two daily tasks generated from this wisdom (task_1 /
  //     task_2) are BOTH bound to that single declining word, so
  //     completing both restores +1 +1 = +2, exactly cancelling the
  //     -2. (Task completion adds +1 per linked_keyword in
  //     daily-tasks/route.js.) Positive words never bind a task
  //     (the gain already landed at publish time).
  //
  // This block is the authoritative backstop: even if the prompt
  // fails to constrain the model, the persisted aspire_impacts, the
  // score nudges below, and the task_*_keyword fields are all
  // derived from this normalized result, so they stay consistent.
  // ============================================================
  if (Array.isArray(result.aspire_impacts)) {
    const positives = result.aspire_impacts.filter(
      (i) => i && i.keyword && i.direction === 'positive',
    )
    const negatives = result.aspire_impacts.filter(
      (i) => i && i.keyword && i.direction === 'negative',
    )
    const keptNegative = negatives.length > 0 ? negatives[0] : null
    // Stage 6 follow-up (commit 39): cap the TOTAL impacts at 3 so the
    // insight Aspire section shows at most 3 bars. The single negative
    // (if any) is always kept; positives fill the remaining slots
    // (2 when a negative is present, 3 when not). Extra positives the
    // model returned beyond the cap are dropped.
    const posLimit = keptNegative ? 2 : 3
    const keptPositives = positives.slice(0, posLimit)
    result.aspire_impacts = keptNegative
      ? [...keptPositives, keptNegative]
      : keptPositives
    const declineKeyword = keptNegative ? keptNegative.keyword : ''
    result.task_1_keyword = declineKeyword
    result.task_2_keyword = declineKeyword
  } else {
    result.aspire_impacts = []
    result.task_1_keyword = ''
    result.task_2_keyword = ''
  }

  // Stage 6 Wisdom Insight redesign: assemble new jsonb columns.
  // `reframe` = 3-part Core Reframing (mirror_hook / flipped_lens /
  // permission_slip), each with {title, body}.
  // `reflective_question` = {question} (Stage 6 follow-up commit 30
  // dropped the validation field -- legacy rows may still carry
  // {validation, question} and ReflectiveQuestion type marks
  // validation optional for backward read compatibility).
  const reframe = {
    mirror_hook: {
      title: result.mirror_hook_title || '',
      body: result.mirror_hook_body || '',
    },
    flipped_lens: {
      title: result.flipped_lens_title || '',
      body: result.flipped_lens_body || '',
    },
    permission_slip: {
      title: result.permission_slip_title || '',
      body: result.permission_slip_body || '',
    },
  }
  // Stage 6 follow-up (commit 30): Section E now emits only the
  // question -- no validation preamble. Legacy wisdom rows on the
  // jsonb column may still carry a 'validation' field; mobile
  // ReflectiveQuestion type marks it optional so legacy rows
  // remain readable, but new wisdoms write {question} only.
  const reflectiveQuestion = {
    question: result.reflective_question || '',
  }

  // forceKeyword overrides AI's keyword choice. Used by Seek question
  // flow so card art matches the question's tag regardless of AI
  // choice. Quote, insight, scores still AI-generated unchanged.
  // Stage 6.WisdomFix-S2: no more silent 'Clarity' / 'mind-clarity'
  // fallback. The product contract is "AI must pick one of the 48
  // keywords." If AI returns a string that doesn't match (or
  // forceKeyword is bogus), fail the whole publish and let the user
  // retry — fabricating a Clarity card unrelated to their input is
  // the worst possible UX (matches §5.3 lesson: "graceful fallback is
  // wrong when the fallback isn't actually graceful").
  const matchedKeyword = forceKeyword
    ? ALL_KEYWORDS.find(k => k.toLowerCase() === forceKeyword.toLowerCase())
    : ALL_KEYWORDS.find(k => k.toLowerCase() === (result.keyword || '').toLowerCase())
  if (!matchedKeyword) {
    const provided = forceKeyword ?? result.keyword ?? '(none)'
    console.error('[generate-card] Keyword match failed. AI/force provided:', provided)
    return { success: false, error: `Keyword "${provided}" not in the 48-keyword set` }
  }
  const keywordId = slugToId(matchedKeyword)
  if (!keywordId) {
    // Theoretically unreachable: ALL_KEYWORDS is derived from KEYWORDS
    // and slugToId is the inverse mapping. Guard exists so any future
    // drift between the two surfaces immediately instead of silently
    // saving a stale id.
    console.error('[generate-card] slugToId returned undefined for slug:', matchedKeyword)
    return { success: false, error: `slugToId failed for "${matchedKeyword}"` }
  }

  const cardPayload = {
      wisdom_id: wisdomId || null,
      user_id: userId || null,
      keyword_id: keywordId,
      quote_short: (result.quote_short || '').substring(0, 60),
      insight_full: result.insight_full || '',
      // Stage 6 follow-up: peer_comment is the new Section C "Truth-
      // Telling Peer" text rendered in a chat-bubble block between
      // Block 3 (Inner Profile) and Block 4 (Reframe) of InsightView.
      // null when AI returns empty -- InsightView hides the block.
      peer_comment: (result.peer_comment || '').trim() || null,
      card_a: (result.quote_short || '').substring(0, 60),
      // Stage 6: reframe + reflective_question replace card_b/card_c
      // for new wisdoms. card_b / card_c columns kept on the table for
      // legacy data display, but no longer written by new wisdoms.
      reframe,
      reflective_question: reflectiveQuestion,
      wisdom_emotion: result.wisdom_emotion || 'Reflective',
      task_1: (result.task_1 || '').substring(0, 120),
      task_2: (result.task_2 || '').substring(0, 120),
      creator_name: creatorName,
      creator_avatar: creatorAvatar,
      // Stage 5.WR.1: persist AI-returned aspire_impacts so weekly-report
      // can replay-compute traitChanges over the last 7 days. Cast to
      // null when empty/missing — DB column is jsonb, nullable.
      aspire_impacts: Array.isArray(result.aspire_impacts) && result.aspire_impacts.length > 0
        ? result.aspire_impacts
        : null,
  }

  // ============================================================
  // Quota-safe insert (publish-quota race fix). When the caller passes the
  // billing-period start + limit (publish-wisdom does), route the INSERT
  // through insert_wisdom_card_if_under_quota: it re-counts cards in the
  // window under a per-user advisory lock and inserts ONLY if still under
  // quota, closing the TOCTOU where concurrent publishes each pass a stale
  // pre-check and all create a card. Falls back to a plain insert when the
  // params are absent (defensive; publish-wisdom is the only caller and
  // always passes them).
  // ============================================================
  let savedCard = null
  let dbError = null
  if (quotaPeriodStart != null && monthlyLimit != null) {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('insert_wisdom_card_if_under_quota', {
      p_user_id: userId,
      p_period_start: quotaPeriodStart,
      p_limit: monthlyLimit,
      p_card: cardPayload,
    })
    if (rpcErr) {
      dbError = rpcErr
    } else if (rpcData && rpcData.quota_exceeded === true) {
      return { success: false, code: 'QUOTA_EXCEEDED' }
    } else {
      savedCard = (rpcData && rpcData.card) || null
    }
  } else {
    const _ins = await supabase.from('wisdom_cards').insert(cardPayload).select().single()
    savedCard = _ins.data
    dbError = _ins.error
  }

  // Stage 6.WisdomFix-S1: DB save failure must propagate as a
  // hard failure, not a silent fallback. The pre-fix code returned
  // success:true with a `temp-<timestamp>` in-memory card object;
  // PhaseInsight then rendered the user's "Release" card correctly
  // (data was in memory) but Collection / My Logs forever missed it
  // (DB had no row), and the user's monthly quota was consumed for a
  // ghost card. Matches §5.3 lesson: rollback over fabricate-success.
  if (dbError) {
    console.error('[generate-card] DB save error:', dbError.message)
    return { success: false, error: 'DB save failed: ' + dbError.message }
  }
  if (!savedCard) {
    // Defensive: should be unreachable when dbError is null, but
    // .select().single() can technically return data:null in edge cases.
    console.error('[generate-card] DB insert returned null savedCard with no dbError')
    return { success: false, error: 'DB save returned null' }
  }
  const card = savedCard

  // Update aspire scores. Stage 6: also capture the updated scores
  // object into the function-scope `updatedAspireScores` so we can
  // return it. The mobile insight page renders an aspire progress bar
  // for the first aspire_impacts keyword; it needs the *new* score
  // (after the +/-2 nudge) to size the bar correctly without making
  // a follow-up /api/profile fetch.
  let updatedAspireScores = null
  if (userId && result.aspire_impacts && Array.isArray(result.aspire_impacts) && result.aspire_impacts.length > 0) {
    try {
      // Stage 6 Bug 2 fix: also read aspire_words so better_self_score
      // can be scoped to the user's 4-6 selected aspire words only.
      // Matches /api/update-profile's algorithm — both write sites
      // for better_self_score now use the same formula. Earlier code
      // used avg(Object.values(scores)) which diluted the score as
      // ASPIRE_POOL expanded (every newly matched keyword pulled the
      // average toward its own value).
      const { data: prof } = await supabase
        .from('profiles')
        .select('aspire_scores, aspire_words')
        .eq('id', userId)
        .single()
      const scores = prof?.aspire_scores || {}
      const userAspireWords = Array.isArray(prof?.aspire_words) ? prof.aspire_words : []
      for (const impact of result.aspire_impacts) {
        if (impact.keyword && impact.direction) {
          const current = scores[impact.keyword] ?? 70
          scores[impact.keyword] = impact.direction === 'positive'
            ? Math.min(100, current + 2) : Math.max(40, current - 2)
        }
      }
      // better_self_score = avg of the user's SELECTED words only
      // (ASPIRE_POOL match writes scores for all 15, but only the
      // 4-6 user-picked ones count toward the displayed avg).
      // Unscored selected words contribute 70 (the seed default).
      const userScoreVals = userAspireWords.map(w => scores[w] ?? 70)
      const avg = userScoreVals.length > 0
        ? Math.round(userScoreVals.reduce((a, b) => a + b, 0) / userScoreVals.length)
        : 70
      const profileUpdate = { aspire_scores: scores, better_self_score: avg }
      await supabase.from('profiles').update(profileUpdate).eq('id', userId)
      updatedAspireScores = scores
    } catch (e) { console.error('Aspire score update error:', e) }
  }

  // Save daily_index
  if (wisdomId && result.daily_index) {
    try {
      await supabase.from('wisdoms')
        .update({ daily_index: (result.daily_index || '').substring(0, 250) })
        .eq('id', wisdomId)
    } catch (e) {
      console.warn('[daily_index] save failed:', e.message)
    }
  }

  const cardWithMeta = enrichCard(card)
  cardWithMeta.task_1_keyword = result.task_1_keyword || ''
  cardWithMeta.task_2_keyword = result.task_2_keyword || ''
  cardWithMeta.aspire_impacts = result.aspire_impacts || []

  return {
    success: true,
    card: cardWithMeta,
    keyword: matchedKeyword,
    keywordId,
    wisdomEmotion: result.wisdom_emotion || 'Reflective',
    dbSaved: !dbError,
    // Stage 6: post-update aspire_scores snapshot, used by the mobile
    // insight page to size the Aspire progress bar without a follow-up
    // /api/profile fetch. Null if no aspire_impacts were generated
    // for this wisdom (mobile will hide the Aspire sub-section).
    aspireScores: updatedAspireScores,
  }
}

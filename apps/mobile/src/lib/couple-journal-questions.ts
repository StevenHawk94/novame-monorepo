// Bundled verbatim from the server's fifty-question seed. The server remains
// authoritative for pair timezone, page identity and saved answers.
export const COUPLE_JOURNAL_QUESTIONS = [
  {
    "id": "cj_01",
    "question": "What small thing made you feel close to me this week?"
  },
  {
    "id": "cj_02",
    "question": "When did we make each other laugh lately?"
  },
  {
    "id": "cj_03",
    "question": "What everyday ritual feels like ours?"
  },
  {
    "id": "cj_04",
    "question": "What is a moment from our first month together that still makes you smile?"
  },
  {
    "id": "cj_05",
    "question": "Which ordinary day together would you happily live again?"
  },
  {
    "id": "cj_06",
    "question": "What place feels different now because we went there together?"
  },
  {
    "id": "cj_07",
    "question": "What meal or snack has become part of our story?"
  },
  {
    "id": "cj_08",
    "question": "When did you first feel truly comfortable being yourself with me?"
  },
  {
    "id": "cj_09",
    "question": "What tiny kindness from me have you kept in your memory?"
  },
  {
    "id": "cj_10",
    "question": "What song takes you back to a moment we shared?"
  },
  {
    "id": "cj_11",
    "question": "What was our funniest misunderstanding?"
  },
  {
    "id": "cj_12",
    "question": "What did we do together that surprised you in a good way?"
  },
  {
    "id": "cj_13",
    "question": "Which photo of us has a story that the picture cannot tell?"
  },
  {
    "id": "cj_14",
    "question": "What is a quiet moment between us you wish we could bottle?"
  },
  {
    "id": "cj_15",
    "question": "When did we turn a difficult day into a softer one?"
  },
  {
    "id": "cj_16",
    "question": "What little adventure of ours deserves a second chapter?"
  },
  {
    "id": "cj_17",
    "question": "What is something we have learned to do better together?"
  },
  {
    "id": "cj_18",
    "question": "Which shared joke still gets you every time?"
  },
  {
    "id": "cj_19",
    "question": "What detail from a trip or walk together do you remember most clearly?"
  },
  {
    "id": "cj_20",
    "question": "When have you felt especially supported by me?"
  },
  {
    "id": "cj_21",
    "question": "What was the first thing we made or cooked together?"
  },
  {
    "id": "cj_22",
    "question": "What has become more fun because we do it as a pair?"
  },
  {
    "id": "cj_23",
    "question": "Which rainy-day memory of ours would you like to revisit?"
  },
  {
    "id": "cj_24",
    "question": "What is one way our home or favorite spot reflects us?"
  },
  {
    "id": "cj_25",
    "question": "What little habit of mine makes you smile?"
  },
  {
    "id": "cj_26",
    "question": "When did we feel like a team without needing to say it?"
  },
  {
    "id": "cj_27",
    "question": "What was a lovely surprise we stumbled into together?"
  },
  {
    "id": "cj_28",
    "question": "Which celebration of ours felt most like us?"
  },
  {
    "id": "cj_29",
    "question": "What is a memory of us being wonderfully silly?"
  },
  {
    "id": "cj_30",
    "question": "What have we discovered about each other this year?"
  },
  {
    "id": "cj_31",
    "question": "What is one conversation with me you still think about?"
  },
  {
    "id": "cj_32",
    "question": "When did a simple hello or goodbye mean more than usual?"
  },
  {
    "id": "cj_33",
    "question": "What shared tradition would you like us to keep?"
  },
  {
    "id": "cj_34",
    "question": "What did we notice together that other people might have missed?"
  },
  {
    "id": "cj_35",
    "question": "Which small win of ours deserves another celebration?"
  },
  {
    "id": "cj_36",
    "question": "When did you feel proud of how we handled something together?"
  },
  {
    "id": "cj_37",
    "question": "What memory of us outdoors comes to mind first?"
  },
  {
    "id": "cj_38",
    "question": "What is a cozy moment we created out of almost nothing?"
  },
  {
    "id": "cj_39",
    "question": "What new experience felt easier because we tried it together?"
  },
  {
    "id": "cj_40",
    "question": "Which part of our story would you tell a future version of us?"
  },
  {
    "id": "cj_41",
    "question": "What did we laugh about when plans went wrong?"
  },
  {
    "id": "cj_42",
    "question": "What gesture of care between us has become familiar and lovely?"
  },
  {
    "id": "cj_43",
    "question": "What is a moment when we understood each other without many words?"
  },
  {
    "id": "cj_44",
    "question": "Which shared memory has grown sweeter with time?"
  },
  {
    "id": "cj_45",
    "question": "What is a little thing we do that feels uniquely ours?"
  },
  {
    "id": "cj_46",
    "question": "When did we make an unfamiliar place feel welcoming?"
  },
  {
    "id": "cj_47",
    "question": "What is a favorite memory from a morning or late night together?"
  },
  {
    "id": "cj_48",
    "question": "What is something we once worried about that we can smile at now?"
  },
  {
    "id": "cj_49",
    "question": "What moment recently reminded you how far we have come?"
  },
  {
    "id": "cj_50",
    "question": "What memory would you like us to make next?"
  }
] as const;

export function coupleJournalDate(timezone: string, now = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone,
    }).formatToParts(new Date(now));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch { return new Date(now).toISOString().slice(0, 10); }
}
export function coupleJournalQuestion(date: string) {
  // Mirrors SQL: 1 + (((date - DATE '2026-10-01') % 50 + 50) % 50).
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.UTC(2026, 9, 1)) / 86_400_000);
  return COUPLE_JOURNAL_QUESTIONS[((days % 50) + 50) % 50];
}
export const localJournalPageId = (date: string) => `local:${date}`;
export const isLocalJournalPage = (id: string) => id.startsWith('local:');

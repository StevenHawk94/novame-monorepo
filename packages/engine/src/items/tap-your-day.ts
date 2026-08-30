import legacyChoices from './tap-your-day-v1.json';

/** Curated choices, not keyword matches. Keep labels separate from representative art. */
export const TAP_YOUR_DAY_VERSION = 'tap-your-day-v2';
/** Product limit for one Tap Your Day reflection. */
export const MAX_TAP_YOUR_DAY_SELECTIONS = 30;
/**
 * Transport-safety ceiling above the entire bundled 5,439-item catalog.
 * This is not a product/display limit and never truncates visible items; it
 * only rejects a malformed request containing more rows than the catalog.
 */
export const MAX_REFLECT_ITEMS = 6000;

export type TapYourDayKind = 'activity' | 'food' | 'person' | 'feeling';
export interface TapYourDayChoice { label: string; itemId: string }
export interface TapYourDayGroup { title: string; choices: TapYourDayChoice[] }
export interface TapYourDayQuestion {
  kind: TapYourDayKind;
  title: string;
  groups: TapYourDayGroup[];
}

function group(title: string, entries: [string, string][]): TapYourDayGroup {
  return { title, choices: entries.map(([label, itemId]) => ({ label, itemId })) };
}

export const TAP_YOUR_DAY_QUESTIONS: TapYourDayQuestion[] = [
  {
    kind: 'activity', title: 'How did you spend your day?', groups: [
      group('DAILY RHYTHM', [
        ['At Home', 'memory.1452_home'],
        ['Work', 'memory.1541_workplace'],
        ['School', 'memory.1551_school'],
        ['Studying', 'memory.3002_workbook'],
        ['Commuting', 'memory.2127_bus'],
        ['Errands', 'memory.2345_checklist_card'],
        ['Shopping', 'memory.5389_shopping'],
        ['Life Admin', 'memory.2950_planner'],
        ['Appointments', 'memory.1435_appointment_book'],
        ['Travel', 'memory.2207_travel_luggage'],
      ]),
      group('HOME & CARE', [
        ['Chores', 'memory.3990_cleaning_caddy'],
        ['Cooking', 'memory.1399_cooking'],
        ['Baking', 'memory.0005_baking'],
        ['Home Projects', 'memory.1436_toolbox'],
        ['Gardening', 'memory.1400_gardening'],
        ['Pet Care', 'memory.1441_pet_bowl'],
        ['Caregiving', 'memory.1417_hugging'],
        ['Health Care', 'memory.3461_first_aid_kit'],
      ]),
      group('MOVEMENT & OUTDOORS', [
        ['Outdoors', 'memory.1486_park'],
        ['Gym', 'memory.1299_fitness'],
        ['Sports', 'memory.1325_basketball'],
        ['Walking', 'memory.1297_walking'],
        ['Running', 'memory.0004_running'],
        ['Cycling', 'memory.1306_bicycle'],
        ['Yoga', 'memory.1304_yoga'],
        ['Hiking', 'memory.1298_hiking'],
        ['Swimming', 'memory.1307_swimming'],
      ]),
      group('SOCIAL & GOING OUT', [
        ['Socializing', 'memory.1403_picnic'],
        ['Date', 'memory.1491_restaurant'],
        ['Calls & Chats', 'memory.5388_messaging'],
        ['Parties', 'memory.2217_party'],
        ['Events', 'memory.2261_event_ticket'],
        ['Volunteering', 'memory.1594_volunteer_center'],
      ]),
      group('ENTERTAINMENT & DOWNTIME', [
        ['Movies', 'memory.1363_movie_theater'],
        ['TV', 'memory.1362_television'],
        ['Gaming', 'memory.1368_game_controller'],
        ['Reading', 'memory.0006_book'],
        ['Music', 'memory.5387_music'],
        ['Podcasts', 'memory.1364_podcast'],
        ['Social Media', 'memory.5385_social_media'],
        ['Relaxing', 'memory.1421_bed'],
      ]),
      group('HOBBIES & PERSONAL GROWTH', [
        ['Art & Crafts', 'memory.4827_artist_paint_palette'],
        ['Writing', 'memory.2876_notebook'],
        ['Photography', 'memory.1397_camera'],
        ['Making Music', 'memory.1367_making_music'],
        ['DIY', 'memory.4042_claw_hammer'],
        ['Learning', 'memory.3006_globe'],
        ['Meditation', 'memory.1430_meditation'],
        ['Self-Care', 'memory.1426_skincare'],
      ]),
    ],
  },
  {
    kind: 'food', title: 'What did you eat or drink?', groups: [
      group('MEALS', [
        ['Breakfast', 'memory.0358_breakfast_platter'],
        ['Noodles', 'memory.0718_rice_noodles'],
        ['Pizza', 'memory.0003_pizza'],
        ['Pasta', 'memory.0045_spaghetti'],
        ['Sandwich', 'memory.0009_sandwich'],
        ['Wrap', 'memory.0011_wrap'],
        ['Burger', 'memory.0007_burger'],
        ['Taco', 'memory.0017_taco'],
        ['Dumplings', 'memory.0066_dumplings'],
        ['Sushi', 'memory.0062_sushi'],
        ['Salad', 'memory.0079_salad'],
        ['Rice', 'memory.0056_rice_bowl'],
        ['Soup', 'memory.0078_soup'],
        ['Curry', 'memory.0059_curry'],
        ['Meat', 'memory.0027_steak'],
        ['Seafood', 'memory.0076_seafood_boil'],
        ['Vegetables', 'memory.0087_roasted_vegetables'],
        ['Fast Food', 'memory.5392_chicken_nuggets'],
      ]),
      group('CUISINE', [
        ['American Food', 'memory.0040_corn_dog'],
        ['Chinese Food', 'memory.0119_dim_sum'],
        ['Japanese Food', 'memory.0266_bento_box'],
        ['Korean Food', 'memory.0122_korean_bbq'],
        ['Mexican Food', 'memory.0021_enchiladas'],
        ['Italian Food', 'memory.0048_ravioli'],
        ['Indian Food', 'memory.0149_chicken_tikka_masala'],
        ['Thai Food', 'memory.0053_pad_thai'],
        ['Vietnamese Food', 'memory.0051_pho'],
        ['Mediterranean Food', 'memory.1230_falafel_plate'],
        ['Middle Eastern Food', 'memory.0042_shawarma'],
        ['Caribbean Food', 'memory.0186_jerk_chicken'],
        ['Filipino Food', 'memory.0166_adobo'],
        ['French Food', 'memory.0320_crepes'],
        ['Greek Food', 'memory.0015_gyro'],
        ['Ethiopian Food', 'memory.0267_injera'],
      ]),
      group('SNACKS', [
        ['Fruit', 'memory.2844_fruit_bowl'],
        ['Snack', 'memory.1258_rice_crackers'],
        ['Pastry', 'memory.0363_croissant'],
        ['Dessert', 'memory.0455_ice_cream'],
      ]),
      group('DRINKS', [
        ['Water', 'memory.0507_water'],
        ['Coffee', 'memory.0002_coffee'],
        ['Tea', 'memory.0510_tea'],
        ['Juice', 'memory.0520_juice'],
        ['Smoothie', 'memory.0527_smoothie'],
        ['Soda', 'memory.0537_soda'],
        ['Milk', 'memory.0530_milk'],
        ['Energy Drink', 'memory.0535_energy_drink'],
        ['Alcohol', 'memory.0557_beer'],
      ]),
    ],
  },
  {
    kind: 'person', title: 'Who was part of your day?', groups: [
      group('', [
        ['Just Me', 'tap.person.just_me'],
        ['Partner', 'tap.person.partner'],
        ['Family', 'tap.person.family'],
        ['Friends', 'tap.person.friends'],
        ['Pets', 'tap.person.pets'],
      ]),
    ],
  },
  {
    kind: 'feeling', title: 'How did today feel?', groups: [
      group('', [
        ['Happy', 'memory.5355_happy'],
        ['Calm', 'memory.5356_calm'],
        ['Cool', 'memory.5357_cool'],
        ['Excited', 'memory.5358_excited'],
        ['Angelic', 'memory.5359_angelic'],
        ['Shy Smile', 'memory.5360_shy_smile'],
        ['Blowing a Kiss', 'memory.5361_blowing_a_kiss'],
        ['In Love', 'memory.5362_in_love'],
        ['Neutral', 'memory.5363_neutral'],
        ['Playful', 'memory.5364_playful'],
        ['Laughing', 'memory.5365_laughing'],
        ['Surprised', 'memory.5366_surprised'],
        ['Crying', 'memory.5367_crying'],
        ['Worried', 'memory.5368_worried'],
        ['Dizzy', 'memory.5369_dizzy'],
        ['Sad', 'memory.5370_sad'],
        ['Angry', 'memory.5371_angry'],
        ['Anxious', 'memory.5372_anxious'],
        ['Lonely', 'memory.5373_lonely'],
        ['Tearful', 'memory.5374_tearful'],
        ['Bandaged', 'memory.5375_bandaged'],
        ['Frustrated', 'memory.5376_frustrated'],
        ['Mischievous', 'memory.5377_mischievous'],
        ['Nauseous', 'memory.5378_nauseous'],
        ['Sleepy', 'memory.5379_sleepy'],
        ['Celebrating', 'memory.5380_celebrating'],
        ['Money Excited', 'memory.5381_money_excited'],
        ['Flirty', 'memory.5382_flirty'],
        ['Annoyed', 'memory.5383_annoyed'],
        ['Silly', 'memory.5384_silly'],
      ]),
    ],
  },
];

export const TAP_YOUR_DAY_CHOICES = TAP_YOUR_DAY_QUESTIONS.flatMap((question) =>
  question.groups.flatMap((section) => section.choices.map((choice) => ({ ...choice, kind: question.kind }))),
);
const choicesById = new Map(TAP_YOUR_DAY_CHOICES.map((choice) => [choice.itemId, choice]));
// Frozen v1 vocabulary: an older installed client keeps its original meanings.
const legacyById = new Map(legacyChoices.map((choice) => [choice.itemId, choice]));
export function tapYourDaySelectionLimit(version: unknown) {
  if (version === 'tap-your-day-v3') return MAX_TAP_YOUR_DAY_SELECTIONS;
  if (version === TAP_YOUR_DAY_VERSION) return MAX_TAP_YOUR_DAY_SELECTIONS;
  if (version === 'tap-your-day-v1') return MAX_TAP_YOUR_DAY_SELECTIONS;
  return 0;
}
export function tapYourDayChoice(itemId: string, version = TAP_YOUR_DAY_VERSION) {
  if (version === 'tap-your-day-v3') return choicesById.get(itemId);
  if (version === TAP_YOUR_DAY_VERSION) return choicesById.get(itemId);
  if (version === 'tap-your-day-v1') return legacyById.get(itemId);
  return undefined;
}

function requireRow(result) {
  if (result.error) throw result.error
  return result.data
}

function projectedNeed(value, updatedAt, now) {
  const safeValue = Math.max(0, Math.min(100, Math.trunc(Number(value) || 0)))
  const updatedMs = new Date(updatedAt).getTime()
  return !Number.isFinite(updatedMs) || now <= updatedMs
    ? safeValue : Math.max(0, safeValue - Math.floor((now - updatedMs) / 300_000))
}

function localDate(now, timezone) {
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now)
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now)
  }
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

/** Read-only, self-scoped snapshot. Never initialize a wallet or expose a former partner. */
export async function unpairedBurrowBootstrap(db, userId) {
  const [profile, revision] = await Promise.all([
    db.from('profiles').select('id,display_name,avatar_url,subscription_tier,timezone_name').eq('id', userId).maybeSingle(),
    db.from('app_config').select('value').eq('key', 'app_major_update_content_revision').maybeSingle(),
  ])
  const person = requireRow(profile)
  const contentRevision = requireRow(revision)?.value
  if (!person || !contentRevision) throw new Error('unpaired_bootstrap_unavailable')
  const published = requireRow(await db.from('content_revisions').select('id')
    .eq('id', contentRevision).eq('status', 'published').maybeSingle())
  if (!published) throw new Error('unpaired_bootstrap_unavailable')

  const [wallet, needs, catalog, inventory, loadouts, friends, discoveries, prompts] = await Promise.all([
    db.from('wallets').select('carrot_balance,version').eq('user_id', userId).maybeSingle(),
    db.from('room_needs').select('food_value,food_updated_at,water_value,water_updated_at').eq('owner_id', userId).maybeSingle(),
    db.from('catalog_items').select('stable_id,item_type,category,title,description,price,plus_only,tradable,tags,asset,metadata,is_placeholder').eq('revision_id', contentRevision).eq('status', 'active').order('category').order('stable_id'),
    db.from('user_inventory').select('id,owner_id,item_id,source').eq('owner_id', userId),
    db.from('room_loadouts').select('room_type,owner_id,slot,item_id').eq('room_type', 'home').eq('owner_id', userId),
    db.from('friend_definitions').select('stable_id,name,subtitle').eq('revision_id', contentRevision).eq('status', 'active'),
    db.from('user_friend_discoveries').select('user_id,friend_id,interaction_completed_at').eq('user_id', userId),
    db.from('memory_prompts').select('stable_id,prompt').eq('revision_id', contentRevision).eq('status', 'active').order('position'),
  ])
  const now = new Date()
  const timestamp = now.toISOString()
  const room = requireRow(needs)
  const foodUpdatedAt = room?.food_updated_at || timestamp
  const waterUpdatedAt = room?.water_updated_at || timestamp
  const balance = requireRow(wallet)
  const day = localDate(now, person.timezone_name)
  return {
    unpaired: true,
    rollout: { enabled: true, contentRevision },
    serverNow: timestamp, localDate: day,
    profile: person, partner: null, hasPlus: !!person.subscription_tier && person.subscription_tier !== 'free',
    wallet: { balance: balance?.carrot_balance ?? 0, version: balance?.version ?? 0 },
    roomNeeds: {
      food: projectedNeed(room?.food_value ?? 100, foodUpdatedAt, now.getTime()), foodValue: room?.food_value ?? 100, foodUpdatedAt,
      water: projectedNeed(room?.water_value ?? 100, waterUpdatedAt, now.getTime()), waterValue: room?.water_value ?? 100, waterUpdatedAt,
      serverNow: timestamp,
    },
    partnerNeeds: { food: 100, water: 100 },
    sharedRoom: { mySleeping: false, partnerSleeping: false, updatedBy: null, updatedAt: null, decoratedBy: null },
    musicTrackId: null, dollChangeUsed: false, roomPhotos: [],
    friendVisit: null, friendVisitDate: day, friendVisitTimezone: person.timezone_name || 'UTC',
    activeAdventure: null, partnerAdventure: null, adventureResult: null, readyRecordId: null, dailyAdventureUsed: false,
    quests: { error: null, localDate: day, quests: [] }, specialQuests: [],
    memoryPrompts: (requireRow(prompts) || []).map(row => ({ id: row.stable_id, prompt: row.prompt })), memoryEntries: [],
    catalog: requireRow(catalog) || [], inventory: requireRow(inventory) || [], loadouts: requireRow(loadouts) || [],
    friends: requireRow(friends) || [], discoveries: requireRow(discoveries) || [], friendContent: [],
    moments: [], gifts: [], affectionInbox: [], lastAffectionAt: null, unread: { affection: 0, gifts: 0 },
  }
}

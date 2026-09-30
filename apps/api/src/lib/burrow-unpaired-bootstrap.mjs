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

/** Self-scoped snapshot. Never expose a former partner's private data. */
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
  const initialized = requireRow(await db.rpc('solo_burrow_initialize_v1', { p_user_id: userId }))
  if (initialized?.error) throw new Error(initialized.error)

  const now = new Date()
  const day = localDate(now, person.timezone_name)
  const [wallet, needs, catalog, inventory, loadouts, friends, discoveries, prompts,
    quests, specials, moments, memories, adventures, readyRecords, music, photos, dollChanges] = await Promise.all([
    db.from('wallets').select('carrot_balance,version').eq('user_id', userId).maybeSingle(),
    db.from('room_needs').select('food_value,food_updated_at,water_value,water_updated_at').eq('owner_id', userId).maybeSingle(),
    db.from('catalog_items').select('stable_id,item_type,category,title,description,price,plus_only,tradable,tags,asset,metadata,is_placeholder').eq('revision_id', contentRevision).eq('status', 'active').order('category').order('stable_id'),
    db.from('user_inventory').select('id,owner_id,item_id,source').eq('owner_id', userId),
    db.from('room_loadouts').select('room_type,owner_id,slot,item_id').eq('room_type', 'home').eq('owner_id', userId),
    db.from('friend_definitions').select('stable_id,name,subtitle').eq('revision_id', contentRevision).eq('status', 'active'),
    db.from('user_friend_discoveries').select('user_id,friend_id,interaction_completed_at').eq('user_id', userId),
    db.from('memory_prompts').select('stable_id,prompt').eq('revision_id', contentRevision).eq('status', 'active').order('position'),
    db.rpc('assign_daily_quests_v1', { p_user_id: userId }),
    db.rpc('burrow_special_quests_v1', { p_user_id: userId }),
    db.from('moment_events').select('id,actor_id,event_type,reference_id,reference_type,created_at,payload').eq('pair_low', userId).eq('pair_high', userId).order('created_at', { ascending: false }).limit(50),
    db.from('memory_room_entries').select('id,author_id,body,prompt_id,created_at,updated_at').eq('pair_low', userId).eq('pair_high', userId).is('deleted_at', null).order('created_at', { ascending: false }).limit(100),
    db.from('adventures').select('id,status,started_at,ends_at,local_date').eq('user_id', userId).eq('partner_id', userId).order('created_at', { ascending: false }).limit(1),
    db.from('reflects').select('id').eq('user_id', userId).eq('local_date', day).in('journal_kind', ['write_freely', 'tap_your_day']).order('id').limit(10),
    db.from('room_music').select('track_id').eq('owner_id', userId).maybeSingle(),
    db.from('room_photos').select('id,owner_id,kind,updated_at').eq('pair_low', userId).eq('pair_high', userId),
    db.from('room_photo_uploads').select('id').eq('actor_id', userId).eq('kind', 'doll').eq('committed_date', day).limit(1),
  ])
  const timestamp = now.toISOString()
  const room = requireRow(needs)
  const foodUpdatedAt = room?.food_updated_at || timestamp
  const waterUpdatedAt = room?.water_updated_at || timestamp
  const balance = requireRow(wallet)
  const personalMemories = requireRow(memories) || []
  const personalMoments = requireRow(moments) || []
  let memoryPhotos = []
  if (personalMemories.length) {
    memoryPhotos = requireRow(await db.from('memory_entry_photos').select('id,entry_id,slot,updated_at')
      .in('entry_id', personalMemories.map(row => row.id))) || []
  }
  const momentRecordIds = personalMoments.filter(row => row.reference_type === 'reflect' && row.actor_id === userId)
    .map(row => row.reference_id).filter(Boolean)
  let momentRecords = []
  let momentItems = []
  if (momentRecordIds.length) {
    const [records, items] = await Promise.all([
      db.from('reflects').select('id,body').eq('user_id', userId).in('id', momentRecordIds),
      db.from('reflect_items').select('reflect_id,item_id,match_label').eq('user_id', userId).in('reflect_id', momentRecordIds),
    ])
    momentRecords = requireRow(records) || []
    momentItems = requireRow(items) || []
  }
  const recentAdventures = requireRow(adventures) || []
  const activeAdventure = recentAdventures.find(row => ['in_progress', 'result_ready', 'interaction_required'].includes(row.status)) || null
  const result = activeAdventure ? requireRow(await db.from('adventure_results').select('id,result_type,item_id,friend_id,claim_status,metadata').eq('adventure_id', activeAdventure.id).maybeSingle()) : null
  const recordIds = (requireRow(readyRecords) || []).map(row => row.id)
  let readyRecordId = null
  if (recordIds.length && !recentAdventures.some(row => row.local_date === day)) {
    const [drafts, used] = await Promise.all([
      db.from('reflect_drafts').select('finalized_reflect_id').eq('user_id', userId).in('finalized_reflect_id', recordIds),
      db.from('adventures').select('record_id').eq('user_id', userId).in('record_id', recordIds),
    ])
    const finalized = new Set((requireRow(drafts) || []).map(row => row.finalized_reflect_id))
    const consumed = new Set((requireRow(used) || []).map(row => row.record_id))
    readyRecordId = recordIds.find(id => finalized.has(id) && !consumed.has(id)) || null
  }
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
    musicTrackId: requireRow(music)?.track_id || null,
    dollChangeUsed: !!requireRow(dollChanges)?.length,
    roomPhotos: (requireRow(photos) || []).map(row => ({ id: row.id, ownerId: row.owner_id,
      kind: row.kind, updatedAt: row.updated_at })),
    friendVisit: null, friendVisitDate: day, friendVisitTimezone: person.timezone_name || 'UTC',
    activeAdventure, partnerAdventure: null, adventureResult: result, readyRecordId,
    dailyAdventureUsed: recentAdventures.some(row => row.local_date === day),
    quests: requireRow(quests), specialQuests: requireRow(specials) || [],
    memoryPrompts: (requireRow(prompts) || []).map(row => ({ id: row.stable_id, prompt: row.prompt })),
    memoryEntries: personalMemories.map(row => ({ ...row, photos: memoryPhotos.filter(photo => photo.entry_id === row.id)
      .map(photo => ({ id: photo.id, slot: photo.slot, updatedAt: photo.updated_at })) })),
    catalog: requireRow(catalog) || [], inventory: requireRow(inventory) || [], loadouts: requireRow(loadouts) || [],
    friends: requireRow(friends) || [], discoveries: requireRow(discoveries) || [], friendContent: [],
    moments: personalMoments.map(row => {
      const record = row.reference_type === 'reflect' ? momentRecords.find(item => item.id === row.reference_id) : null
      return { ...row, record: record ? { id: record.id, body: record.body || '', shared: false, version: 0,
        items: momentItems.filter(item => item.reflect_id === record.id).map(item => ({
          itemId: item.item_id, label: item.match_label || item.item_id, memory: null,
        })) } : null }
    }), gifts: [], affectionInbox: [], lastAffectionAt: null, unread: { affection: 0, gifts: 0 },
  }
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unpairedBurrowBootstrap } from '../apps/api/src/lib/burrow-unpaired-bootstrap.mjs'

function database(rows, calls) {
  return {
    rpc(name, args) {
      calls.push({ rpc: name, args })
      return Promise.resolve({ data: name === 'assign_daily_quests_v1'
        ? { error: null, localDate: '2026-09-30', quests: [] }
        : name === 'solo_burrow_initialize_v1' ? { error: null, initialized: true }
          : [], error: null })
    },
    from(table) {
      const filters = []
      const query = {
        select() { return query },
        eq(field, value) { filters.push([field, value]); return query },
        in(field, values) { filters.push([field, values]); return query },
        is(field, value) { filters.push([field, value]); return query },
        order() { return query },
        limit() { return query },
        maybeSingle() { return Promise.resolve(result(true)) },
        then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject) },
      }
      function result(single) {
        calls.push({ table, filters: [...filters] })
        const filtered = (rows[table] || []).filter(row => filters.every(([field, value]) =>
          Array.isArray(value) ? value.includes(row[field]) : row[field] === value))
        return { data: single ? filtered[0] ?? null : filtered, error: null }
      }
      return query
    },
  }
}

test('unpaired bootstrap exposes only the current user and published content', async () => {
  const calls = []
  const id = 'self-user'
  const db = database({
    profiles: [{ id, display_name: 'Me', avatar_url: null, subscription_tier: 'free', timezone_name: 'America/Los_Angeles' }],
    app_config: [{ key: 'app_major_update_content_revision', value: 'published-revision' }],
    content_revisions: [{ id: 'published-revision', status: 'published' }],
    wallets: [{ user_id: id, carrot_balance: 12, version: 2 }],
    room_needs: [{ owner_id: id, food_value: 80, food_updated_at: new Date().toISOString(), water_value: 90, water_updated_at: new Date().toISOString() }],
    catalog_items: [
      { stable_id: 'active', revision_id: 'published-revision', status: 'active', title: 'Lamp' },
      { stable_id: 'draft', revision_id: 'draft-revision', status: 'active', title: 'Hidden' },
    ],
    user_inventory: [{ id: 'item', owner_id: id, item_id: 'active', source: 'starter' }, { id: 'former', owner_id: 'former-partner', item_id: 'active', source: 'gift' }],
    room_loadouts: [{ room_type: 'home', owner_id: id, slot: 'lamp', item_id: 'active' }],
    friend_definitions: [{ stable_id: 'friend', revision_id: 'published-revision', status: 'active', name: 'Pip', subtitle: 'Friend' }],
    user_friend_discoveries: [{ user_id: id, friend_id: 'friend', interaction_completed_at: null }],
    memory_prompts: [{ stable_id: 'prompt', revision_id: 'published-revision', status: 'active', prompt: 'Remember today' }],
    moment_events: [
      { id: 'mine', pair_low: id, pair_high: id, actor_id: id, event_type: 'toy_interacted', payload: {}, created_at: new Date().toISOString() },
      { id: 'my-log', pair_low: id, pair_high: id, actor_id: id, event_type: 'adventure_record_saved',
        reference_type: 'reflect', reference_id: 'record-1', payload: {}, created_at: new Date().toISOString() },
      { id: 'old-pair', pair_low: id, pair_high: 'former-partner', actor_id: id, event_type: 'affection_sent', payload: {}, created_at: new Date().toISOString() },
    ],
    reflects: [{ id: 'record-1', user_id: id, body: 'A lovely solo day.' }],
    reflect_items: [{ reflect_id: 'record-1', user_id: id, item_id: 'memory.0002_coffee', match_label: 'Coffee' }],
    memory_room_entries: [{ id: 'memory-1', pair_low: id, pair_high: id, author_id: id,
      body: 'A small memory.', created_at: new Date().toISOString(), deleted_at: null }],
    memory_entry_photos: [{ id: 'photo-1', entry_id: 'memory-1', slot: 0, updated_at: new Date().toISOString() }],
  }, calls)
  const result = await unpairedBurrowBootstrap(db, id)
  assert.equal(result.unpaired, true)
  assert.equal(result.partner, null)
  assert.deepEqual(result.inventory.map(item => item.id), ['item'])
  assert.deepEqual(result.catalog.map(item => item.stable_id), ['active'])
  assert.equal(result.wallet.balance, 12)
  assert.equal(result.roomNeeds.food, 80)
  assert.equal(result.quests.quests.length, 0)
  assert.deepEqual(result.moments.map(event => event.id), ['mine', 'my-log'])
  assert.equal(result.moments.find(event => event.id === 'my-log').record.body, 'A lovely solo day.')
  assert.equal(result.moments.find(event => event.id === 'my-log').record.items[0].label, 'Coffee')
  assert.equal(result.memoryEntries[0].photos[0].id, 'photo-1')
  assert.match(result.localDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(calls.every(call => !['pairings', 'gifts', 'affection_events'].includes(call.table)))
  assert.ok(calls.find(call => call.table === 'moment_events')?.filters.some(([field, value]) => field === 'pair_high' && value === id))
  for (const table of ['wallets', 'room_needs', 'user_inventory', 'room_loadouts', 'user_friend_discoveries']) {
    assert.ok(calls.find(call => call.table === table)?.filters.some(([, value]) => value === id), table)
  }
})

test('missing profile cannot become an anonymous empty burrow', async () => {
  const db = database({ app_config: [{ key: 'app_major_update_content_revision', value: 'published-revision' }] }, [])
  await assert.rejects(unpairedBurrowBootstrap(db, 'missing'), /unpaired_bootstrap_unavailable/)
})

test('draft content cannot be revealed to an unpaired account', async () => {
  const db = database({
    profiles: [{ id: 'self', display_name: 'Me', subscription_tier: 'free', timezone_name: 'UTC' }],
    app_config: [{ key: 'app_major_update_content_revision', value: 'draft-revision' }],
    content_revisions: [{ id: 'draft-revision', status: 'draft' }],
  }, [])
  await assert.rejects(unpairedBurrowBootstrap(db, 'self'), /unpaired_bootstrap_unavailable/)
})

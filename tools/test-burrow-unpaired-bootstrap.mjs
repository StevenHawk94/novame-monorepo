import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unpairedBurrowBootstrap } from '../apps/api/src/lib/burrow-unpaired-bootstrap.mjs'

function database(rows, calls) {
  return {
    from(table) {
      const filters = []
      const query = {
        select() { return query },
        eq(field, value) { filters.push([field, value]); return query },
        order() { return query },
        maybeSingle() { return Promise.resolve(result(true)) },
        then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject) },
      }
      function result(single) {
        calls.push({ table, filters: [...filters] })
        const filtered = (rows[table] || []).filter(row => filters.every(([field, value]) => row[field] === value))
        return { data: single ? filtered[0] ?? null : filtered, error: null }
      }
      return query
    },
  }
}

test('unpaired bootstrap exposes only the current user and published content without writes', async () => {
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
  }, calls)
  const result = await unpairedBurrowBootstrap(db, id)
  assert.equal(result.unpaired, true)
  assert.equal(result.partner, null)
  assert.deepEqual(result.inventory.map(item => item.id), ['item'])
  assert.deepEqual(result.catalog.map(item => item.stable_id), ['active'])
  assert.equal(result.wallet.balance, 12)
  assert.equal(result.roomNeeds.food, 80)
  assert.equal(result.quests.quests.length, 0)
  assert.equal(result.moments.length, 0)
  assert.match(result.localDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(calls.every(call => !['pairings', 'moment_events', 'gifts', 'affection_events'].includes(call.table)))
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

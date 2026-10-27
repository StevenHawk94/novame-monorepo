const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { load } = require('./lifecycle-test-utils.cjs');
const id = '11111111-1111-4111-8111-111111111111';
const stamp = '2026-10-05T12:00:00Z';

function photoRoute({ row = { id, owner_id: id, kind: 'frame', updated_at: stamp }, failure = null } = {}) {
  const filters = []; let signed = 0, uploaded = 0;
  const db = {
    rpc: async name => ({ data: name === 'check_rate_limit' ? { allowed: true }
      : name.includes('prepare') ? { path: 'immutable-ticket.jpg', ticketId: id, committed: true } : { path: 'immutable-ticket.jpg' }, error: null }),
    from(table) { assert.equal(table, 'room_photos'); const query = { select() { return query; },
      eq(key, value) { filters.push([key, value]); return query; }, maybeSingle: async () => ({ data: row, error: failure }) }; return query; },
    storage: { from: () => ({ createSignedUrl: async () => { signed++; return { data: { signedUrl: 'private-url' } }; },
      upload: async () => { uploaded++; return {}; } }) },
  };
  const route = load('apps/api/src/app/api/vnext/room-photo/route.js', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) } },
    '@/lib/app-major-update': { authenticatedUserId: async () => id, commandStatus: () => 409,
      majorUpdateEnabled: async () => true, appMajorUpdateServiceClient: () => db },
    '@/lib/burrow-photo.mjs': { PHOTO_BUCKET: 'photos', PHOTO_LINK_SECONDS: 60, photoUUID: value => value === id,
      decodeRoomPhoto: () => new Uint8Array([1, 2, 3]), readPhotoRequest: request => request.body },
  }, { URL, crypto: webcrypto });
  return { route, filters, signed: () => signed, uploaded: () => uploaded };
}
const request = { body: { actorId: id, ownerId: id, kind: 'frame', idempotencyKey: id, base64: 'jpeg' } };
test('a committed upload retry returns its full immutable version without uploading again', async () => {
  const h = photoRoute(), result = await h.route.POST(request);
  assert.equal(result.status, 200); assert.equal(result.body.photo.updatedAt, stamp);
  assert.equal(result.body.photoId, id); assert.equal(h.uploaded(), 0);
  assert.ok(h.filters.some(([key, value]) => key === 'private_path' && value === 'immutable-ticket.jpg'));
});
test('a superseded ticket cannot mislabel new photo bytes; receipt lookup failures are caught', async () => {
  assert.equal((await photoRoute({ row: null }).route.POST(request)).status, 409);
  const failed = await photoRoute({ failure: Error('database offline') }).route.POST(request);
  assert.equal(failed.status, 503); assert.equal(failed.body.error, 'photo_unavailable');
});
test('signed links are bound to the requested photo version', async () => {
  const h = photoRoute({ row: null });
  const result = await h.route.GET({ url: `https://example.test/photo?id=${id}&version=${stamp}` });
  assert.equal(result.status, 409); assert.equal(h.signed(), 0);
  assert.ok(h.filters.some(([key, value]) => key === 'updated_at' && value === stamp));
});
test('Game Room answer response carries post-command state without remote questions', async () => {
  const catalog = require('../apps/api/src/data/burrow-game-room-v1.json'), game = catalog.games[0], calls = [];
  const route = load('apps/api/src/app/api/vnext/game-room/route.js', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) } },
    '@/data/burrow-game-room-v1.json': catalog, '@/lib/burrow-game-room.mjs': load('apps/api/src/lib/burrow-game-room.mjs'),
    '@/lib/burrow-game-history.mjs': {},
    '@/lib/push-notifications':{},
    '@/lib/app-major-update': { authenticatedUserId: async () => id, commandStatus: code => code ? 409 : 200,
      majorUpdateEnabled: async () => true, appMajorUpdateServiceClient: () => ({ rpc: async (name, args) => {
        calls.push({ name, args }); return { data: name === 'burrow_game_answer_v1' ? { applied: true }
          : { id, gameId: game.id, questions: game.questions, ownAnswers: [0], completedAt: null }, error: null };
      } }) },
  });
  const result = await route.POST({ text: async () => JSON.stringify({ action: 'answer', sessionId: id, phase: 'own', index: 0, choice: 0, content: 'local', catalogVersion: 1 }) });
  assert.equal(result.status, 200); assert.equal(result.body.session.ownAnswers[0], 0);
  assert.equal(result.body.session.questions, undefined);
  assert.equal(calls[1].name, 'burrow_game_state_v1'); assert.equal(calls[1].args.p_user_id, id);
});

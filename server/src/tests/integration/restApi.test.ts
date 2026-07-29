// The REST surface: health check plus the player/lobby debug endpoints.
//
// Real HTTP against the real express app on an ephemeral port. `/health` in
// particular is what Railway polls to decide whether a deploy is live, so a
// regression there takes production down.

import test, { describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import app from '../../app';
import { resetDatabase, closeDatabase } from '../helpers/db';
import { createLobbyWithPlayers } from '../helpers/gameFlow';
import { playerService } from '../../services/player.service';

let server: Server;
let base: string;

before(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDatabase();
});

async function get(path: string) {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: await response.json() };
}

async function post(path: string, payload: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

describe('GET /health', () => {
  test('reports ok with a timestamp', async () => {
    const { status, body } = await get('/health');

    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.ok(!Number.isNaN(Date.parse(body.timestamp)), 'timestamp is a real date');
  });
});

describe('players', () => {
  test('creates a player and can read it back', async () => {
    const created = await post('/players', { name: 'Rhea' });

    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'Rhea');
    assert.ok(created.body.id);

    const fetched = await get(`/players/${created.body.id}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.name, 'Rhea');
  });

  test('rejects an invalid name with 400', async () => {
    assert.equal((await post('/players', { name: '' })).status, 400);
    assert.equal((await post('/players', { name: '   ' })).status, 400);
    assert.equal((await post('/players', { name: 'x'.repeat(21) })).status, 400);
  });

  test('sanitises the stored name', async () => {
    const created = await post('/players', { name: '  <Zed>  ' });
    assert.equal(created.body.name, 'Zed');
  });

  test('404s an unknown player', async () => {
    const { status, body } = await get('/players/does-not-exist');
    assert.equal(status, 404);
    assert.match(body.error, /not found/i);
  });
});

describe('lobbies', () => {
  test('creates a lobby for an existing player', async () => {
    const host = await playerService.createPlayer({ name: 'Host', clientId: 'c-rest-host' });

    const { status, body } = await post('/lobbies/create', {
      hostPlayerId: host.id,
      hostName: 'Host',
      settings: { rounds: 5 },
    });

    assert.equal(status, 201);
    assert.match(body.code, /^[A-Z0-9]{6}$/);
    assert.equal(body.settings.rounds, 5);
  });

  test('requires the host fields', async () => {
    const { status, body } = await post('/lobbies/create', { hostName: 'Nobody' });
    assert.equal(status, 400);
    assert.match(body.error, /required/);
  });

  test('finds a lobby by code, case-insensitively', async () => {
    const { code, lobbyId } = await createLobbyWithPlayers(2);

    const upper = await get(`/lobbies/${code}`);
    assert.equal(upper.status, 200);
    assert.equal(upper.body.id, lobbyId);
    assert.equal(upper.body.playerCount, 2);

    const lower = await get(`/lobbies/${code.toLowerCase()}`);
    assert.equal(lower.status, 200);
    assert.equal(lower.body.id, lobbyId);
  });

  test('rejects a malformed code with 400 and an unknown one with 404', async () => {
    assert.equal((await get('/lobbies/AB')).status, 400);
    assert.equal((await get('/lobbies/AB-12C')).status, 400);
    assert.equal((await get('/lobbies/ZZZZZZ')).status, 404);
  });

  test('finds a lobby by id', async () => {
    const { lobbyId } = await createLobbyWithPlayers(2);

    const { status, body } = await get(`/lobbies/id/${lobbyId}`);
    assert.equal(status, 200);
    assert.equal(body.id, lobbyId);
  });

  test('joins a lobby by code', async () => {
    const { code } = await createLobbyWithPlayers(1);
    const joiner = await playerService.createPlayer({ name: 'Guest', clientId: 'c-rest-guest' });

    const { status, body } = await post('/lobbies/join', {
      code,
      playerId: joiner.id,
      playerName: 'Guest',
    });

    assert.equal(status, 200);
    assert.equal(body.playerCount, 2);
  });

  test('404s a join for a lobby that is not there', async () => {
    const joiner = await playerService.createPlayer({ name: 'Ghost', clientId: 'c-rest-ghost' });

    const { status } = await post('/lobbies/join', {
      code: 'ZZZZZZ',
      playerId: joiner.id,
      playerName: 'Ghost',
    });

    assert.equal(status, 404);
  });

  test('409s a join into a full lobby', async () => {
    const { code } = await createLobbyWithPlayers(2, { maxPlayers: 2 });
    const extra = await playerService.createPlayer({ name: 'Extra', clientId: 'c-rest-extra' });

    const { status } = await post('/lobbies/join', {
      code,
      playerId: extra.id,
      playerName: 'Extra',
    });

    assert.equal(status, 409);
  });
});

describe('unknown routes', () => {
  test('return a JSON 404 rather than HTML', async () => {
    const { status, body } = await get('/no/such/route');
    assert.equal(status, 404);
    assert.equal(body.error, 'Not found');
  });
});

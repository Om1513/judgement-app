// A finished game hands its table back to the lobby it was dealt from.
//
// Real Postgres and real Socket.IO. The game is started by the host pressing
// start and ended by the same broadcast the live flow uses, so what is asserted
// is what the phones at that table see: the lobby they return to has the same
// code, host, settings and seats, and the host can deal again from it.

import test, { describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { db, resetDatabase, closeDatabase } from '../helpers/db';
import { continueAll, getState, playOutRound } from '../helpers/gameFlow';
import {
  startTestServer,
  connectClient,
  waitFor,
  waitForMatching,
  flush,
  Harness,
  TestClient,
} from '../helpers/socketHarness';
import { getIO } from '../../socket';
import { broadcastFinalWinner } from '../../socket/playFlow';
import { gameReconnectService } from '../../services/gameReconnect.service';
import { gameService } from '../../services/game.service';
import { lobbyReconnectService } from '../../services/lobbyReconnect.service';
import { lobbyService } from '../../services/lobby.service';
import { ClientGameState, ScoreboardState } from '../../types/game';
import { LobbyState } from '../../types/lobby';
import { SessionRestorePayload } from '../../types/socket';

let harness: Harness;
const openClients: TestClient[] = [];
let clientSeq = 0;

before(async () => {
  harness = await startTestServer();
});

beforeEach(async () => {
  while (openClients.length) {
    openClients.pop()!.disconnect();
  }
  await flush(150);

  lobbyReconnectService.cancelAll();
  gameReconnectService.cancelAll();
  await resetDatabase();

  // Wide, so no seat is taken over or freed while a test is looking at it.
  gameReconnectService.configure({ graceMs: 30_000 });
  lobbyReconnectService.configure({ graceMs: 30_000 });
});

after(async () => {
  while (openClients.length) {
    openClients.pop()!.disconnect();
  }
  lobbyReconnectService.cancelAll();
  gameReconnectService.cancelAll();
  await harness.close();
  await closeDatabase();
});

interface Seated extends TestClient {
  clientId: string;
}

async function client(name: string, clientId?: string): Promise<Seated> {
  const id = clientId ?? `c-${name}-${++clientSeq}`;
  const connected = await connectClient(harness.url, name, id);
  openClients.push(connected);
  return Object.assign(connected, { clientId: id });
}

const SETTINGS = { rounds: 4, scoringMode: '+1', maxPlayers: 6 };

/** A lobby of real sockets with a game running, started by the host. */
async function gameOf(names: string[]) {
  const clients: Seated[] = [];
  for (const name of names) {
    clients.push(await client(name));
  }

  const [host] = clients;
  const created = await waitFor<{ lobby: LobbyState }>(host.socket, 'lobby:created', () =>
    host.socket.emit('lobby:create', { playerName: host.name, settings: SETTINGS })
  );
  for (const joiner of clients.slice(1)) {
    await waitFor<{ lobby: LobbyState }>(joiner.socket, 'lobby:joined', () =>
      joiner.socket.emit('lobby:join', { code: created.lobby.code, playerName: joiner.name })
    );
  }
  await flush();

  const before = (await lobbyService.getLobbyById(created.lobby.id))!;
  const started = await waitFor<{ gameState: ClientGameState }>(host.socket, 'game:started', () =>
    host.socket.emit('lobby:start-game')
  );
  await flush();

  return {
    clients,
    host,
    code: created.lobby.code,
    lobbyId: created.lobby.id,
    gameId: started.gameState.id,
    before,
  };
}

/** Plays every round, then ends the game with the live flow's broadcast. */
async function finishGame(gameId: string, beforeFinalBroadcast?: () => Promise<void>) {
  for (let round = 1; round <= SETTINGS.rounds; round++) {
    await playOutRound(gameId);
    await continueAll(gameId);
    await gameService.advanceToNextRound(gameId);
  }
  assert.equal((await getState(gameId)).status, 'GAME_OVER');

  await beforeFinalBroadcast?.();
  await broadcastFinalWinner(getIO(), gameId);
  await flush();
}

/** The lobby update that says the table is waiting again. */
function waitForReturn(c: TestClient): Promise<{ lobby: LobbyState }> {
  return waitForMatching<{ lobby: LobbyState }>(
    c.socket,
    'lobby:update',
    data => data.lobby.status === 'WAITING'
  );
}

const seatsOf = (lobby: LobbyState) =>
  lobby.players.map(p => ({ playerId: p.playerId, seat: p.seatPosition, isHost: p.isHost }));

describe('when a game ends', () => {
  test('every player is told the lobby is waiting again, exactly as it was', async () => {
    const { clients, lobbyId, code, gameId, before } = await gameOf(['Om', 'Yukta', 'Raj']);

    const returns = clients.map(waitForReturn);
    await finishGame(gameId);
    const updates = await Promise.all(returns);

    for (const { lobby } of updates) {
      assert.equal(lobby.code, code, 'the same lobby code');
      assert.equal(lobby.hostPlayerId, before.hostPlayerId, 'the same host');
      assert.deepEqual(lobby.settings, before.settings, 'the same settings');
      assert.deepEqual(seatsOf(lobby), seatsOf(before), 'the same seats');
      assert.ok(lobby.players.every(p => p.connected && !p.controlledByBot));
      assert.equal(lobby.canStart, true);
    }

    const row = await db.lobby.findUnique({ where: { id: lobbyId } });
    assert.equal(row?.status, 'WAITING');
  });

  test('the host can deal a second game in the same lobby', async () => {
    const { clients, host, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    await finishGame(gameId);

    const starts = clients.map(c =>
      waitFor<{ gameState: ClientGameState }>(c.socket, 'game:started')
    );
    host.socket.emit('lobby:start-game');
    const games = await Promise.all(starts);

    const next = games[0].gameState;
    assert.notEqual(next.id, gameId, 'a new game, not the finished one');
    assert.equal(next.status, 'BIDDING');
    assert.equal(next.currentRound, 1);
    assert.equal(next.players.length, 3);

    assert.equal((await gameService.getGameByLobbyId(lobbyId))?.id, next.id);
    assert.equal((await db.lobby.findUnique({ where: { id: lobbyId } }))?.status, 'IN_GAME');
  });

  test('the final scoreboard can still be read after the lobby has reset', async () => {
    const { clients, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    await finishGame(gameId);

    const [, yukta] = clients;
    const final = await waitFor<{ scoreboard: ScoreboardState }>(
      yukta.socket,
      'game:final-scoreboard',
      () => yukta.socket.emit('game:get-final-scoreboard')
    );
    assert.equal(final.scoreboard.gameId, gameId);
    assert.equal(final.scoreboard.status, 'completed');
    assert.equal(final.scoreboard.players.length, 3);
  });

  test('a stale end-of-game broadcast does not reset a table that is playing again', async () => {
    const { host, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    await finishGame(gameId);

    await waitFor(host.socket, 'game:started', () => host.socket.emit('lobby:start-game'));
    await flush();

    await broadcastFinalWinner(getIO(), gameId);
    await flush();

    assert.equal((await db.lobby.findUnique({ where: { id: lobbyId } }))?.status, 'IN_GAME');
  });
});

describe('players who did not see the game through', () => {
  test('somebody who walked away loses their seat, but keeps their scoreboard column', async () => {
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta, raj] = clients;

    const back = waitForReturn(om);
    await finishGame(gameId, async () => {
      await lobbyService.markSessionDiscarded(lobbyId, raj.playerId);
    });
    const { lobby } = await back;

    assert.deepEqual(
      lobby.players.map(p => p.playerId),
      [om.playerId, yukta.playerId],
      'Raj walked away and is no longer seated'
    );

    const final = await waitFor<{ scoreboard: ScoreboardState }>(
      om.socket,
      'game:final-scoreboard',
      () => om.socket.emit('game:get-final-scoreboard')
    );
    const rajColumn = final.scoreboard.players.find(p => p.id === raj.playerId);
    assert.ok(rajColumn, 'Raj still played this game');
    assert.equal(rajColumn.name, 'Raj');
  });

  test('a host who walked away hands the lobby to the next human', async () => {
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta] = clients;

    const back = waitForReturn(yukta);
    await finishGame(gameId, async () => {
      await lobbyService.markSessionDiscarded(lobbyId, om.playerId);
    });
    const { lobby } = await back;

    assert.equal(lobby.hostPlayerId, yukta.playerId);
    assert.equal(lobby.players.find(p => p.playerId === yukta.playerId)?.isHost, true);
    assert.equal(lobby.players.some(p => p.playerId === om.playerId), false);
  });

  test('somebody still away has their seat held, and comes back into the lobby', async () => {
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om, , raj] = clients;

    raj.disconnect();
    await flush(100);

    await finishGame(gameId);

    // Held by the waiting-room grace period, not stuck as "reconnecting" forever.
    assert.equal(lobbyReconnectService.isPending(lobbyId, raj.playerId), true);
    const held = await lobbyService.getLobbyById(lobbyId);
    assert.equal(held?.players.find(p => p.playerId === raj.playerId)?.connected, false);
    assert.equal(held?.canStart, false, 'the deal waits for them, as in any lobby');

    const reconnected = waitForMatching<{ lobby: LobbyState }>(
      om.socket,
      'lobby:update',
      data => data.lobby.players.every(p => p.connected)
    );
    const rajAgain = await client(raj.name, raj.clientId);
    const answers = rajAgain.received.filter(r => r.event === 'session:restore');
    const answer = answers[answers.length - 1].payload as SessionRestorePayload;

    assert.equal(answer.restored, true);
    assert.equal(answer.lobby?.status, 'WAITING');
    assert.equal(answer.gameState, null, 'back into the lobby, not the finished game');

    const { lobby } = await reconnected;
    assert.equal(lobby.canStart, true);
    assert.equal(lobbyReconnectService.isPending(lobbyId, raj.playerId), false);
  });
});

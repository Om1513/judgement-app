// The waiting-room disconnect grace period, end to end.
//
// Two halves, both against a real Postgres:
//
//   * the service half - what the database actually holds while a seat is being
//     held open, who inherits a lobby when a host never comes back, and whether
//     a held seat still counts towards capacity;
//   * the wire half - real Socket.IO clients dropping and reconnecting, so the
//     assertions are about what the other phones at the table are told.
//
// The grace period is dialled down per test (lobbyReconnectService.configure)
// rather than waiting on the real 30 seconds; the timer semantics themselves -
// stale timers, generations, repeated drops - are pinned deterministically with
// fake timers in tests/unit/lobbyReconnect.test.ts.

import test, { describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { db, resetDatabase, closeDatabase } from '../helpers/db';
import { createLobbyWithPlayers, addBots } from '../helpers/gameFlow';
import {
  startTestServer,
  connectClient,
  waitFor,
  countReceived,
  flush,
  Harness,
  TestClient,
} from '../helpers/socketHarness';
import { lobbyService } from '../../services/lobby.service';
import {
  LobbyReconnectService,
  lobbyReconnectService,
} from '../../services/lobbyReconnect.service';
import { playerService } from '../../services/player.service';
import { LobbyState } from '../../types/lobby';

let harness: Harness;
const openClients: TestClient[] = [];
/** Service instances created by a test, so their timers can be torn down. */
const scratchServices: LobbyReconnectService[] = [];
let clientSeq = 0;

before(async () => {
  harness = await startTestServer();
});

beforeEach(async () => {
  while (openClients.length) {
    openClients.pop()!.disconnect();
  }
  // Let the server finish its disconnect bookkeeping before the tables go, so
  // teardown cannot race a truncate.
  await flush(150);

  lobbyReconnectService.cancelAll();
  while (scratchServices.length) {
    scratchServices.pop()!.cancelAll();
  }

  await resetDatabase();
});

after(async () => {
  while (openClients.length) {
    openClients.pop()!.disconnect();
  }
  lobbyReconnectService.cancelAll();
  await harness.close();
  await closeDatabase();
});

/** A reconnect service with its own short window and no socket layer attached. */
function withGrace(graceMs: number): LobbyReconnectService {
  const service = new LobbyReconnectService();
  service.configure({ graceMs });
  scratchServices.push(service);
  return service;
}

// ---------------------------------------------------------------------------
// The service half: what the database holds
// ---------------------------------------------------------------------------

describe('a seat held open for a player who dropped out', () => {
  test('is still theirs, with everything about it preserved', async () => {
    const { lobbyId, playerIds } = await createLobbyWithPlayers(4);
    const service = withGrace(10_000);

    const before = (await lobbyService.getLobbyById(lobbyId))!;
    const held = await service.startGracePeriod(before, playerIds[0]);

    assert.ok(held, 'a grace period was started');
    assert.equal(held.playerCount, 4, 'nobody was removed');

    const seat = held.players.find(p => p.playerId === playerIds[0])!;
    assert.equal(seat.connected, false);
    assert.equal(seat.seatPosition, 0, 'seat position preserved');
    assert.equal(seat.isHost, true, 'host status preserved');
    assert.equal(held.hostPlayerId, playerIds[0], 'the lobby still names them host');
    assert.ok(seat.disconnectedAt, 'the drop was timestamped');
    assert.ok(seat.reconnectDeadline, 'the seat has a deadline');

    // The membership row - the seat itself - is untouched in the database.
    const row = await db.lobbyPlayer.findUnique({
      where: { lobbyId_playerId: { lobbyId, playerId: playerIds[0] } },
    });
    assert.ok(row, 'the membership row survives');
    assert.equal(row.connected, false);
    assert.equal(row.seatPosition, 0);
    assert.equal(row.disconnectGeneration, 1, 'one disconnect so far');
    assert.equal(service.isPending(lobbyId, playerIds[0]), true);
  });

  test('is given up when the deadline passes', async () => {
    const { lobbyId, playerIds } = await createLobbyWithPlayers(3);
    const service = withGrace(30);

    const lobby = (await lobbyService.getLobbyById(lobbyId))!;
    await service.startGracePeriod(lobby, playerIds[2]);

    await flush(200);

    const after = (await lobbyService.getLobbyById(lobbyId))!;
    assert.equal(after.playerCount, 2);
    assert.ok(!after.players.some(p => p.playerId === playerIds[2]));
    assert.equal(
      await db.lobbyPlayer.count({ where: { lobbyId, playerId: playerIds[2] } }),
      0,
      'the membership row is gone'
    );
    assert.equal(service.pendingCount(), 0, 'tracking cleaned up');
  });

  test('still counts towards the lobby capacity, so nobody can steal it', async () => {
    const { lobbyId, code, playerIds } = await createLobbyWithPlayers(2, { maxPlayers: 2 });
    const service = withGrace(10_000);

    const lobby = (await lobbyService.getLobbyById(lobbyId))!;
    await service.startGracePeriod(lobby, playerIds[1]);

    const gatecrasher = await playerService.createPlayer({ name: 'Late', clientId: 'c-late' });
    await assert.rejects(
      () => lobbyService.joinLobby({ code, playerId: gatecrasher.id, playerName: 'Late' }),
      /Lobby is full/,
      'the held seat is not up for grabs'
    );

    // ...and it opens up again the moment the grace period expires.
    await lobbyService.removePlayerFromLobby(lobbyId, playerIds[1]);
    const joined = await lobbyService.joinLobby({
      code,
      playerId: gatecrasher.id,
      playerName: 'Late',
    });
    assert.equal(joined.playerCount, 2);
  });

  test('blocks the deal until its owner is back', async () => {
    const { lobbyId, playerIds } = await createLobbyWithPlayers(3);
    const service = withGrace(10_000);

    const lobby = (await lobbyService.getLobbyById(lobbyId))!;
    await service.startGracePeriod(lobby, playerIds[1]);

    const held = (await lobbyService.getLobbyById(lobbyId))!;
    assert.equal(held.canStart, false, 'the client sees the start button as unavailable');
    await assert.rejects(
      () => lobbyService.startGame(lobbyId, playerIds[0]),
      /Waiting for all players to reconnect/
    );

    await service.restorePlayer(held, playerIds[1]);

    assert.equal((await lobbyService.getLobbyById(lobbyId))!.canStart, true);
    const { gameId } = await lobbyService.startGame(lobbyId, playerIds[0]);
    assert.ok(gameId, 'the game starts once everyone is back');
  });
});

describe('bots and the grace period', () => {
  test('a bot is never marked disconnected and never gets a timer', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(2);
    const [botId] = await addBots(lobbyId, hostId, 1);
    const service = withGrace(30);

    const lobby = (await lobbyService.getLobbyById(lobbyId))!;
    const result = await service.startGracePeriod(lobby, botId);

    assert.equal(result, null, 'no grace period for a bot');
    assert.equal(service.pendingCount(), 0, 'no timer for a bot');
    assert.equal(lobby.players.find(p => p.playerId === botId)!.connected, true);
  });

  test('a human dropping out leaves the bots untouched', async () => {
    const { lobbyId, hostId, playerIds } = await createLobbyWithPlayers(3);
    const [botId] = await addBots(lobbyId, hostId, 1);
    const service = withGrace(30);

    const lobby = (await lobbyService.getLobbyById(lobbyId))!;
    await service.startGracePeriod(lobby, playerIds[2]);
    await flush(200);

    const after = (await lobbyService.getLobbyById(lobbyId))!;
    const bot = after.players.find(p => p.playerId === botId)!;
    assert.equal(bot.connected, true);
    assert.equal(bot.reconnectDeadline, null);
    assert.equal(after.playerCount, 3, 'only the human was removed');
    assert.equal(after.canStart, true, 'a bot never holds up the start');
  });
});

describe('when the host never comes back', () => {
  test('the earliest-joined connected human inherits the lobby', async () => {
    const { lobbyId, playerIds } = await createLobbyWithPlayers(3);
    const service = withGrace(30);

    const lobby = (await lobbyService.getLobbyById(lobbyId))!;
    await service.startGracePeriod(lobby, playerIds[0]);
    await flush(200);

    const after = (await lobbyService.getLobbyById(lobbyId))!;
    assert.equal(after.playerCount, 2);
    assert.equal(after.hostPlayerId, playerIds[1], 'host transferred to the next human');
    assert.equal(after.players.find(p => p.playerId === playerIds[1])!.isHost, true);
    assert.ok(!after.players.some(p => p.playerId === playerIds[0]), 'the old host is gone');
  });

  test('a bot is never made host - the lobby is closed instead', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    await addBots(lobbyId, hostId, 2);
    const service = withGrace(30);

    const lobby = (await lobbyService.getLobbyById(lobbyId))!;
    assert.equal(lobby.playerCount, 3, 'one human, two bots');

    await service.startGracePeriod(lobby, hostId);
    await flush(200);

    assert.equal(await lobbyService.getLobbyById(lobbyId), null, 'the lobby was closed');
    assert.equal(await db.lobby.count({ where: { id: lobbyId } }), 0);
    assert.equal(
      await db.lobbyPlayer.count({ where: { lobbyId } }),
      0,
      'the bots went with it'
    );
  });

  test('a human still mid-reconnect is preferred over a bot', async () => {
    const { lobbyId, hostId, playerIds } = await createLobbyWithPlayers(2);
    await addBots(lobbyId, hostId, 1);
    const service = withGrace(10_000);

    // Both humans are away; the host's window is the one that runs out first.
    const lobby = (await lobbyService.getLobbyById(lobbyId))!;
    await service.startGracePeriod(lobby, playerIds[1]);
    const withBothAway = (await lobbyService.getLobbyById(lobbyId))!;
    await service.startGracePeriod(withBothAway, hostId);

    await lobbyService.removePlayerFromLobby(lobbyId, hostId);

    const after = (await lobbyService.getLobbyById(lobbyId))!;
    assert.equal(after.hostPlayerId, playerIds[1], 'the absent human holds the lobby');
    assert.equal(
      after.players.find(p => p.playerId === playerIds[1])!.connected,
      false,
      'still shown as reconnecting'
    );
  });

  test('the last human leaving takes the lobby with them', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    const service = withGrace(30);

    const lobby = (await lobbyService.getLobbyById(lobbyId))!;
    await service.startGracePeriod(lobby, hostId);
    await flush(200);

    assert.equal(await db.lobby.count({ where: { id: lobbyId } }), 0);
    assert.equal(service.pendingCount(), 0);
  });
});

describe('after a server restart', () => {
  test('a deadline that has already passed is settled on boot', async () => {
    const { lobbyId, playerIds } = await createLobbyWithPlayers(3);

    // A seat held by the previous process, whose deadline elapsed while the
    // server was down. No in-memory timer exists for it any more.
    await db.lobbyPlayer.update({
      where: { lobbyId_playerId: { lobbyId, playerId: playerIds[2] } },
      data: {
        connected: false,
        disconnectedAt: new Date(Date.now() - 60_000),
        reconnectDeadline: new Date(Date.now() - 30_000),
        disconnectGeneration: 1,
      },
    });

    const service = withGrace(10_000);
    const resumed = await service.recoverPendingGracePeriods();

    assert.equal(resumed, 1);
    const after = (await lobbyService.getLobbyById(lobbyId))!;
    assert.equal(after.playerCount, 2, 'the abandoned seat was freed');
    assert.equal(service.pendingCount(), 0, 'no timer left armed');
  });

  test('a deadline still in the future is picked back up, not dropped', async () => {
    const { lobbyId, playerIds } = await createLobbyWithPlayers(3);

    await db.lobbyPlayer.update({
      where: { lobbyId_playerId: { lobbyId, playerId: playerIds[2] } },
      data: {
        connected: false,
        disconnectedAt: new Date(),
        reconnectDeadline: new Date(Date.now() + 60),
        disconnectGeneration: 1,
      },
    });

    const service = withGrace(10_000);
    const resumed = await service.recoverPendingGracePeriods();

    assert.equal(resumed, 1);
    assert.equal(service.isPending(lobbyId, playerIds[2]), true, 'the countdown resumed');
    assert.equal(
      (await lobbyService.getLobbyById(lobbyId))!.playerCount,
      3,
      'not removed early'
    );

    await flush(250);
    assert.equal(
      (await lobbyService.getLobbyById(lobbyId))!.playerCount,
      2,
      'removed when the persisted deadline arrived'
    );
  });

  test('connected players are left alone', async () => {
    await createLobbyWithPlayers(3);

    const service = withGrace(10_000);

    assert.equal(await service.recoverPendingGracePeriods(), 0);
    assert.equal(service.pendingCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// The wire half: real sockets
// ---------------------------------------------------------------------------

interface Seated extends TestClient {
  clientId: string;
}

/** Connects and identifies a client, remembering the identity it reconnects with. */
async function client(name: string, clientId?: string): Promise<Seated> {
  const id = clientId ?? `c-${name}-${++clientSeq}`;
  const connected = await connectClient(harness.url, name, id);
  openClients.push(connected);
  return Object.assign(connected, { clientId: id });
}

/** Host creates a lobby; everyone else joins it. */
async function lobbyOf(names: string[], settings?: Record<string, unknown>) {
  const clients: Seated[] = [];
  for (const name of names) {
    clients.push(await client(name));
  }

  const [host] = clients;
  const created = await waitFor<{ lobby: LobbyState }>(host.socket, 'lobby:created', () =>
    host.socket.emit('lobby:create', { playerName: host.name, settings })
  );

  for (const joiner of clients.slice(1)) {
    await waitFor<{ lobby: LobbyState }>(joiner.socket, 'lobby:joined', () =>
      joiner.socket.emit('lobby:join', { code: created.lobby.code, playerName: joiner.name })
    );
  }
  await flush();

  return { clients, host, code: created.lobby.code, lobbyId: created.lobby.id };
}

/** The same player coming back on a brand-new socket, as the app does. */
function reconnect(gone: Seated): Promise<Seated> {
  return client(gone.name, gone.clientId);
}

describe('dropping out of a lobby over the wire', () => {
  test('the table is told the seat is being held, not that the player left', async () => {
    lobbyReconnectService.configure({ graceMs: 10_000 });
    const { clients } = await lobbyOf(['Om', 'Yukta', 'Raj', 'Neha']);
    const [om, yukta] = clients;

    const notice = waitFor<{
      playerId: string;
      playerName: string;
      reconnectDeadline: string;
      lobby: LobbyState;
    }>(yukta.socket, 'lobby:player-disconnected');
    om.disconnect();
    const { lobby, playerId, playerName, reconnectDeadline } = await notice;

    assert.equal(playerId, om.playerId);
    assert.equal(playerName, 'Om');
    assert.ok(Date.parse(reconnectDeadline) > Date.now(), 'a live deadline was published');

    assert.equal(lobby.playerCount, 4, 'the lobby still contains exactly four players');
    assert.deepEqual(
      lobby.players.map(p => p.name),
      ['Om', 'Yukta', 'Raj', 'Neha'],
      'the order is unchanged'
    );

    const seat = lobby.players.find(p => p.playerId === om.playerId)!;
    assert.equal(seat.connected, false, 'shown as reconnecting');
    assert.equal(seat.seatPosition, 0);
    assert.equal(seat.isHost, true);
    assert.equal(
      lobby.players.filter(p => p.connected).length,
      3,
      'everyone else is still connected'
    );

    await flush();
    assert.equal(countReceived(yukta, 'lobby:player-left'), 0, 'nobody was reported as leaving');
  });

  test('reconnecting reclaims the same seat without duplicating the player', async () => {
    lobbyReconnectService.configure({ graceMs: 10_000 });
    const { clients } = await lobbyOf(['Om', 'Yukta', 'Raj', 'Neha']);
    const [om, yukta, , neha] = clients;

    await waitFor(yukta.socket, 'lobby:player-disconnected', () => om.disconnect());

    // Joins seen during setup, so the assertion below is about the reconnect
    // only.
    const joinsBefore = countReceived(yukta, 'lobby:player-joined');

    const back = waitFor<{ playerId: string; lobby: LobbyState }>(
      yukta.socket,
      'lobby:player-reconnected'
    );
    const omAgain = await reconnect(om);
    const { lobby } = await back;

    assert.equal(lobby.playerCount, 4, 'still exactly four players');
    assert.equal(
      lobby.players.filter(p => p.playerId === om.playerId).length,
      1,
      'no duplicate Om'
    );
    assert.equal(omAgain.playerId, om.playerId, 'the same player identity came back');

    const seat = lobby.players.find(p => p.playerId === om.playerId)!;
    assert.equal(seat.connected, true);
    assert.equal(seat.seatPosition, 0, 'exact seat preserved');
    assert.equal(seat.isHost, true, 'host status preserved');
    assert.equal(lobby.hostPlayerId, om.playerId);
    assert.equal(lobbyReconnectService.pendingCount(), 0, 'the removal was cancelled');

    // The returning socket was handed the session back, and as a reconnect -
    // never as a fresh join, which is what would replay join feedback.
    assert.equal(countReceived(omAgain, 'session:restore'), 1);
    assert.equal(countReceived(omAgain, 'lobby:joined'), 0, 'not reported to Om as a join');
    assert.equal(
      countReceived(yukta, 'lobby:player-joined'),
      joinsBefore,
      'the table was not told anyone joined'
    );

    // The new socket id really is the one registered for this seat: a change
    // made by somebody else reaches it.
    const update = waitFor<{ lobby: LobbyState }>(omAgain.socket, 'lobby:player-left', () =>
      neha.socket.emit('lobby:leave')
    );
    assert.equal((await update).lobby.playerCount, 3);
  });

  test('a player who never comes back loses the seat and the table is told', async () => {
    lobbyReconnectService.configure({ graceMs: 150 });
    const { clients, lobbyId } = await lobbyOf(['Om', 'Yukta', 'Raj']);
    const [, , raj] = clients;
    const yukta = clients[1];

    const left = waitFor<{ playerId: string; lobby: LobbyState }>(
      yukta.socket,
      'lobby:player-left'
    );
    raj.disconnect();
    const { playerId, lobby } = await left;

    assert.equal(playerId, raj.playerId);
    assert.equal(lobby.playerCount, 2);
    assert.ok(!lobby.players.some(p => p.playerId === raj.playerId));
    assert.equal(
      await db.lobbyPlayer.count({ where: { lobbyId, playerId: raj.playerId } }),
      0
    );
  });

  test('coming back inside the window survives the original deadline', async () => {
    lobbyReconnectService.configure({ graceMs: 250 });
    const { clients, lobbyId } = await lobbyOf(['Om', 'Yukta', 'Raj']);
    const [, yukta, raj] = clients;

    await waitFor(yukta.socket, 'lobby:player-disconnected', () => raj.disconnect());
    await waitFor(yukta.socket, 'lobby:player-reconnected', () => void reconnect(raj));

    // Well past the moment the original timer was set for.
    await flush(500);

    assert.equal(countReceived(yukta, 'lobby:player-left'), 0, 'Raj was never removed');
    assert.equal(
      (await lobbyService.getLobbyById(lobbyId))!.playerCount,
      3,
      'all three are still seated'
    );
  });

  test('dropping out twice works, and only the second window ends the seat', async () => {
    lobbyReconnectService.configure({ graceMs: 200 });
    const { clients, lobbyId } = await lobbyOf(['Om', 'Yukta', 'Raj']);
    const [, yukta, raj] = clients;

    // Drop, come back... (the listener goes on before the reconnect, or the
    // event lands before anyone is watching for it).
    await waitFor(yukta.socket, 'lobby:player-disconnected', () => raj.disconnect());
    const back = waitFor(yukta.socket, 'lobby:player-reconnected');
    const rajAgain = await reconnect(raj);
    await back;
    assert.equal((await lobbyService.getLobbyById(lobbyId))!.playerCount, 3);

    // ...and drop again. This second window is the one that counts.
    const left = waitFor<{ playerId: string }>(yukta.socket, 'lobby:player-left');
    rajAgain.disconnect();
    assert.equal((await left).playerId, raj.playerId);

    await flush(300);
    assert.equal(
      countReceived(yukta, 'lobby:player-left'),
      1,
      'removed exactly once, by the second grace period'
    );
    assert.equal((await lobbyService.getLobbyById(lobbyId))!.playerCount, 2);
  });

  test('the whole lobby is not disturbed by one player blinking out', async () => {
    lobbyReconnectService.configure({ graceMs: 10_000 });
    const { clients } = await lobbyOf(['Om', 'Yukta', 'Raj', 'Neha']);
    const [om, yukta, raj] = clients;

    await waitFor(yukta.socket, 'lobby:player-disconnected', () => om.disconnect());
    await flush();

    // Raj sees the same thing Yukta does - one card marked reconnecting, three
    // untouched - and no error was pushed to anyone.
    const rajView = raj.received.filter(r => r.event === 'lobby:update').pop() as
      | { payload: { lobby: LobbyState } }
      | undefined;
    assert.ok(rajView, 'Raj was sent the updated lobby');
    assert.equal(rajView.payload.lobby.playerCount, 4);
    assert.equal(countReceived(raj, 'lobby:error'), 0);
  });
});

describe('leaving on purpose is not a disconnect', () => {
  test('Leave Lobby removes the player at once, with no grace period', async () => {
    lobbyReconnectService.configure({ graceMs: 10_000 });
    const { clients, lobbyId } = await lobbyOf(['Om', 'Yukta', 'Raj']);
    const [, yukta, raj] = clients;

    const left = waitFor<{ playerId: string; lobby: LobbyState }>(
      yukta.socket,
      'lobby:player-left',
      () => raj.socket.emit('lobby:leave')
    );
    const { playerId, lobby } = await left;

    assert.equal(playerId, raj.playerId);
    assert.equal(lobby.playerCount, 2, 'gone immediately, not in 10 seconds');
    assert.equal(countReceived(yukta, 'lobby:player-disconnected'), 0, 'never shown as reconnecting');
    assert.equal(lobbyReconnectService.pendingCount(), 0, 'no seat was held');
    assert.equal(
      await db.lobbyPlayer.count({ where: { lobbyId, playerId: raj.playerId } }),
      0
    );
  });

  test('a player who leaves and then loses their socket is not resurrected', async () => {
    lobbyReconnectService.configure({ graceMs: 10_000 });
    const { clients, lobbyId } = await lobbyOf(['Om', 'Yukta', 'Raj']);
    const [, yukta, raj] = clients;

    await waitFor(yukta.socket, 'lobby:player-left', () => raj.socket.emit('lobby:leave'));
    raj.disconnect();
    await flush(150);

    assert.equal(lobbyReconnectService.pendingCount(), 0);
    assert.equal((await lobbyService.getLobbyById(lobbyId))!.playerCount, 2);
  });
});

describe('a kicked player cannot reclaim their seat', () => {
  test('the kick is immediate and a later reconnect restores nothing', async () => {
    lobbyReconnectService.configure({ graceMs: 10_000 });
    const { clients, lobbyId } = await lobbyOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta, raj] = clients;

    // Raj drops out first, so there is a held seat and a live timer to clear.
    await waitFor(yukta.socket, 'lobby:player-disconnected', () => raj.disconnect());
    assert.equal(lobbyReconnectService.pendingCount(), 1);

    const update = waitFor<{ lobby: LobbyState }>(yukta.socket, 'lobby:update', () =>
      om.socket.emit('lobby:kick-player', { playerId: raj.playerId })
    );
    const { lobby } = await update;

    assert.equal(lobby.playerCount, 2, 'removed at once, not after the grace period');
    assert.ok(!lobby.players.some(p => p.playerId === raj.playerId));
    assert.equal(lobbyReconnectService.pendingCount(), 0, 'the held seat was released');

    // Raj comes back with the same identity: there is nothing to come back to.
    const rajAgain = await reconnect(raj);
    await flush(150);

    assert.equal(countReceived(rajAgain, 'session:restore'), 0, 'no session was restored');
    assert.equal(
      (await lobbyService.getLobbyById(lobbyId))!.playerCount,
      2,
      'the kicked player did not reappear'
    );
    assert.equal(await lobbyService.getPlayerLobby(rajAgain.playerId), null);
  });
});

describe('the host dropping out', () => {
  test('keeps the lobby, the host badge and the seat while they reconnect', async () => {
    lobbyReconnectService.configure({ graceMs: 10_000 });
    const { clients, lobbyId } = await lobbyOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta] = clients;

    const notice = waitFor<{ lobby: LobbyState }>(yukta.socket, 'lobby:player-disconnected');
    om.disconnect();
    const held = (await notice).lobby;

    assert.equal(held.hostPlayerId, om.playerId, 'the host was not replaced');
    assert.equal(held.players.find(p => p.playerId === om.playerId)!.isHost, true);
    assert.equal(held.players.find(p => p.playerId === om.playerId)!.connected, false);
    assert.equal(held.playerCount, 3, 'the lobby was not destroyed');

    const back = waitFor<{ lobby: LobbyState }>(yukta.socket, 'lobby:player-reconnected');
    await reconnect(om);
    const restored = (await back).lobby;

    assert.equal(restored.hostPlayerId, om.playerId, 'still the host');
    const seat = restored.players.find(p => p.playerId === om.playerId)!;
    assert.equal(seat.isHost, true);
    assert.equal(seat.connected, true);
    assert.equal(seat.seatPosition, 0, 'same seat');
    assert.equal((await lobbyService.getLobbyById(lobbyId))!.playerCount, 3);
  });

  test('hands the lobby to the earliest-joined player if they never return', async () => {
    lobbyReconnectService.configure({ graceMs: 150 });
    const { clients } = await lobbyOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta] = clients;

    const left = waitFor<{ lobby: LobbyState }>(yukta.socket, 'lobby:player-left');
    om.disconnect();
    const { lobby } = await left;

    assert.equal(lobby.playerCount, 2);
    assert.equal(lobby.hostPlayerId, yukta.playerId, 'Yukta inherited the lobby');
    assert.equal(lobby.players.find(p => p.playerId === yukta.playerId)!.isHost, true);
  });
});

describe('starting the game while somebody is reconnecting', () => {
  test('is refused, with a reason the host can act on', async () => {
    lobbyReconnectService.configure({ graceMs: 10_000 });
    const { clients } = await lobbyOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta] = clients;

    const raj = clients[2];
    await waitFor(om.socket, 'lobby:player-disconnected', () => raj.disconnect());

    const error = await waitFor<{ message: string }>(om.socket, 'lobby:error', () =>
      om.socket.emit('lobby:start-game')
    );

    assert.equal(error.message, 'Waiting for all players to reconnect before starting the game.');

    await flush();
    assert.equal(countReceived(om, 'game:started'), 0, 'no cards were dealt');
    assert.equal(countReceived(yukta, 'game:started'), 0);

    // Once Raj is back, the same button works.
    await waitFor(om.socket, 'lobby:player-reconnected', () => void reconnect(raj));
    await waitFor(om.socket, 'game:started', () => om.socket.emit('lobby:start-game'));
  });

  test('a lobby of bots and present humans is never held up', async () => {
    lobbyReconnectService.configure({ graceMs: 10_000 });
    const { clients } = await lobbyOf(['Om', 'Yukta']);
    const [om] = clients;

    await waitFor(om.socket, 'lobby:update', () => om.socket.emit('lobby:add-bot'));

    await waitFor(om.socket, 'game:started', () => om.socket.emit('lobby:start-game'));
  });
});

describe('a full lobby over the wire', () => {
  test('a held seat still makes the lobby full', async () => {
    lobbyReconnectService.configure({ graceMs: 10_000 });
    const { clients, code } = await lobbyOf(['Om', 'Yukta'], { maxPlayers: 2 });
    const [om, yukta] = clients;

    await waitFor(om.socket, 'lobby:player-disconnected', () => yukta.disconnect());

    const gatecrasher = await client('Late');
    const error = await waitFor<{ message: string }>(gatecrasher.socket, 'lobby:error', () =>
      gatecrasher.socket.emit('lobby:join', { code, playerName: 'Late' })
    );

    assert.match(error.message, /full/i, 'the ninth player cannot steal a held seat');
  });

  test('a different player joining the same code is treated as a new join', async () => {
    lobbyReconnectService.configure({ graceMs: 10_000 });
    const { clients, code } = await lobbyOf(['Om', 'Yukta'], { maxPlayers: 4 });
    const [om, yukta] = clients;

    await waitFor(om.socket, 'lobby:player-disconnected', () => yukta.disconnect());

    // Same name, different device: identity is the stable client id, never the
    // name, so this must not hand them Yukta's seat.
    const impostor = await client('Yukta');
    const joined = await waitFor<{ lobby: LobbyState }>(impostor.socket, 'lobby:joined', () =>
      impostor.socket.emit('lobby:join', { code, playerName: 'Yukta' })
    );

    assert.notEqual(impostor.playerId, yukta.playerId, 'a different player entirely');
    assert.equal(joined.lobby.playerCount, 3, 'they took a new seat, not the held one');
    assert.equal(
      joined.lobby.players.find(p => p.playerId === yukta.playerId)!.connected,
      false,
      "the real Yukta's seat is still held for her"
    );
  });

  test('punching the code back in returns the same player to their own seat', async () => {
    lobbyReconnectService.configure({ graceMs: 10_000 });
    const { clients, code } = await lobbyOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta] = clients;

    await waitFor(om.socket, 'lobby:player-disconnected', () => yukta.disconnect());

    // Reconnect, then explicitly re-enter the code rather than relying on the
    // automatic session restore.
    const yuktaAgain = await reconnect(yukta);
    await flush(100);
    const joined = await waitFor<{ lobby: LobbyState }>(yuktaAgain.socket, 'lobby:joined', () =>
      yuktaAgain.socket.emit('lobby:join', { code, playerName: 'Yukta' })
    );

    assert.equal(joined.lobby.playerCount, 3, 'no duplicate seat was created');
    const seat = joined.lobby.players.find(p => p.playerId === yukta.playerId)!;
    assert.equal(seat.connected, true);
    assert.equal(seat.seatPosition, 1, 'her original seat');
  });
});

// Cold-start auto-rejoin, end to end.
//
// A cold start is not a reconnect: the process is gone, so nothing survives on
// the client except its stable clientId. What the server sees is a brand-new
// socket claiming an existing identity - which is exactly what these tests do,
// by dropping a client and connecting a fresh one with the same clientId.
//
// The contract being pinned here is the `session:restore` answer: it is sent to
// every identified connection, it carries enough state to put the player back on
// the right screen for the phase the game is actually in, and it never carries
// another player's cards.
//
// Timing is deliberate rather than incidental: the waiting-lobby grace period is
// widened per test so a cold start cannot race the seat being freed, and the
// game is driven through the real services so each phase is reached by playing
// it rather than by arranging rows.

import test, { describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { resetDatabase, closeDatabase } from '../helpers/db';
import {
  advanceToRound,
  continueAll,
  getState,
  playOutRound,
  startGame,
  submitAllBids,
} from '../helpers/gameFlow';
import {
  startTestServer,
  connectClient,
  waitFor,
  flush,
  Harness,
  TestClient,
} from '../helpers/socketHarness';
import { gameService } from '../../services/game.service';
import { lobbyReconnectService } from '../../services/lobbyReconnect.service';
import { lobbyService } from '../../services/lobby.service';
import { LobbyState } from '../../types/lobby';
import { Card } from '../../types/player';
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
  // Let the server finish its disconnect bookkeeping before the tables go.
  await flush(150);
  lobbyReconnectService.cancelAll();
  await resetDatabase();

  // Wide enough that no cold start in here can race a seat being freed; the
  // grace period itself is covered in lobbyDisconnect.test.ts.
  lobbyReconnectService.configure({ graceMs: 30_000 });
});

after(async () => {
  while (openClients.length) {
    openClients.pop()!.disconnect();
  }
  lobbyReconnectService.cancelAll();
  await harness.close();
  await closeDatabase();
});

interface Seated extends TestClient {
  clientId: string;
}

/** Connects and identifies a client, remembering the identity it comes back with. */
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

/**
 * The app being killed and reopened: the socket goes away entirely, and a new
 * one arrives later carrying nothing but the same stable clientId.
 */
async function coldStart(gone: Seated): Promise<Seated> {
  gone.disconnect();
  await flush(80);
  return client(gone.name, gone.clientId);
}

/** The session answer this connection was given. Exactly one is always sent. */
function sessionAnswer(client: TestClient): SessionRestorePayload {
  const answers = client.received.filter(r => r.event === 'session:restore');
  assert.equal(answers.length, 1, 'exactly one session answer per connection');
  return answers[0].payload as SessionRestorePayload;
}

/** Every {suit, rank} pair anywhere in a payload, however deeply nested. */
function cardsIn(value: unknown, found: Card[] = []): Card[] {
  if (!value || typeof value !== 'object') {
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) cardsIn(item, found);
    return found;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.suit === 'string' && typeof record.rank === 'string') {
    found.push(record as unknown as Card);
  }
  for (const item of Object.values(record)) cardsIn(item, found);
  return found;
}

const sameCard = (a: Card, b: Card) => a.suit === b.suit && a.rank === b.rank;

// ---------------------------------------------------------------------------
// Nothing to come back to
// ---------------------------------------------------------------------------

describe('a connection with no session', () => {
  test('is still answered, and told there is nothing to restore', async () => {
    const om = await client('Om');

    assert.deepEqual(sessionAnswer(om), {
      restored: false,
      reason: 'SESSION_NOT_FOUND',
      lobby: null,
      gameState: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Cold start into a waiting lobby
// ---------------------------------------------------------------------------

describe('cold start while in a waiting lobby', () => {
  test('gives back the whole lobby, not just a membership', async () => {
    const { clients, code, lobbyId } = await lobbyOf(['Om', 'Yukta', 'Raj'], {
      rounds: 5,
      maxPlayers: 6,
      scoringMode: '+1',
      orderMode: 'Random',
    });
    const [om, , raj] = clients;

    // A bot at the table, so the restored view has to include it.
    await waitFor(om.socket, 'lobby:update', () => om.socket.emit('lobby:add-bot'));

    const rajAgain = await coldStart(raj);
    const answer = sessionAnswer(rajAgain);

    assert.equal(answer.restored, true);
    assert.equal(answer.gameState, null, 'no game is running');

    const lobby = answer.lobby!;
    assert.equal(lobby.code, code, 'the same lobby, by code');
    assert.equal(lobby.id, lobbyId);
    assert.equal(lobby.status, 'WAITING');
    assert.deepEqual(
      lobby.players.map(p => p.name),
      ['Om', 'Yukta', 'Raj', 'Omkar'],
      'seat order is unchanged, the bot included'
    );
    assert.deepEqual(lobby.settings, {
      rounds: 5,
      maxPlayers: 6,
      scoringMode: '+1',
      orderMode: 'Random',
    });
    assert.equal(lobby.hostPlayerId, om.playerId, 'the host is still the host');

    const seat = lobby.players.find(p => p.playerId === raj.playerId)!;
    assert.equal(seat.seatPosition, 2, 'the same seat');
    assert.equal(seat.connected, true, 'shown as back');
    assert.equal(seat.isHost, false);
    assert.equal(lobby.playerCount, 4, 'nobody was duplicated by coming back');
  });

  test('the host keeps the lobby and the badge', async () => {
    const { clients, lobbyId } = await lobbyOf(['Om', 'Yukta', 'Raj', 'Neha']);
    const [om] = clients;

    const omAgain = await coldStart(om);
    const lobby = sessionAnswer(omAgain).lobby!;

    assert.equal(omAgain.playerId, om.playerId, 'the same identity came back');
    assert.equal(lobby.hostPlayerId, om.playerId, 'host was not transferred');
    assert.equal(lobby.players.find(p => p.playerId === om.playerId)!.isHost, true);
    assert.equal(lobby.players.find(p => p.playerId === om.playerId)!.seatPosition, 0);
    assert.equal(lobby.playerCount, 4, 'the lobby survived the host being gone');
    assert.equal(
      (await lobbyService.getLobbyById(lobbyId))!.hostPlayerId,
      om.playerId,
      'and the database agrees'
    );
  });

  test('the rest of the table is told, as a reconnect rather than a join', async () => {
    const { clients } = await lobbyOf(['Om', 'Yukta', 'Raj']);
    const [, yukta, raj] = clients;

    const joinsBefore = yukta.received.filter(r => r.event === 'lobby:player-joined').length;
    const back = waitFor<{ playerId: string }>(yukta.socket, 'lobby:player-reconnected');
    await coldStart(raj);

    assert.equal((await back).playerId, raj.playerId);
    assert.equal(
      yukta.received.filter(r => r.event === 'lobby:player-joined').length,
      joinsBefore,
      'nobody was announced as joining'
    );
  });

  test('bots are left exactly where they were', async () => {
    const { clients, lobbyId } = await lobbyOf(['Om', 'Yukta']);
    const [om] = clients;

    await waitFor(om.socket, 'lobby:update', () => om.socket.emit('lobby:add-bot'));
    await waitFor(om.socket, 'lobby:update', () => om.socket.emit('lobby:add-bot'));

    const before = (await lobbyService.getLobbyById(lobbyId))!.players.filter(p => p.isBot);
    const omAgain = await coldStart(om);
    const after = sessionAnswer(omAgain).lobby!.players.filter(p => p.isBot);

    assert.deepEqual(
      after.map(b => ({ id: b.playerId, seat: b.seatPosition, connected: b.connected })),
      before.map(b => ({ id: b.playerId, seat: b.seatPosition, connected: b.connected })),
      'same bots, same seats, still connected'
    );
  });
});

// ---------------------------------------------------------------------------
// Cold start into a live game
// ---------------------------------------------------------------------------

/** A lobby of real sockets with a game running, driven through the services. */
async function gameOf(names: string[], settings?: Record<string, unknown>) {
  const lobby = await lobbyOf(names, { rounds: 4, ...settings });
  const gameId = await startGame(lobby.lobbyId, lobby.host.playerId);
  return { ...lobby, gameId };
}

describe('cold start while a game is running', () => {
  test('comes back to the bidding phase, holding its own hand', async () => {
    const { clients, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;
    await advanceToRound(gameId, 3);

    const omAgain = await coldStart(om);
    const answer = sessionAnswer(omAgain);

    assert.equal(answer.restored, true);
    assert.equal(answer.lobby!.status, 'IN_GAME');

    const game = answer.gameState!;
    assert.equal(game.status, 'BIDDING');
    assert.equal(game.currentRound, 3);
    assert.equal(game.totalRounds, 4);
    assert.equal(game.myHand.length, 3, 'the round-3 hand, dealt before the app died');
    assert.equal(game.roundState!.roundNumber, 3);
    assert.ok(game.roundState!.trump, 'the trump for the round came back');
    assert.equal(
      game.roundState!.currentBidderId,
      (await getState(gameId)).roundState!.bidOrder[0],
      'bidding resumes with whoever it was waiting on'
    );
  });

  test('comes back mid-trick with the right turn, cards down and cards left', async () => {
    const { clients, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;
    await advanceToRound(gameId, 3);
    await submitAllBids(gameId);

    // One card on the table, played by whoever leads.
    const before = await getState(gameId);
    const leaderId = (await gameService.getGameById(gameId))!.currentTurnPlayerId!;
    const leader = before.players.find(p => p.id === leaderId)!;
    await gameService.playCard({ gameId, playerId: leaderId, card: leader.hand[0] });

    const omAgain = await coldStart(om);
    const game = sessionAnswer(omAgain).gameState!;

    assert.equal(game.status, 'PLAYING');
    assert.equal(game.roundState!.currentTrick!.cardsPlayed.length, 1, 'the played card is on the table');
    assert.equal(game.roundState!.currentTrick!.leadPlayerId, leaderId);
    assert.equal(
      game.currentTurnPlayerId,
      (await gameService.getGameById(gameId))!.currentTurnPlayerId,
      'the turn is exactly where the server has it'
    );
    assert.equal(game.isMyTurn, game.currentTurnPlayerId === om.playerId);
    assert.equal(
      game.myHand.length,
      om.playerId === leaderId ? 2 : 3,
      'a played card is gone from the hand it was played from, and only that one'
    );
    assert.deepEqual(
      game.roundState!.bids,
      before.roundState!.bids,
      'the bids everyone made are still there'
    );
  });

  test('comes back to the scoreboard, with the continue state on it', async () => {
    const { clients, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta] = clients;
    await playOutRound(gameId);

    // One player has already pressed Continue; the restored view must say so.
    const { scoreboardService } = await import('../../services/scoreboard.service');
    await scoreboardService.playerContinue(gameId, yukta.playerId);

    const omAgain = await coldStart(om);
    const answer = sessionAnswer(omAgain);

    assert.equal(answer.gameState!.status, 'ROUND_SCOREBOARD');
    const scoreboard = answer.scoreboard!;
    assert.ok(scoreboard, 'the scoreboard came with the session, not a round trip later');
    assert.equal(scoreboard.currentRound, 1);
    assert.equal(scoreboard.rows.length, 4, 'a row per round of the game');

    // The round just played is filled in; the ones ahead of it are still blank.
    const played = scoreboard.rows.find(r => r.roundNumber === 1)!;
    assert.equal(
      played.scores.every(s => s.score !== null && s.bid !== null),
      true,
      'round 1 has everyone s bid and score'
    );
    assert.equal(
      scoreboard.rows
        .filter(r => r.roundNumber > 1)
        .every(r => r.scores.every(s => s.score === null)),
      true,
      'later rounds have not been played yet'
    );
    assert.equal(
      scoreboard.players.find(p => p.id === yukta.playerId)!.hasContinued,
      true
    );
    assert.equal(scoreboard.players.find(p => p.id === om.playerId)!.hasContinued, false);
  });

  test('comes back to a finished game as finished', async () => {
    const { clients, gameId } = await gameOf(['Om', 'Yukta'], { rounds: 4 });
    const [om] = clients;

    for (let round = 1; round <= 4; round++) {
      await playOutRound(gameId);
      await continueAll(gameId);
      await gameService.advanceToNextRound(gameId);
    }

    const omAgain = await coldStart(om);
    const answer = sessionAnswer(omAgain);

    assert.equal(answer.restored, true);
    assert.equal(answer.gameState!.status, 'GAME_OVER');
    assert.equal(
      answer.scoreboard,
      null,
      'a finished game is not sitting on a round scoreboard'
    );
    assert.deepEqual(
      answer.gameState!.scores,
      (await getState(gameId)).scores,
      'the final scores are the authoritative ones'
    );
  });

  test('a game state request works immediately afterwards', async () => {
    // Proof that the new socket really was re-attached to the game, not just
    // handed a snapshot: it can talk to the game straight away.
    const { clients, gameId } = await gameOf(['Om', 'Yukta']);
    const [om] = clients;
    await advanceToRound(gameId, 2);

    const omAgain = await coldStart(om);
    const update = await waitFor<{ gameState: { id: string } }>(
      omAgain.socket,
      'game:update',
      () => omAgain.socket.emit('game:state-request')
    );

    assert.equal(update.gameState.id, gameId);
  });
});

// ---------------------------------------------------------------------------
// Private information
// ---------------------------------------------------------------------------

describe('what a restored player is allowed to see', () => {
  test('their own hand, and not one card of anybody else s', async () => {
    const { clients, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;
    // Round 4: four cards each, twelve dealt - a big enough deal that an
    // accidental leak would be obvious.
    await advanceToRound(gameId, 4);

    const state = await getState(gameId);
    const myHand = state.players.find(p => p.id === om.playerId)!.hand;
    const othersHands = state.players
      .filter(p => p.id !== om.playerId)
      .flatMap(p => p.hand);

    const omAgain = await coldStart(om);
    const answer = sessionAnswer(omAgain);
    const visible = cardsIn(answer);

    assert.equal(answer.gameState!.myHand.length, 4);
    for (const card of myHand) {
      assert.ok(
        visible.some(seen => sameCard(seen, card)),
        `own card ${card.rank} of ${card.suit} was restored`
      );
    }
    for (const card of othersHands) {
      assert.equal(
        visible.some(seen => sameCard(seen, card)),
        false,
        `somebody else's ${card.rank} of ${card.suit} must not be in the payload`
      );
    }

    // The others are described by count only - the same shape normal play uses.
    for (const player of answer.gameState!.players.filter(p => p.id !== om.playerId)) {
      assert.equal(player.cardCount, 4);
      assert.equal('hand' in player, false, 'no hand field for another player');
    }
  });
});

// ---------------------------------------------------------------------------
// Sessions that must not come back
// ---------------------------------------------------------------------------

describe('sessions that should stay ended', () => {
  test('leaving on purpose means the next launch restores nothing', async () => {
    const { clients } = await lobbyOf(['Om', 'Yukta', 'Raj']);
    const [, yukta, raj] = clients;

    await waitFor(yukta.socket, 'lobby:player-left', () => raj.socket.emit('lobby:leave'));

    const rajAgain = await coldStart(raj);
    const answer = sessionAnswer(rajAgain);

    assert.equal(answer.restored, false);
    assert.equal(answer.reason, 'SESSION_NOT_FOUND');
    assert.equal(answer.lobby, null);
  });

  test('a lobby that no longer exists restores nothing', async () => {
    const { clients, lobbyId } = await lobbyOf(['Om', 'Yukta']);
    const [om, yukta] = clients;

    // Both leave, which closes the lobby outright.
    await waitFor(yukta.socket, 'lobby:player-left', () => om.socket.emit('lobby:leave'));
    yukta.socket.emit('lobby:leave');
    await flush(150);
    assert.equal(await lobbyService.getLobbyById(lobbyId), null, 'the lobby is gone');

    const omAgain = await coldStart(om);
    assert.equal(sessionAnswer(omAgain).reason, 'SESSION_NOT_FOUND');
  });
});

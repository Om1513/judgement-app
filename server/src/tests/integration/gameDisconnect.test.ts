// In-game disconnect, bot takeover and the rejoin decision, end to end.
//
// Real Postgres, real Socket.IO, real bot engine. Nothing here arranges rows to
// reach a state: a game is started by the host pressing start, cards are played
// through `game:play-card`, and a takeover happens because a socket actually went
// away and a real timer actually elapsed. The assertions are therefore about what
// a phone at that table would see.
//
// What is being pinned:
//
//   * a dropout costs nothing - seat, hand, bid, score and player count all
//     survive, and the table is told "reconnecting" rather than losing a player;
//   * the game is never blocked by an absent seat: the bot plays it, legally, and
//     with only the information the player themselves had;
//   * coming back inside the grace period is silent, and coming back after a
//     takeover is a question, never an automatic re-entry;
//   * DISCARD ends one player's claim on a game and nothing else about it;
//   * a player who has not rejoined is sent no cards at all.
//
// The grace period is dialled down per test rather than waiting on the real 30
// seconds; the timer semantics themselves - stale timers, generations, the
// boundary race - are pinned deterministically with fake timers in
// tests/unit/gameReconnect.test.ts.

import test, { describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { db, resetDatabase, closeDatabase } from '../helpers/db';
import { advanceToRound, getState, submitAllBids } from '../helpers/gameFlow';
import {
  startTestServer,
  connectClient,
  waitFor,
  waitForMatching,
  flush,
  Harness,
  TestClient,
} from '../helpers/socketHarness';
import { gameReconnectService } from '../../services/gameReconnect.service';
import { gameService } from '../../services/game.service';
import { lobbyReconnectService } from '../../services/lobbyReconnect.service';
import { lobbyService } from '../../services/lobby.service';
import { ClientGameState } from '../../types/game';
import { LobbyState } from '../../types/lobby';
import { Card } from '../../types/player';
import { SessionRestorePayload } from '../../types/socket';
import { canPlayCard } from '../../utils/cardUtils';

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
  // Let the server finish its disconnect bookkeeping before the tables go, so
  // teardown cannot race a truncate.
  await flush(150);

  lobbyReconnectService.cancelAll();
  gameReconnectService.cancelAll();
  await resetDatabase();

  // Wide by default, so a test that is not about the deadline cannot race it.
  gameReconnectService.configure({ graceMs: 30_000 });
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

/** Connects and identifies a client, remembering the identity it comes back with. */
async function client(name: string, clientId?: string): Promise<Seated> {
  const id = clientId ?? `c-${name}-${++clientSeq}`;
  const connected = await connectClient(harness.url, name, id);
  openClients.push(connected);
  return Object.assign(connected, { clientId: id });
}

/**
 * A lobby of real sockets with a game running, started the way the host starts
 * it - so every socket carries the game id the handlers key off.
 */
async function gameOf(names: string[], settings?: Record<string, unknown>) {
  const clients: Seated[] = [];
  for (const name of names) {
    clients.push(await client(name));
  }

  const [host] = clients;
  const created = await waitFor<{ lobby: LobbyState }>(host.socket, 'lobby:created', () =>
    host.socket.emit('lobby:create', { playerName: host.name, settings: { rounds: 4, ...settings } })
  );

  for (const joiner of clients.slice(1)) {
    await waitFor<{ lobby: LobbyState }>(joiner.socket, 'lobby:joined', () =>
      joiner.socket.emit('lobby:join', { code: created.lobby.code, playerName: joiner.name })
    );
  }
  await flush();

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
    byId: (playerId: string) => clients.find(c => c.playerId === playerId)!,
  };
}

/**
 * The app being killed and reopened: the socket goes away entirely, and a new one
 * arrives later carrying nothing but the same stable clientId.
 */
async function coldStart(gone: Seated): Promise<Seated> {
  gone.disconnect();
  await flush(80);
  return client(gone.name, gone.clientId);
}

/** The most recent session answer this connection was given. */
function lastSessionAnswer(c: TestClient): SessionRestorePayload {
  const answers = c.received.filter(r => r.event === 'session:restore');
  assert.ok(answers.length > 0, 'the connection was answered at all');
  return answers[answers.length - 1].payload as SessionRestorePayload;
}

/** The seat's membership row, straight from the database. */
async function seatRow(lobbyId: string, playerId: string) {
  const row = await db.lobbyPlayer.findUnique({
    where: { lobbyId_playerId: { lobbyId, playerId } },
  });
  assert.ok(row, 'the membership row exists');
  return row;
}

/** Polls until `predicate` holds, so a real timer can be waited on without sleeping blindly. */
async function until(
  predicate: () => Promise<boolean>,
  what: string,
  timeoutMs = 6000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await flush(15);
  }
}

/** Waits for the bot to be given a seat, and returns once the row says so. */
function untilTakenOver(lobbyId: string, playerId: string): Promise<void> {
  return until(
    async () => (await seatRow(lobbyId, playerId)).controlledByBot,
    `the bot to take over ${playerId}`
  );
}

/**
 * Waits for a seat's grace period to be fully under way: the row marked absent
 * AND the takeover armed.
 *
 * Both, because they are written in that order and a poll that stopped at the
 * first would be asserting against a half-processed disconnect.
 */
function untilReconnecting(lobbyId: string, playerId: string): Promise<void> {
  return until(
    async () =>
      !(await seatRow(lobbyId, playerId)).connected &&
      gameReconnectService.isPending(lobbyId, playerId),
    `${playerId}'s grace period to start`
  );
}

/**
 * Drops a player and waits for the bot to actually inherit the seat.
 *
 * Waiting on the row rather than on a sleep matters: the countdown only starts
 * once the server has processed the disconnect, so "grace + a bit" is a race
 * against database latency, and a test that lost it would silently assert the
 * wrong branch.
 */
async function dropAndTakeOver(who: Seated, lobbyId: string): Promise<void> {
  who.disconnect();
  await untilTakenOver(lobbyId, who.playerId);
}

/** Reopens the app after the bot has taken the seat over. */
async function coldStartAfterTakeover(who: Seated, lobbyId: string): Promise<Seated> {
  await dropAndTakeOver(who, lobbyId);
  return client(who.name, who.clientId);
}

/**
 * A bid that is always legal for whoever is on turn: zero, except where the
 * dealer's forbidden total makes zero the one value they may not say.
 */
function legalBidFor(state: Awaited<ReturnType<typeof getState>>): number {
  const roundState = state.roundState!;
  const totalSoFar = Object.values(roundState.bids).reduce((a, b) => a + b, 0);
  const isLastBidder = Object.keys(roundState.bids).length === state.players.length - 1;
  return isLastBidder && totalSoFar === roundState.cardsPerPlayer ? 1 : 0;
}

/**
 * Plays a whole round the way phones do - every human action goes through its own
 * socket - and lets the bot take the turns it owns.
 *
 * Going through the sockets is the point: it is `game:submit-bid` and
 * `game:play-card` that drive the bot's follow-up turns, so a round driven
 * through the services directly would never exercise a takeover at all.
 */
async function driveRound(gameId: string, humans: Seated[], timeoutMs = 20000): Promise<void> {
  const { firstLegalCard } = await import('../helpers/gameFlow');
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out driving the round (last status: ${(await getState(gameId)).status})`);
    }

    const game = await gameService.getGameById(gameId);
    if (!game) throw new Error('the game vanished mid-round');
    const state = game.gameState;

    // HAND_WINNER and ROUND_COMPLETE are transient beats on the way to the
    // scoreboard; the round is only over once it lands somewhere it rests.
    if (
      state.status !== 'BIDDING' &&
      state.status !== 'PLAYING' &&
      state.status !== 'HAND_WINNER' &&
      state.status !== 'ROUND_COMPLETE'
    ) {
      return;
    }

    const turnId = game.currentTurnPlayerId;
    const human = turnId ? humans.find(c => c.playerId === turnId) : undefined;

    // No turn (the inter-hand pause), or a turn the bot owns: it acts on its own.
    if (!turnId || !human || state.roundState?.awaitingNextHand) {
      await flush(25);
      continue;
    }

    if (state.status === 'BIDDING') {
      human.socket.emit('game:submit-bid', { bid: legalBidFor(state) });
      await until(
        async () => {
          const now = await getState(gameId);
          return now.status !== 'BIDDING' || now.roundState!.bids[turnId] !== undefined;
        },
        `${human.name}'s bid to land`
      );
      continue;
    }

    const card = firstLegalCard(state, turnId);
    human.socket.emit('game:play-card', { card });
    // Wait for the turn to be *consumed*, not merely for a card to appear: a
    // looser condition can be satisfied by the next trick starting, and the loop
    // would then play out of turn.
    await until(
      async () => {
        const now = await gameService.getGameById(gameId);
        if (!now) return true;
        return now.gameState.status !== 'PLAYING' || now.currentTurnPlayerId !== turnId;
      },
      `${human.name}'s card to land`
    );
  }
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

// ---------------------------------------------------------------------------
// Test 1: dropping out costs nothing
// ---------------------------------------------------------------------------

describe('a player who drops out mid-game', () => {
  test('keeps their seat, hand, bid and score, and is shown as reconnecting', async () => {
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta] = clients;

    const before = await getState(gameId);
    const omBefore = before.players.find(p => p.id === om.playerId)!;

    const seen = waitForMatching<{ gameState: ClientGameState }>(
      yukta.socket,
      'game:update',
      data => data.gameState.players.some(p => p.id === om.playerId && p.connected === false)
    );
    om.disconnect();

    const table = (await seen).gameState;
    const omSeat = table.players.find(p => p.id === om.playerId)!;
    assert.equal(omSeat.connected, false, 'shown as away');
    assert.equal(omSeat.controlledByBot, false, 'no bot yet - the grace period is running');
    assert.equal(table.players.length, 3, 'nobody was removed from the table');
    assert.equal(omSeat.seatPosition, omBefore.seatPosition, 'seat unchanged');
    assert.equal(omSeat.cardCount, omBefore.hand.length, 'their cards are still theirs');
    assert.equal(omSeat.score, omBefore.score);

    const row = await seatRow(lobbyId, om.playerId);
    assert.equal(row.connected, false);
    assert.equal(row.controlledByBot, false);
    assert.ok(row.reconnectDeadline, 'a deadline was recorded');
    assert.equal(row.disconnectGeneration, 1, 'one drop so far');
    assert.equal(gameReconnectService.isPending(lobbyId, om.playerId), true);
  });

  test('does not affect anybody else at the table', async () => {
    const { clients, lobbyId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta, raj] = clients;

    om.disconnect();
    await flush(120);

    for (const other of [yukta, raj]) {
      const row = await seatRow(lobbyId, other.playerId);
      assert.equal(row.connected, true, `${other.name} is unaffected`);
      assert.equal(row.controlledByBot, false);
      assert.equal(
        gameReconnectService.isPending(lobbyId, other.playerId),
        false,
        `${other.name} has no countdown`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2 and 10: coming back inside the grace period
// ---------------------------------------------------------------------------

describe('coming back inside the grace period', () => {
  test('is restored straight into the game, with no prompt and no bot', async () => {
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;

    const before = await getState(gameId);
    const handBefore = before.players.find(p => p.id === om.playerId)!.hand;

    const omAgain = await coldStart(om);
    const answer = lastSessionAnswer(omAgain);

    assert.equal(answer.restored, true, 'restored, not asked');
    assert.equal(answer.reason, undefined);
    assert.equal(answer.rejoin, undefined, 'no rejoin prompt for a quick return');

    const game = answer.gameState!;
    assert.equal(game.id, gameId);
    assert.deepEqual(game.myHand, handBefore, 'the same hand, card for card');
    assert.equal(
      game.players.find(p => p.id === om.playerId)!.connected,
      true,
      'shown as back'
    );

    const row = await seatRow(lobbyId, om.playerId);
    assert.equal(row.connected, true);
    assert.equal(row.controlledByBot, false, 'the bot never got involved');
    assert.equal(
      gameReconnectService.isPending(lobbyId, om.playerId),
      false,
      'the countdown was cancelled'
    );
  });

  test('the rest of the table is told, and nobody is duplicated', async () => {
    const { clients, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta] = clients;

    om.disconnect();
    await flush(100);

    const back = waitForMatching<{ gameState: ClientGameState }>(
      yukta.socket,
      'game:update',
      data => data.gameState.players.some(p => p.id === om.playerId && p.connected === true)
    );
    await client(om.name, om.clientId);

    const table = (await back).gameState;
    assert.equal(table.players.length, 3, 'still three players');
    assert.equal(
      table.players.filter(p => p.id === om.playerId).length,
      1,
      'exactly one Om - no substitute was created'
    );
    assert.equal((await getState(gameId)).players.length, 3);
  });

  test('the player can act immediately afterwards', async () => {
    // Proof the new socket really was re-attached to the game rather than handed
    // a snapshot: it can bid.
    const { clients, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const bidderId = (await gameService.getGameById(gameId))!.currentTurnPlayerId!;
    const bidder = clients.find(c => c.playerId === bidderId)!;

    const back = await coldStart(bidder);
    const update = await waitForMatching<{ gameState: ClientGameState }>(
      back.socket,
      'game:update',
      data => data.gameState.roundState?.bids[bidderId] === 0,
      () => back.socket.emit('game:submit-bid', { bid: 0 })
    );

    assert.equal(update.gameState.roundState!.bids[bidderId], 0);
  });
});

// ---------------------------------------------------------------------------
// Tests 3, 4, 5: the bot takes over, legally
// ---------------------------------------------------------------------------

describe('bot takeover when nobody comes back', () => {
  test('changes only the controller, and the table is told', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta] = clients;

    const before = await getState(gameId);
    const omBefore = before.players.find(p => p.id === om.playerId)!;

    const autoPlaying = waitForMatching<{ gameState: ClientGameState }>(
      yukta.socket,
      'game:update',
      data =>
        data.gameState.players.some(p => p.id === om.playerId && p.controlledByBot === true)
    );
    om.disconnect();

    const table = (await autoPlaying).gameState;
    const omSeat = table.players.find(p => p.id === om.playerId)!;
    assert.equal(omSeat.controlledByBot, true, 'the bot is playing the seat');
    assert.equal(omSeat.connected, false, 'the human is still away');
    assert.equal(omSeat.name, omBefore.name, 'same name - not a substitute player');
    assert.equal(omSeat.seatPosition, omBefore.seatPosition, 'same seat');
    assert.equal(table.players.length, 3, 'the table still has three seats');

    const row = await seatRow(lobbyId, om.playerId);
    assert.equal(row.controlledByBot, true);
    assert.equal(row.seatPosition, omBefore.seatPosition, 'the seat row is the same row');
    assert.equal(row.sessionDiscarded, false, 'they have not been asked yet');
  });

  test('the bidding it was blocking is completed, with a legal bid', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);

    // Drop whoever the round is actually waiting on, so the takeover has to
    // unblock the game rather than merely being recorded.
    const blockedId = (await gameService.getGameById(gameId))!.currentTurnPlayerId!;
    const blocked = clients.find(c => c.playerId === blockedId)!;
    const handSize = (await getState(gameId)).roundState!.cardsPerPlayer;

    await dropAndTakeOver(blocked, lobbyId);

    await until(
      async () => (await getState(gameId)).roundState!.bids[blockedId] !== undefined,
      'the bot to bid for the absent seat'
    );

    const state = await getState(gameId);
    const bid = state.roundState!.bids[blockedId];
    assert.ok(bid >= 0 && bid <= handSize, `bid ${bid} is within 0..${handSize}`);
    assert.equal(
      state.players.find(p => p.id === blockedId)!.bid,
      bid,
      'the bid is recorded against the same player, not a new one'
    );

    // And it was persisted through the ordinary pipeline, not a side channel.
    const row = await db.roundBid.findFirst({ where: { gameId, playerId: blockedId } });
    assert.ok(row, 'the bid went through the normal bid pipeline');
    assert.equal(row.bidValue, bid);
  });

  test("the bot's dealer bid never makes the total equal the hand size", async () => {
    // The dealer bids last and may not make bids total the hand size. Round 3 has
    // three cards each, so there is a real forbidden value to avoid.
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    await advanceToRound(gameId, 3);

    const state = await getState(gameId);
    const bidOrder = state.roundState!.bidOrder;
    const dealerBidsLast = bidOrder[bidOrder.length - 1];
    const dealer = clients.find(c => c.playerId === dealerBidsLast)!;
    const handSize = state.roundState!.cardsPerPlayer;

    // Everyone bids one, stopping short of the dealer - whose seat the bot then
    // inherits with a forbidden value waiting for it.
    for (;;) {
      const game = (await gameService.getGameById(gameId))!;
      if (game.gameState.status !== 'BIDDING') break;
      const playerId = game.currentTurnPlayerId!;
      if (playerId === dealerBidsLast) break;
      await gameService.submitBid({ gameId, playerId, bid: 1 });
    }

    const beforeDealer = await getState(gameId);
    const totalSoFar = Object.values(beforeDealer.roundState!.bids).reduce((a, b) => a + b, 0);
    assert.ok(
      handSize - totalSoFar >= 0 && handSize - totalSoFar <= handSize,
      `there is a real forbidden bid for the dealer (${handSize - totalSoFar})`
    );

    await dropAndTakeOver(dealer, lobbyId);
    await until(
      async () => (await getState(gameId)).roundState!.bids[dealerBidsLast] !== undefined,
      'the bot to make the dealer bid'
    );

    const after = await getState(gameId);
    const bids = after.roundState!.bids;
    const total = Object.values(bids).reduce((a, b) => a + b, 0);
    const botBid = bids[dealerBidsLast];

    assert.ok(botBid >= 0 && botBid <= handSize, `bid ${botBid} is in range`);
    assert.notEqual(total, handSize, 'the forbidden total was avoided');
  });

  test('the bot follows suit when it can, using only the seat s own cards', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { lobbyId, gameId, byId } = await gameOf(['Om', 'Yukta', 'Raj']);
    // Round 3: three cards each, so following suit is a real constraint.
    await advanceToRound(gameId, 3);
    await submitAllBids(gameId);

    const playing = await getState(gameId);
    const leaderId = (await gameService.getGameById(gameId))!.currentTurnPlayerId!;
    const turnOrder = playing.turnOrder;
    const nextId = turnOrder[(turnOrder.indexOf(leaderId) + 1) % turnOrder.length];

    // The player right after the leader drops out, so the bot plays into a trick
    // that already has a lead suit on the table.
    const handBefore = playing.players.find(p => p.id === nextId)!.hand.map(c => ({ ...c }));
    await dropAndTakeOver(byId(nextId), lobbyId);

    // The leader plays through the normal socket path, which is what drives the
    // bot's turn.
    const leaderCard = playing.players.find(p => p.id === leaderId)!.hand[0];
    byId(leaderId).socket.emit('game:play-card', { card: leaderCard });

    await until(
      async () =>
        ((await getState(gameId)).roundState?.currentTrick?.cardsPlayed ?? []).some(
          c => c.playerId === nextId
        ),
      'the bot to play a card for the absent seat'
    );

    const trick = (await getState(gameId)).roundState!.currentTrick!;
    const leadSuit = trick.leadSuit!;
    const botPlay = trick.cardsPlayed.find(c => c.playerId === nextId)!.card;

    assert.equal(
      canPlayCard(botPlay, handBefore, leadSuit),
      true,
      `${botPlay.rank} of ${botPlay.suit} is a legal play on a ${leadSuit} lead`
    );
    assert.ok(
      handBefore.some(c => c.suit === botPlay.suit && c.rank === botPlay.rank),
      'the bot played a card that was actually in that seat s hand - not an invented one'
    );
    if (handBefore.some(c => c.suit === leadSuit)) {
      assert.equal(botPlay.suit, leadSuit, 'held the lead suit, so had to follow it');
    }
  });

  test('the round scoreboard is not left waiting on an absent seat', async () => {
    // Every player has to press Continue for the round to advance. A seat nobody
    // is driving would block the other two indefinitely - the one failure mode
    // this whole feature exists to prevent.
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta, raj] = clients;

    await dropAndTakeOver(om, lobbyId);

    // Round 1 is one card each. The two humans play through their sockets and the
    // bot takes the absent seat's turns.
    await driveRound(gameId, [yukta, raj]);
    assert.equal((await getState(gameId)).status, 'ROUND_SCOREBOARD');

    const advanced = waitFor<{ gameState: ClientGameState }>(yukta.socket, 'round:bidding-started');
    yukta.socket.emit('scoreboard:continue');
    raj.socket.emit('scoreboard:continue');

    const next = await advanced;
    assert.equal(next.gameState.currentRound, 2, 'the game moved on without the absent player');
    assert.equal(
      next.gameState.players.find(p => p.id === om.playerId)!.controlledByBot,
      true,
      'and their seat is still played by the bot'
    );
  });
});

// ---------------------------------------------------------------------------
// Tests 6, 9, 11, 17: coming back after a takeover
// ---------------------------------------------------------------------------

describe('cold start after the bot has taken over', () => {
  test('offers a rejoin instead of putting the player back in the game', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;

    const omAgain = await coldStartAfterTakeover(om, lobbyId);
    const answer = lastSessionAnswer(omAgain);

    assert.equal(answer.restored, false, 'not silently re-entered');
    assert.equal(answer.reason, 'REJOIN_AVAILABLE');
    assert.ok(answer.rejoin, 'an offer was made');
    assert.equal(answer.rejoin!.gameId, gameId);
    assert.equal(answer.rejoin!.currentRound, 1);
    assert.equal(answer.rejoin!.totalRounds, 4);
    assert.ok(answer.rejoin!.status, 'the phase they would be coming back to');

    // Nothing about the game came with the offer.
    assert.equal(answer.lobby, null, 'no lobby state');
    assert.equal(answer.gameState, null, 'no game state');
    assert.deepEqual(cardsIn(answer), [], 'and not a single card');
  });

  test('asking again changes nothing about the game', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;

    const first = await coldStartAfterTakeover(om, lobbyId);
    const second = await coldStart(first);

    assert.equal(lastSessionAnswer(second).reason, 'REJOIN_AVAILABLE');
    const row = await seatRow(lobbyId, om.playerId);
    assert.equal(row.controlledByBot, true, 'the bot is still playing the seat');
    assert.equal(row.connected, false);
  });

  test('REJOIN hands control back and delivers the current state', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);

    // Drop the seat the round is waiting on, so the bot definitely acts in their
    // name before they come back.
    const blockedId = (await gameService.getGameById(gameId))!.currentTurnPlayerId!;
    const blocked = clients.find(c => c.playerId === blockedId)!;

    await dropAndTakeOver(blocked, lobbyId);
    await until(
      async () => (await getState(gameId)).roundState!.bids[blockedId] !== undefined,
      'the bot to bid'
    );
    const botBid = (await getState(gameId)).roundState!.bids[blockedId];

    const back = await coldStart(blocked);
    assert.equal(lastSessionAnswer(back).reason, 'REJOIN_AVAILABLE');

    const restored = await waitForMatching<SessionRestorePayload>(
      back.socket,
      'session:restore',
      payload => payload.restored === true,
      () => back.socket.emit('session:rejoin')
    );

    assert.equal(restored.restored, true);
    const game = restored.gameState!;
    assert.equal(game.id, gameId);

    // The bot's move stands - this is a resumption, not a rewind.
    assert.equal(
      game.roundState!.bids[blockedId],
      botBid,
      'the bid the bot made in their name is still there'
    );

    const authoritative = await getState(gameId);
    assert.deepEqual(
      game.myHand,
      authoritative.players.find(p => p.id === blockedId)!.hand,
      'the hand they get back is the current one, not the one they left'
    );

    const row = await seatRow(lobbyId, blockedId);
    assert.equal(row.controlledByBot, false, 'the bot is off the seat');
    assert.equal(row.connected, true);
    assert.equal(
      gameReconnectService.isPending(lobbyId, blockedId),
      false,
      'no countdown left armed'
    );
  });

  test('a rejoined player is sent their own hand and nobody else s cards', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;
    // Round 4: four cards each, twelve dealt - a leak would be obvious.
    await advanceToRound(gameId, 4);

    await dropAndTakeOver(om, lobbyId);

    const back = await client(om.name, om.clientId);
    const restored = await waitForMatching<SessionRestorePayload>(
      back.socket,
      'session:restore',
      payload => payload.restored === true,
      () => back.socket.emit('session:rejoin')
    );

    // Read the authoritative hands *after* the rejoin: the bot may have played in
    // the meantime, and what matters is that the payload matches the game as it
    // now stands rather than as it was.
    const state = await getState(gameId);
    const myHand = state.players.find(p => p.id === om.playerId)!.hand;
    const othersHands = state.players
      .filter(p => p.id !== om.playerId)
      .flatMap(p => p.hand);

    const visible = cardsIn(restored);
    const same = (a: Card, b: Card) => a.suit === b.suit && a.rank === b.rank;

    assert.equal(restored.gameState!.myHand.length, myHand.length);
    for (const card of myHand) {
      assert.ok(
        visible.some(seen => same(seen, card)),
        `own card ${card.rank} of ${card.suit} came back`
      );
    }
    for (const card of othersHands) {
      assert.equal(
        visible.some(seen => same(seen, card)),
        false,
        `somebody else's ${card.rank} of ${card.suit} must not be in the payload`
      );
    }
    for (const player of restored.gameState!.players.filter(p => p.id !== om.playerId)) {
      assert.equal('hand' in player, false, 'no hand field for another player');
    }
  });

  test('the rejoined player can play again, and the bot no longer can', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);

    const blockedId = (await gameService.getGameById(gameId))!.currentTurnPlayerId!;
    const blocked = clients.find(c => c.playerId === blockedId)!;

    const back = await coldStartAfterTakeover(blocked, lobbyId);
    await waitForMatching<SessionRestorePayload>(
      back.socket,
      'session:restore',
      payload => payload.restored === true,
      () => back.socket.emit('session:rejoin')
    );

    // Their seat is theirs again, so an action from their socket is accepted
    // rather than refused.
    const errors: unknown[] = [];
    back.socket.on('game:error', payload => errors.push(payload));

    const state = await getState(gameId);
    if (state.status === 'BIDDING' && state.roundState!.bids[blockedId] === undefined) {
      await waitForMatching<{ gameState: ClientGameState }>(
        back.socket,
        'game:update',
        data => data.gameState.roundState?.bids[blockedId] !== undefined,
        () => back.socket.emit('game:submit-bid', { bid: 0 })
      );
    }

    assert.deepEqual(errors, [], 'no action was refused');
    const row = await seatRow(lobbyId, blockedId);
    assert.equal(row.controlledByBot, false);
  });
});

// ---------------------------------------------------------------------------
// Test 8: DISCARD
// ---------------------------------------------------------------------------

describe('DISCARD', () => {
  test('ends this player s claim on the game and nothing else about it', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta, raj] = clients;

    const back = await coldStartAfterTakeover(om, lobbyId);
    assert.equal(lastSessionAnswer(back).reason, 'REJOIN_AVAILABLE');

    const answer = await waitFor<SessionRestorePayload>(back.socket, 'session:restore', () =>
      back.socket.emit('session:discard')
    );

    assert.equal(answer.restored, false);
    assert.equal(answer.reason, 'SESSION_DISCARDED', 'authoritative: forget the session');
    assert.equal(answer.gameState, null);

    // The game is untouched: same seats, same players, bot on the discarded one.
    const row = await seatRow(lobbyId, om.playerId);
    assert.equal(row.sessionDiscarded, true);
    assert.equal(row.controlledByBot, true, 'the bot keeps the seat');
    assert.equal((await getState(gameId)).players.length, 3, 'no seat was deleted');
    assert.equal((await lobbyService.getLobbyById(lobbyId))!.playerCount, 3);

    for (const other of [yukta, raj]) {
      const otherRow = await seatRow(lobbyId, other.playerId);
      assert.equal(otherRow.connected, true, `${other.name} plays on`);
      assert.equal(otherRow.sessionDiscarded, false);
      assert.equal(otherRow.controlledByBot, false);
    }
  });

  test('is not offered the game again on a later launch', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;

    const back = await coldStartAfterTakeover(om, lobbyId);
    await waitFor(back.socket, 'session:restore', () => back.socket.emit('session:discard'));

    const later = await coldStart(back);
    const answer = lastSessionAnswer(later);

    assert.equal(answer.restored, false);
    assert.equal(answer.rejoin, undefined, 'not prompted again');
    // The seat they walked away from is the bot's now, so as far as "where is
    // this player?" is concerned they are nowhere - which is exactly what frees
    // them to start something else.
    assert.equal(answer.reason, 'SESSION_NOT_FOUND');
  });

  test('frees the player to create a brand-new lobby straight away', async () => {
    // The regression that made this whole path unusable: the discarded seat is
    // kept so the bot can play it, and it used to answer "you are already in a
    // lobby", locking the player out of every new game until the old one ended.
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId, code } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;

    const back = await coldStartAfterTakeover(om, lobbyId);
    await waitFor(back.socket, 'session:restore', () => back.socket.emit('session:discard'));

    const created = await waitFor<{ lobby: LobbyState }>(back.socket, 'lobby:created', () =>
      back.socket.emit('lobby:create', { playerName: back.name })
    );

    assert.notEqual(created.lobby.code, code, 'a genuinely new lobby');
    assert.equal(created.lobby.hostPlayerId, om.playerId, 'and they host it');
    assert.equal(created.lobby.status, 'WAITING');

    // The game they left is untouched, still three seats, bot on theirs.
    assert.equal((await getState(gameId)).players.length, 3);
    assert.equal((await seatRow(lobbyId, om.playerId)).controlledByBot, true);
  });

  test('the new lobby is what a later launch restores, not the abandoned game', async () => {
    // Two membership rows now exist for one player. The one that must win is the
    // one they are actually sitting in.
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;

    const back = await coldStartAfterTakeover(om, lobbyId);
    await waitFor(back.socket, 'session:restore', () => back.socket.emit('session:discard'));
    const created = await waitFor<{ lobby: LobbyState }>(back.socket, 'lobby:created', () =>
      back.socket.emit('lobby:create', { playerName: back.name })
    );

    const later = await coldStart(back);
    const answer = lastSessionAnswer(later);

    assert.equal(answer.restored, true);
    assert.equal(answer.lobby!.code, created.lobby.code, 'the new lobby, not the old game');
    assert.equal(answer.gameState, null, 'and not carrying the abandoned game s state');
  });

  test('the remaining players carry on and finish the round', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om, yukta, raj] = clients;

    const back = await coldStartAfterTakeover(om, lobbyId);
    await waitFor(back.socket, 'session:restore', () => back.socket.emit('session:discard'));

    // Round 1: one card each. The two humans and the bot see it through.
    await driveRound(gameId, [yukta, raj]);
    assert.equal((await getState(gameId)).status, 'ROUND_SCOREBOARD');

    const advanced = waitFor<{ gameState: ClientGameState }>(yukta.socket, 'round:bidding-started');
    for (const c of [yukta, raj]) {
      c.socket.emit('scoreboard:continue');
    }

    const next = await advanced;
    assert.equal(next.gameState.currentRound, 2);
    assert.equal(
      (await seatRow(lobbyId, om.playerId)).controlledByBot,
      true,
      'the discarded seat is still played by the bot'
    );
  });

  test('an action from a socket whose seat the bot owns is refused', async () => {
    // The guard that stops a seat ever having two controllers. Reached here by
    // discarding while the original socket is still open, which is the shape of
    // the race it exists for.
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const bidderId = (await gameService.getGameById(gameId))!.currentTurnPlayerId!;
    const bidder = clients.find(c => c.playerId === bidderId)!;

    const lobby = (await lobbyService.getLobbyById(lobbyId))!;
    await gameReconnectService.discard(lobby, bidderId);

    const error = await waitFor<{ message: string; code?: string }>(
      bidder.socket,
      'game:error',
      () => bidder.socket.emit('game:submit-bid', { bid: 0 })
    );

    assert.equal(error.code, 'REJOIN_REQUIRED');
    assert.match(error.message, /rejoin/i);
  });
});

// ---------------------------------------------------------------------------
// Tests 12, 15, 16: the rest of the lifecycle
// ---------------------------------------------------------------------------

describe('several players away at once', () => {
  test('each seat has its own state, timer and outcome', async () => {
    // Wide enough that Om's return cannot lose a race against his own deadline -
    // the test is about the two seats being independent, not about the timing.
    gameReconnectService.configure({ graceMs: 2_000 });
    const { clients, lobbyId } = await gameOf(['Om', 'Yukta', 'Raj', 'Neha']);
    const [om, yukta, , neha] = clients;

    om.disconnect();
    yukta.disconnect();
    await untilReconnecting(lobbyId, om.playerId);
    await untilReconnecting(lobbyId, yukta.playerId);

    assert.equal(gameReconnectService.isPending(lobbyId, om.playerId), true);
    assert.equal(gameReconnectService.isPending(lobbyId, yukta.playerId), true);

    // Om comes back inside the window; Yukta does not.
    const omAgain = await client(om.name, om.clientId);
    assert.equal(lastSessionAnswer(omAgain).restored, true, 'Om restored silently');

    await untilTakenOver(lobbyId, yukta.playerId);

    const omRow = await seatRow(lobbyId, om.playerId);
    assert.equal(omRow.connected, true, 'Om is back');
    assert.equal(omRow.controlledByBot, false, "Om's seat was never handed over");

    const yuktaRow = await seatRow(lobbyId, yukta.playerId);
    assert.equal(yuktaRow.controlledByBot, true, "Yukta's seat was");

    const nehaRow = await seatRow(lobbyId, neha.playerId);
    assert.equal(nehaRow.connected, true, 'and Neha never noticed');
    assert.equal(nehaRow.controlledByBot, false);
  });
});

describe('a game that finished while the player was away', () => {
  test('is shown as finished rather than offered as a rejoin', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta'], { rounds: 4 });
    const [om] = clients;

    await dropAndTakeOver(om, lobbyId);

    // Play the game out to the end.
    const { playOutRound, continueAll } = await import('../helpers/gameFlow');
    for (let round = 1; round <= 4; round++) {
      await playOutRound(gameId);
      await continueAll(gameId);
      await gameService.advanceToNextRound(gameId);
    }
    assert.equal((await getState(gameId)).status, 'GAME_OVER');

    const omAgain = await client(om.name, om.clientId);
    const answer = lastSessionAnswer(omAgain);

    assert.equal(answer.restored, true, 'restored, so they can see how it ended');
    assert.equal(answer.reason, undefined);
    assert.equal(answer.rejoin, undefined, 'nothing to rejoin - the game is over');
    assert.equal(answer.gameState!.status, 'GAME_OVER');
    assert.deepEqual(
      answer.gameState!.scores,
      (await getState(gameId)).scores,
      'the final scores are the authoritative ones'
    );
  });

  test('a seat that dropped out after the game ended gets no countdown', async () => {
    gameReconnectService.configure({ graceMs: 40 });
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta'], { rounds: 4 });
    const [om] = clients;

    const { playOutRound, continueAll } = await import('../helpers/gameFlow');
    for (let round = 1; round <= 4; round++) {
      await playOutRound(gameId);
      await continueAll(gameId);
      await gameService.advanceToNextRound(gameId);
    }

    om.disconnect();
    await flush(150);

    assert.equal(gameReconnectService.isPending(lobbyId, om.playerId), false);
    assert.equal((await seatRow(lobbyId, om.playerId)).controlledByBot, false);
  });
});

describe('leaving a game on purpose', () => {
  test('takes effect at once, with no grace period', async () => {
    const { clients, lobbyId, gameId } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;

    om.socket.emit('lobby:leave');
    await flush(150);

    assert.equal(
      gameReconnectService.isPending(lobbyId, om.playerId),
      false,
      'no countdown - this was deliberate'
    );

    // The seat is not deleted: the other two are mid-round with cards dealt, and
    // a vanished seat would block the game on a turn nobody can take.
    const row = await seatRow(lobbyId, om.playerId);
    assert.equal(row.controlledByBot, true, 'the bot finishes their hands');
    assert.equal(row.sessionDiscarded, true, 'and they will not be offered it back');
    assert.equal((await getState(gameId)).players.length, 3, 'the table is intact');
  });

  test('is never restored on a later launch', async () => {
    const { clients } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;

    om.socket.emit('lobby:leave');
    await flush(150);

    const omAgain = await coldStart(om);
    const answer = lastSessionAnswer(omAgain);

    assert.equal(answer.restored, false);
    assert.equal(answer.reason, 'SESSION_NOT_FOUND');
    assert.equal(answer.rejoin, undefined, 'not prompted about a game they walked out of');
  });

  test('leaves the player free to start a new game immediately', async () => {
    // Pressing Leave Game and then Create Game is the single most obvious thing
    // to do next, and the bot-played seat left behind must not block it.
    const { clients, lobbyId, code } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;

    om.socket.emit('lobby:leave');
    await flush(200);

    const created = await waitFor<{ lobby: LobbyState }>(om.socket, 'lobby:created', () =>
      om.socket.emit('lobby:create', { playerName: om.name })
    );

    assert.notEqual(created.lobby.code, code);
    assert.equal(created.lobby.playerCount, 1);
    assert.equal((await seatRow(lobbyId, om.playerId)).controlledByBot, true, 'old seat bot-played');
  });

  test('leaves the player free to join somebody else s lobby', async () => {
    const { clients } = await gameOf(['Om', 'Yukta', 'Raj']);
    const [om] = clients;

    om.socket.emit('lobby:leave');
    await flush(200);

    // A fresh lobby hosted by somebody entirely different.
    const neha = await client('Neha');
    const hosted = await waitFor<{ lobby: LobbyState }>(neha.socket, 'lobby:created', () =>
      neha.socket.emit('lobby:create', { playerName: 'Neha' })
    );

    const joined = await waitFor<{ lobby: LobbyState }>(om.socket, 'lobby:joined', () =>
      om.socket.emit('lobby:join', { code: hosted.lobby.code, playerName: om.name })
    );

    assert.equal(joined.lobby.code, hosted.lobby.code);
    assert.equal(joined.lobby.playerCount, 2);
  });

  test('leaving a waiting lobby still removes the seat, exactly as before', async () => {
    // The pre-existing behaviour must be untouched: only a live game holds a seat.
    const om = await client('Om');
    const yukta = await client('Yukta');

    const created = await waitFor<{ lobby: LobbyState }>(om.socket, 'lobby:created', () =>
      om.socket.emit('lobby:create', { playerName: 'Om' })
    );
    await waitFor(yukta.socket, 'lobby:joined', () =>
      yukta.socket.emit('lobby:join', { code: created.lobby.code, playerName: 'Yukta' })
    );

    const left = await waitFor<{ lobby: LobbyState }>(om.socket, 'lobby:player-left', () =>
      yukta.socket.emit('lobby:leave')
    );

    assert.equal(left.lobby.playerCount, 1, 'the seat was freed');
    assert.equal(
      left.lobby.players.some(p => p.playerId === yukta.playerId),
      false
    );
  });
});

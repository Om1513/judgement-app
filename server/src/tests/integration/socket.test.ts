// End-to-end over real Socket.IO connections.
//
// A real server, real clients, real broadcasts. These cover the thing service
// tests cannot: that the other players at the table are actually told what
// happened, and told it once.

import test, { describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { resetDatabase, closeDatabase } from '../helpers/db';
import {
  startTestServer,
  connectClient,
  waitFor,
  waitForMatching,
  countReceived,
  flush,
  Harness,
  TestClient,
} from '../helpers/socketHarness';
import { ClientGameState, ScoreboardState } from '../../types/game';
import { LobbyState } from '../../types/lobby';

let harness: Harness;
const openClients: TestClient[] = [];

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
  await resetDatabase();
});

after(async () => {
  while (openClients.length) {
    openClients.pop()!.disconnect();
  }
  await harness.close();
  await closeDatabase();
});

async function client(name: string): Promise<TestClient> {
  const c = await connectClient(harness.url, name);
  openClients.push(c);
  return c;
}

/** Host creates a lobby; everyone else joins it. */
async function lobbyOf(names: string[], settings?: Record<string, unknown>) {
  const clients: TestClient[] = [];
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

  return { clients, host, code: created.lobby.code };
}

describe('lobby over the wire', () => {
  test('the host gets their lobby back with a code', async () => {
    const host = await client('Host');

    const created = await waitFor<{ lobby: LobbyState }>(host.socket, 'lobby:created', () =>
      host.socket.emit('lobby:create', { playerName: 'Host' })
    );

    assert.match(created.lobby.code, /^[A-Z0-9]{6}$/);
    assert.equal(created.lobby.hostPlayerId, host.playerId);
    assert.equal(created.lobby.playerCount, 1);
  });

  test('when B joins, A is told', async () => {
    const host = await client('A');
    const created = await waitFor<{ lobby: LobbyState }>(host.socket, 'lobby:created', () =>
      host.socket.emit('lobby:create', { playerName: 'A' })
    );

    const joiner = await client('B');
    const hostUpdate = waitFor<{ lobby: LobbyState }>(host.socket, 'lobby:update');
    joiner.socket.emit('lobby:join', { code: created.lobby.code, playerName: 'B' });

    const { lobby } = await hostUpdate;
    assert.equal(lobby.playerCount, 2);
    assert.deepEqual(lobby.players.map((p) => p.name).sort(), ['A', 'B']);
  });

  test('when C joins, both A and B are told the new state', async () => {
    const host = await client('A');
    const created = await waitFor<{ lobby: LobbyState }>(host.socket, 'lobby:created', () =>
      host.socket.emit('lobby:create', { playerName: 'A' })
    );
    const b = await client('B');
    await waitFor(b.socket, 'lobby:joined', () =>
      b.socket.emit('lobby:join', { code: created.lobby.code, playerName: 'B' })
    );
    await flush();

    const c = await client('C');
    const aUpdate = waitForMatching<{ lobby: LobbyState }>(
      host.socket,
      'lobby:update',
      (d) => d.lobby.playerCount === 3
    );
    const bUpdate = waitForMatching<{ lobby: LobbyState }>(
      b.socket,
      'lobby:update',
      (d) => d.lobby.playerCount === 3
    );
    c.socket.emit('lobby:join', { code: created.lobby.code, playerName: 'C' });

    const [fromA, fromB] = await Promise.all([aUpdate, bUpdate]);
    assert.deepEqual(fromA.lobby.players.map((p) => p.name).sort(), ['A', 'B', 'C']);
    assert.deepEqual(fromB.lobby.players.map((p) => p.name), fromA.lobby.players.map((p) => p.name));
  });

  test('a bad code comes back as a lobby error, not a crash', async () => {
    const player = await client('Lost');

    const error = await waitFor<{ message: string; code?: string }>(
      player.socket,
      'lobby:error',
      () => player.socket.emit('lobby:join', { code: 'ZZZZZZ', playerName: 'Lost' })
    );

    assert.match(error.message, /not found/i);
    assert.equal(error.code, 'LOBBY_NOT_FOUND');
  });

  test('a kicked player is told, and the rest see them go', async () => {
    const { clients, host } = await lobbyOf(['Host', 'Guest', 'Third']);
    const [, guest, third] = clients;

    const kicked = waitFor<{ message: string }>(guest.socket, 'lobby:kicked');
    const survivorUpdate = waitForMatching<{ lobby: LobbyState }>(
      third.socket,
      'lobby:update',
      (d) => d.lobby.playerCount === 2
    );

    host.socket.emit('lobby:kick-player', { playerId: guest.playerId });

    await kicked;
    const { lobby } = await survivorUpdate;
    assert.ok(!lobby.players.some((p) => p.playerId === guest.playerId));
  });

  test('a non-host kicking gets refused', async () => {
    const { clients } = await lobbyOf(['Host', 'Guest', 'Third']);
    const [, guest, third] = clients;

    const error = await waitFor<{ message: string; code?: string }>(
      guest.socket,
      'lobby:error',
      () => guest.socket.emit('lobby:kick-player', { playerId: third.playerId })
    );

    assert.match(error.message, /host/i);
    assert.equal(error.code, 'NOT_HOST');
  });

  test('leaving broadcasts the smaller lobby to whoever is left', async () => {
    const { clients, host } = await lobbyOf(['Host', 'Guest']);
    const [, guest] = clients;

    const update = waitForMatching<{ lobby: LobbyState }>(
      host.socket,
      'lobby:update',
      (d) => d.lobby.playerCount === 1
    );
    guest.socket.emit('lobby:leave');

    const { lobby } = await update;
    assert.equal(lobby.playerCount, 1);
  });

  test('adding a bot broadcasts the new table', async () => {
    const { clients, host } = await lobbyOf(['Host', 'Guest']);
    const [, guest] = clients;

    const update = waitForMatching<{ lobby: LobbyState }>(
      guest.socket,
      'lobby:update',
      (d) => d.lobby.playerCount === 3,
      () => host.socket.emit('lobby:add-bot')
    );

    const { lobby } = await update;
    assert.equal(lobby.players.filter((p) => p.isBot).length, 1);
    assert.equal(lobby.canStart, true);
  });

  test('settings changes reach every client', async () => {
    const { clients, host } = await lobbyOf(['Host', 'Guest']);
    const [, guest] = clients;

    const update = waitForMatching<{ lobby: LobbyState }>(
      guest.socket,
      'lobby:update',
      (d) => d.lobby.settings.rounds === 6,
      () => host.socket.emit('lobby:update-settings', { settings: { rounds: 6, scoringMode: '+1' } })
    );

    const { lobby } = await update;
    assert.equal(lobby.settings.rounds, 6);
    assert.equal(lobby.settings.scoringMode, '+1');
  });

  test('creating a second lobby while already in one is refused', async () => {
    const { host } = await lobbyOf(['Host', 'Guest']);

    const error = await waitFor<{ code?: string }>(host.socket, 'lobby:error', () =>
      host.socket.emit('lobby:create', { playerName: 'Host' })
    );

    assert.equal(error.code, 'ALREADY_IN_LOBBY');
  });
});

describe('starting a game over the wire', () => {
  test('every player is dealt their own hand and told the game began', async () => {
    const { clients, host } = await lobbyOf(['A', 'B', 'C', 'D'], { rounds: 4 });

    const starts = clients.map((c) =>
      waitFor<{ gameState: ClientGameState }>(c.socket, 'game:started')
    );
    host.socket.emit('lobby:start-game');
    const states = (await Promise.all(starts)).map((s) => s.gameState);

    for (const state of states) {
      assert.equal(state.status, 'BIDDING');
      assert.equal(state.currentRound, 1);
      assert.equal(state.myHand.length, 1);
      assert.equal(state.players.length, 4);
    }

    // Each player got a different card, and nobody was sent anyone else's.
    const hands = states.map((s) => `${s.myHand[0].rank}${s.myHand[0].suit}`);
    assert.equal(new Set(hands).size, 4, 'four distinct cards dealt');
  });

  test('exactly one player is on turn, and they know it', async () => {
    const { clients, host } = await lobbyOf(['A', 'B', 'C', 'D']);

    const starts = clients.map((c) =>
      waitFor<{ gameState: ClientGameState }>(c.socket, 'game:started')
    );
    host.socket.emit('lobby:start-game');
    const states = (await Promise.all(starts)).map((s) => s.gameState);

    assert.equal(states.filter((s) => s.isMyTurn).length, 1);
    const turnIds = new Set(states.map((s) => s.currentTurnPlayerId));
    assert.equal(turnIds.size, 1, 'everyone agrees whose turn it is');
  });

  test('a non-host cannot start the game', async () => {
    const { clients } = await lobbyOf(['A', 'B']);

    const error = await waitFor<{ code?: string }>(clients[1].socket, 'lobby:error', () =>
      clients[1].socket.emit('lobby:start-game')
    );

    assert.equal(error.code, 'NOT_HOST');
  });
});

/** Boots a four-human game and returns the clients plus the started states. */
async function startedGame(settings?: Record<string, unknown>) {
  const { clients, host } = await lobbyOf(['A', 'B', 'C', 'D'], { rounds: 4, ...settings });

  const starts = clients.map((c) =>
    waitFor<{ gameState: ClientGameState }>(c.socket, 'game:started')
  );
  host.socket.emit('lobby:start-game');
  const states = (await Promise.all(starts)).map((s) => s.gameState);

  return { clients, host, states };
}

/** The client whose turn it currently is, from the last state each client saw. */
function onTurn(clients: TestClient[], states: ClientGameState[]): TestClient {
  const turnId = states[0].currentTurnPlayerId;
  const found = clients.find((c) => c.playerId === turnId);
  if (!found) throw new Error('nobody at the table is on turn');
  return found;
}

describe('bidding over the wire', () => {
  test('a bid is broadcast to the whole table', async () => {
    const { clients, states } = await startedGame();
    const bidder = onTurn(clients, states);

    const updates = clients.map((c) =>
      waitForMatching<{ gameState: ClientGameState }>(
        c.socket,
        'game:update',
        (d) => d.gameState.roundState!.bids[bidder.playerId] !== undefined
      )
    );
    bidder.socket.emit('game:submit-bid', { bid: 1 });

    for (const { gameState } of await Promise.all(updates)) {
      assert.equal(gameState.roundState!.bids[bidder.playerId], 1);
      assert.equal(
        gameState.players.find((p) => p.id === bidder.playerId)?.hasBid,
        true
      );
    }
  });

  test('bidding out of turn is rejected and changes nothing', async () => {
    const { clients, states } = await startedGame();
    const bidder = onTurn(clients, states);
    const other = clients.find((c) => c.playerId !== bidder.playerId)!;

    const error = await waitFor<{ code?: string }>(other.socket, 'game:error', () =>
      other.socket.emit('game:submit-bid', { bid: 1 })
    );

    assert.equal(error.code, 'NOT_YOUR_TURN');
  });

  test('when the last bid lands, the table moves to playing', async () => {
    const { clients, states } = await startedGame();

    let current = states;
    for (let i = 0; i < 4; i++) {
      const bidder = onTurn(clients, current);
      const settled = clients.map((c) =>
        waitForMatching<{ gameState: ClientGameState }>(
          c.socket,
          'game:update',
          (d) => Object.keys(d.gameState.roundState!.bids).length === i + 1
        )
      );
      bidder.socket.emit('game:submit-bid', { bid: 0 });
      current = (await Promise.all(settled)).map((s) => s.gameState);
    }

    for (const state of current) {
      assert.equal(state.status, 'PLAYING');
      assert.equal(state.roundState?.trickNumber, 1);
    }
  });
});

/** Bids zero for everyone and returns the states once play has opened. */
async function bidZeroAll(clients: TestClient[], states: ClientGameState[]) {
  let current = states;
  for (let i = 0; i < clients.length; i++) {
    const bidder = onTurn(clients, current);
    const settled = clients.map((c) =>
      waitForMatching<{ gameState: ClientGameState }>(
        c.socket,
        'game:update',
        (d) => Object.keys(d.gameState.roundState!.bids).length === i + 1
      )
    );
    bidder.socket.emit('game:submit-bid', { bid: 0 });
    current = (await Promise.all(settled)).map((s) => s.gameState);
  }
  return current;
}

describe('playing a trick over the wire', () => {
  test('cards appear on every client, and the trick winner is announced once', async () => {
    const { clients, states } = await startedGame();
    let current = await bidZeroAll(clients, states);

    const announced = clients.map((c) =>
      waitFor<{ playerId: string; playerName: string; trickNumber: number }>(
        c.socket,
        'hand:winner-announced'
      )
    );

    for (let i = 0; i < 4; i++) {
      const player = onTurn(clients, current);
      const view = current.find((s) => s.isMyTurn)!;
      const card = view.myHand[0];

      const settled = clients.map((c) =>
        waitForMatching<{ gameState: ClientGameState }>(
          c.socket,
          'game:update',
          (d) => (d.gameState.roundState?.currentTrick?.cardsPlayed.length ?? 0) === i + 1
        )
      );
      player.socket.emit('game:play-card', { card });
      current = (await Promise.all(settled)).map((s) => s.gameState);

      assert.equal(
        current[0].roundState?.currentTrick?.cardsPlayed.length,
        i + 1,
        'the played card reached the table'
      );
    }

    const winners = await Promise.all(announced);
    const winnerIds = new Set(winners.map((w) => w.playerId));
    assert.equal(winnerIds.size, 1, 'everyone was told the same winner');
    assert.ok(clients.some((c) => c.playerId === [...winnerIds][0]));

    // The announcement is a one-off, not repeated per player action.
    await flush(100);
    for (const c of clients) {
      assert.equal(
        countReceived(c, 'hand:winner-announced'),
        1,
        `${c.name} received a duplicate winner announcement`
      );
    }
  });

  test('playing out of turn is rejected', async () => {
    const { clients, states } = await startedGame();
    const current = await bidZeroAll(clients, states);

    const turnHolder = onTurn(clients, current);
    const other = clients.find((c) => c.playerId !== turnHolder.playerId)!;
    const otherView = current[clients.indexOf(other)];

    const error = await waitFor<{ code?: string }>(other.socket, 'game:error', () =>
      other.socket.emit('game:play-card', { card: otherView.myHand[0] })
    );

    assert.equal(error.code, 'NOT_YOUR_TURN');
  });
});

describe('scoreboard and the next round over the wire', () => {
  test('finishing a round pushes a scoreboard, and Continue gates the next round', async () => {
    const { clients, states } = await startedGame();
    let current = await bidZeroAll(clients, states);

    const scoreboards = clients.map((c) =>
      waitFor<{ scoreboard: ScoreboardState }>(c.socket, 'scoreboard:state')
    );

    // Round 1 is a single trick, so playing it out ends the round.
    for (let i = 0; i < 4; i++) {
      const player = onTurn(clients, current);
      const view = current.find((s) => s.isMyTurn)!;
      const settled = clients.map((c) =>
        waitForMatching<{ gameState: ClientGameState }>(
          c.socket,
          'game:update',
          (d) => (d.gameState.roundState?.currentTrick?.cardsPlayed.length ?? 0) === i + 1
        )
      );
      player.socket.emit('game:play-card', { card: view.myHand[0] });
      current = (await Promise.all(settled)).map((s) => s.gameState);
    }

    const boards = (await Promise.all(scoreboards)).map((b) => b.scoreboard);
    for (const board of boards) {
      assert.equal(board.status, 'round_scoreboard');
      assert.equal(board.currentRound, 1);
      assert.equal(board.players.length, 4);
      assert.ok(board.rows[0].scores.every((s) => s.score !== null), 'round 1 is scored');
      // Bidding zero, three players make it and one takes the trick.
      assert.equal(board.players.filter((p) => p.totalScore === 10).length, 3);
    }

    // Three players continue: still parked.
    for (const c of clients.slice(0, 3)) {
      const seen = waitForMatching<{ scoreboard: ScoreboardState }>(
        c.socket,
        'scoreboard:state',
        (d) => d.scoreboard.players.some((p) => p.id === c.playerId && p.hasContinued),
        () => c.socket.emit('scoreboard:continue')
      );
      await seen;
    }
    await flush(80);
    for (const c of clients) {
      assert.equal(countReceived(c, 'scoreboard:all-continued'), 0, 'not everyone has continued');
      assert.equal(countReceived(c, 'round:bidding-started'), 0, 'round 2 has not started');
    }

    // The last player continues and round 2 opens for everyone.
    const nextRound = clients.map((c) =>
      waitFor<{ gameState: ClientGameState }>(c.socket, 'round:bidding-started')
    );
    clients[3].socket.emit('scoreboard:continue');
    const round2 = (await Promise.all(nextRound)).map((s) => s.gameState);

    for (const state of round2) {
      assert.equal(state.currentRound, 2);
      assert.equal(state.status, 'BIDDING');
      assert.equal(state.myHand.length, 2, 'two cards in round 2');
      assert.equal(state.roundState?.trump?.name, 'Chukat');
    }

    for (const c of clients) {
      assert.equal(countReceived(c, 'scoreboard:all-continued'), 1);
      assert.equal(countReceived(c, 'round:bidding-started'), 1, 'round 2 announced once');
    }
  });

  test('a client can ask for the scoreboard on demand', async () => {
    const { clients, states } = await startedGame();
    let current = await bidZeroAll(clients, states);

    for (let i = 0; i < 4; i++) {
      const player = onTurn(clients, current);
      const view = current.find((s) => s.isMyTurn)!;
      const settled = clients.map((c) =>
        waitForMatching<{ gameState: ClientGameState }>(
          c.socket,
          'game:update',
          (d) => (d.gameState.roundState?.currentTrick?.cardsPlayed.length ?? 0) === i + 1
        )
      );
      player.socket.emit('game:play-card', { card: view.myHand[0] });
      current = (await Promise.all(settled)).map((s) => s.gameState);
    }
    await flush(80);

    const board = await waitFor<{ scoreboard: ScoreboardState }>(
      clients[0].socket,
      'scoreboard:state',
      () => clients[0].socket.emit('scoreboard:get-state')
    );

    assert.equal(board.scoreboard.gameId, current[0].id);
    assert.equal(board.scoreboard.totalRounds, 4);
  });
});

describe('a whole game with bots, over the wire', () => {
  test('one human plus three bots plays to a final winner', async () => {
    // Bot "thinking time" is scaled to zero by the test runner, so the bots act
    // as fast as the server can process them - no sleeps, no racing.
    const host = await client('Solo');
    const created = await waitFor<{ lobby: LobbyState }>(host.socket, 'lobby:created', () =>
      host.socket.emit('lobby:create', { playerName: 'Solo', settings: { rounds: 4 } })
    );
    assert.ok(created.lobby.code);

    for (let i = 0; i < 3; i++) {
      await waitForMatching<{ lobby: LobbyState }>(
        host.socket,
        'lobby:update',
        (d) => d.lobby.playerCount === i + 2,
        () => host.socket.emit('lobby:add-bot')
      );
    }

    const started = await waitFor<{ gameState: ClientGameState }>(
      host.socket,
      'game:started',
      () => host.socket.emit('lobby:start-game')
    );
    assert.equal(started.gameState.players.length, 4);

    const finalWinner = waitFor<{
      winners: { id: string; name: string }[];
      winningScore: number;
      isTie: boolean;
      finalScores: Record<string, number>;
    }>(host.socket, 'game:final-winner', undefined, 60000);

    // Drive the human seat purely from events - no polling, no sleeps. Every
    // state push is examined; if it is our turn we act, and a signature guard
    // stops a repeated broadcast from making us act twice.
    const acted = new Set<string>();
    const act = (state: ClientGameState) => {
      if (!state.isMyTurn) return;
      const round = state.roundState;
      if (!round || round.awaitingNextHand) return;

      const signature = [
        state.currentRound,
        state.status,
        round.trickNumber,
        round.currentTrick?.cardsPlayed.length ?? 0,
        Object.keys(round.bids).length,
      ].join(':');
      if (acted.has(signature)) return;
      acted.add(signature);

      if (state.status === 'BIDDING') {
        // Zero unless the dealer constraint forbids it, in which case one is
        // the only value that always fits.
        const forbidden = round.isLastBidder
          ? round.cardsPerPlayer - round.totalBidsSoFar
          : null;
        host.socket.emit('game:submit-bid', { bid: forbidden === 0 ? 1 : 0 });
        return;
      }

      if (state.status === 'PLAYING' && state.myHand.length) {
        const leadSuit = round.currentTrick?.leadSuit;
        const legal =
          (leadSuit && state.myHand.find((c) => c.suit === leadSuit)) || state.myHand[0];
        host.socket.emit('game:play-card', { card: legal });
      }
    };

    // The server announces a new round on its own event, not as a game:update,
    // so both have to be listened to or the human seat stalls at the round that
    // it happens to open.
    host.socket.on('game:update', (d: { gameState: ClientGameState }) => act(d.gameState));
    host.socket.on('round:bidding-started', (d: { gameState: ClientGameState }) =>
      act(d.gameState)
    );

    // Continue as soon as a scoreboard shows up. Continuing is idempotent, so a
    // rebroadcast triggered by another player is harmless.
    const continued = new Set<number>();
    host.socket.on('scoreboard:state', (d: { scoreboard: ScoreboardState }) => {
      if (continued.has(d.scoreboard.currentRound)) return;
      continued.add(d.scoreboard.currentRound);
      host.socket.emit('scoreboard:continue');
    });

    // Kick things off from the state we already have.
    act(started.gameState);

    const result = await finalWinner;

    assert.ok(result.winners.length >= 1, 'a winner was declared');
    assert.equal(Object.keys(result.finalScores).length, 4);
    assert.equal(
      result.winningScore,
      Math.max(...Object.values(result.finalScores)),
      'the winner has the top score'
    );
    for (const winner of result.winners) {
      assert.equal(result.finalScores[winner.id], result.winningScore);
    }
  });
});

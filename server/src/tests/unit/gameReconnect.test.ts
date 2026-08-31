// The in-game disconnect grace period, bot takeover and rejoin decision:
// timing, cancellation and races.
//
// These run against an in-memory stand-in for lobbyService, so there is no
// database and no Socket.IO in the way and every ordering can be forced exactly.
// Timers are faked - nothing here waits 30 real seconds - and the
// database-and-sockets half (a real bot actually bidding and playing, private
// cards, cold start) is covered by tests/integration/gameDisconnect.test.ts.
//
// The property that matters most and is asserted throughout: a takeover changes
// the *controller* and nothing else. No seat moves, no player is removed, no
// substitute appears, and the same playerId keeps its hand, bid and score.

import test, { describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { GAME_DISCONNECT_GRACE_MS } from '../../config/constants';
import {
  GameReconnectHooks,
  GameReconnectService,
  GameReconnectStore,
  seatControl,
} from '../../services/gameReconnect.service';
import { DisconnectMark } from '../../services/lobby.service';
import { LobbyState, LobbyStatus } from '../../types/lobby';
import { LobbyMembership, LobbyPlayer } from '../../types/player';
import { canStartGame } from '../../utils/validateLobby';

const LOBBY_ID = 'lobby-1';
const LOBBY_CODE = 'ABC123';

interface Seat extends LobbyPlayer {
  sessionDiscarded: boolean;
}

/**
 * A lobby mid-game, in memory, exposing exactly the surface the reconnect service
 * uses. Each mutation mirrors the corresponding lobbyService write - including
 * its conditions, which is the whole point: the conditional claims are what
 * resolve the boundary races, so a fake that wrote unconditionally would prove
 * nothing.
 */
class FakeGameLobby implements GameReconnectStore {
  status: LobbyStatus = 'IN_GAME';
  exists = true;
  seats: Seat[] = [];
  generations = new Map<string, number>();

  seat(playerId: string, options: Partial<Seat> = {}): Seat {
    const player: Seat = {
      id: `lp-${playerId}`,
      playerId,
      name: playerId,
      isHost: this.seats.length === 0,
      isBot: false,
      seatPosition: this.seats.length,
      joinedAt: new Date(1_700_000_000_000 + this.seats.length * 1000),
      connected: true,
      disconnectedAt: null,
      reconnectDeadline: null,
      controlledByBot: false,
      sessionDiscarded: false,
      ...options,
    };
    // A bot seat is always bot-controlled, exactly as toLobbyState reports it.
    if (player.isBot) {
      player.controlledByBot = true;
    }
    this.seats.push(player);
    this.generations.set(playerId, 0);
    return player;
  }

  state(): LobbyState {
    const players = [...this.seats].sort((a, b) => a.seatPosition - b.seatPosition);
    return {
      id: LOBBY_ID,
      code: LOBBY_CODE,
      hostPlayerId: players.find(p => p.isHost)?.playerId ?? '',
      hostName: players.find(p => p.isHost)?.name ?? '',
      status: this.status,
      settings: { rounds: 4, orderMode: 'Kachuful', scoringMode: '+10', maxPlayers: 8 },
      players,
      playerCount: players.length,
      canStart: canStartGame(players.length, this.status).canStart,
    };
  }

  find(playerId: string): Seat | undefined {
    return this.seats.find(p => p.playerId === playerId);
  }

  generation(playerId: string): number {
    return this.generations.get(playerId) ?? 0;
  }

  private bump(playerId: string): void {
    this.generations.set(playerId, this.generation(playerId) + 1);
  }

  async markGamePlayerDisconnected(
    lobbyId: string,
    playerId: string,
    graceMs: number
  ): Promise<DisconnectMark | null> {
    const seat = this.find(playerId);
    if (
      lobbyId !== LOBBY_ID ||
      !this.exists ||
      !seat ||
      seat.isBot ||
      this.status !== 'IN_GAME' ||
      !seat.connected
    ) {
      return null;
    }

    const disconnectedAt = new Date();
    const reconnectDeadline = new Date(disconnectedAt.getTime() + graceMs);
    seat.connected = false;
    seat.disconnectedAt = disconnectedAt;
    seat.reconnectDeadline = reconnectDeadline;
    this.bump(playerId);

    return {
      lobby: this.state(),
      generation: this.generation(playerId),
      disconnectedAt,
      reconnectDeadline,
    };
  }

  async reclaimSeatFromGrace(
    lobbyId: string,
    playerId: string
  ): Promise<{ lobby: LobbyState | null; changed: boolean }> {
    const seat = this.find(playerId);
    if (lobbyId !== LOBBY_ID || !this.exists || !seat) {
      return { lobby: null, changed: false };
    }
    // The same condition the SQL carries: only while still absent and not taken
    // over.
    if (seat.connected || seat.controlledByBot) {
      return { lobby: this.state(), changed: false };
    }

    seat.connected = true;
    seat.disconnectedAt = null;
    seat.reconnectDeadline = null;
    this.bump(playerId);

    return { lobby: this.state(), changed: true };
  }

  async claimSeatForBot(
    lobbyId: string,
    playerId: string,
    expectedGeneration: number
  ): Promise<{ lobby: LobbyState | null; changed: boolean }> {
    const seat = this.find(playerId);
    if (lobbyId !== LOBBY_ID || !this.exists || !seat) {
      return { lobby: null, changed: false };
    }
    if (
      seat.connected ||
      seat.controlledByBot ||
      this.generation(playerId) !== expectedGeneration
    ) {
      return { lobby: this.state(), changed: false };
    }

    seat.controlledByBot = true;
    return { lobby: this.state(), changed: true };
  }

  async markGamePlayerRejoined(
    lobbyId: string,
    playerId: string
  ): Promise<{ lobby: LobbyState | null; changed: boolean }> {
    const seat = this.find(playerId);
    if (lobbyId !== LOBBY_ID || !this.exists || !seat) {
      return { lobby: null, changed: false };
    }
    if (seat.connected && !seat.controlledByBot && !seat.sessionDiscarded) {
      return { lobby: this.state(), changed: false };
    }

    seat.connected = true;
    seat.disconnectedAt = null;
    seat.reconnectDeadline = null;
    seat.controlledByBot = false;
    seat.sessionDiscarded = false;
    this.bump(playerId);

    return { lobby: this.state(), changed: true };
  }

  async markSessionDiscarded(
    lobbyId: string,
    playerId: string
  ): Promise<{ lobby: LobbyState | null; changed: boolean }> {
    const seat = this.find(playerId);
    if (lobbyId !== LOBBY_ID || !this.exists || !seat || seat.isBot) {
      return { lobby: null, changed: false };
    }
    if (seat.sessionDiscarded && seat.controlledByBot && !seat.connected) {
      return { lobby: this.state(), changed: false };
    }

    seat.sessionDiscarded = true;
    seat.controlledByBot = true;
    seat.connected = false;
    seat.disconnectedAt = seat.disconnectedAt ?? new Date();
    seat.reconnectDeadline = null;
    this.bump(playerId);

    return { lobby: this.state(), changed: true };
  }

  async getMembership(lobbyId: string, playerId: string): Promise<LobbyMembership | null> {
    const seat = this.find(playerId);
    if (lobbyId !== LOBBY_ID || !this.exists || !seat) {
      return null;
    }
    return {
      lobbyId: LOBBY_ID,
      lobbyCode: LOBBY_CODE,
      lobbyStatus: this.status,
      playerId,
      isBot: seat.isBot,
      isHost: seat.isHost,
      connected: seat.connected,
      disconnectedAt: seat.disconnectedAt,
      reconnectDeadline: seat.reconnectDeadline,
      disconnectGeneration: this.generation(playerId),
      controlledByBot: seat.controlledByBot,
      sessionDiscarded: seat.sessionDiscarded,
    };
  }

  async getPendingGameDisconnects(): Promise<LobbyMembership[]> {
    if (!this.exists || this.status !== 'IN_GAME') {
      return [];
    }
    const pending: LobbyMembership[] = [];
    for (const seat of this.seats) {
      if (seat.connected || seat.isBot || seat.controlledByBot) continue;
      pending.push((await this.getMembership(LOBBY_ID, seat.playerId))!);
    }
    return pending;
  }

  /** Removes a seat, as an explicit leave from a finished game would. */
  remove(playerId: string): void {
    this.seats = this.seats.filter(p => p.playerId !== playerId);
    this.generations.delete(playerId);
  }
}

/** Records what the table would have been told, and who is "live". */
class FakeHooks implements GameReconnectHooks {
  live = new Set<string>();
  disconnected: { playerId: string; deadline: Date; connected: boolean }[] = [];
  takenOver: { playerId: string; controlledByBot: boolean; playerCount: number }[] = [];
  reconnected: { playerId: string; connected: boolean; controlledByBot: boolean }[] = [];
  rejoined: { playerId: string; connected: boolean; controlledByBot: boolean }[] = [];
  discarded: { playerId: string; controlledByBot: boolean }[] = [];

  async hasLiveSocket(
    _lobbyCode: string,
    playerId: string,
    excludeSocketId?: string | null
  ): Promise<boolean> {
    // The fake models "a socket other than the excluded one": a player is only
    // reported live when explicitly marked so by the test.
    void excludeSocketId;
    return this.live.has(playerId);
  }

  onDisconnected(lobby: LobbyState, player: LobbyPlayer, reconnectDeadline: Date): void {
    this.disconnected.push({
      playerId: player.playerId,
      deadline: reconnectDeadline,
      connected: lobby.players.find(p => p.playerId === player.playerId)!.connected,
    });
  }

  onBotTakeover(lobby: LobbyState, player: LobbyPlayer): void {
    this.takenOver.push({
      playerId: player.playerId,
      controlledByBot: player.controlledByBot,
      playerCount: lobby.playerCount,
    });
  }

  onReconnected(_lobby: LobbyState, player: LobbyPlayer): void {
    this.reconnected.push({
      playerId: player.playerId,
      connected: player.connected,
      controlledByBot: player.controlledByBot,
    });
  }

  onRejoined(_lobby: LobbyState, player: LobbyPlayer): void {
    this.rejoined.push({
      playerId: player.playerId,
      connected: player.connected,
      controlledByBot: player.controlledByBot,
    });
  }

  onDiscarded(_lobby: LobbyState, player: LobbyPlayer): void {
    this.discarded.push({
      playerId: player.playerId,
      controlledByBot: player.controlledByBot,
    });
  }
}

let table: FakeGameLobby;
let hooks: FakeHooks;
let service: GameReconnectService;

/** Lets the async work kicked off by a fired timer finish. */
async function settle(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

/** Drops a player exactly as an unexpected socket close would. */
async function drop(playerId: string, socketId = `socket-${playerId}`) {
  return service.startGracePeriod(table.state(), playerId, socketId);
}

/** Brings a player back exactly as restoreSession would. */
async function comeBack(playerId: string) {
  return service.restorePlayer(table.state(), playerId);
}

/** Runs the grace period out, so the bot takes the seat. */
async function elapse(): Promise<void> {
  mock.timers.tick(service.gracePeriodMs + 1);
  await settle();
}

beforeEach(() => {
  // Only setTimeout is faked, so the microtask/setImmediate plumbing the async
  // store relies on still works normally.
  mock.timers.enable({ apis: ['setTimeout'] });

  table = new FakeGameLobby();
  hooks = new FakeHooks();
  service = new GameReconnectService(table);
  service.attach(hooks);

  table.seat('Om');
  table.seat('Yukta');
  table.seat('Raj');
  table.seat('Neha');
});

afterEach(() => {
  service.cancelAll();
  mock.timers.reset();
});

// ---------------------------------------------------------------------------
// Dropping out
// ---------------------------------------------------------------------------

describe('dropping out mid-game', () => {
  test('the grace period is thirty seconds by default', () => {
    assert.equal(GAME_DISCONNECT_GRACE_MS, 30_000);
    assert.equal(service.gracePeriodMs, 30_000);
  });

  test('the player is only marked disconnected - nothing is taken away', async () => {
    const seatsBefore = table.state().players.map(p => p.seatPosition);

    const lobby = await drop('Om');

    assert.ok(lobby, 'a grace period was started');
    assert.equal(lobby.playerCount, 4, 'still four players at the table');

    const om = lobby.players.find(p => p.playerId === 'Om')!;
    assert.equal(om.connected, false);
    assert.equal(om.controlledByBot, false, 'no bot yet - the grace period is running');
    assert.equal(om.seatPosition, 0, 'seat preserved');
    assert.equal(om.isHost, true, 'host status preserved');
    assert.ok(om.disconnectedAt, 'disconnectedAt recorded');
    assert.equal(
      om.reconnectDeadline!.getTime() - om.disconnectedAt!.getTime(),
      service.gracePeriodMs
    );

    assert.deepEqual(
      lobby.players.map(p => p.seatPosition),
      seatsBefore,
      'nobody else moved'
    );
    assert.equal(service.isPending(LOBBY_ID, 'Om'), true, 'a takeover is scheduled');
    assert.equal(hooks.disconnected.length, 1, 'the table was told once');
    assert.equal(hooks.takenOver.length, 0);
  });

  test('the seat state reads as RECONNECTING', async () => {
    await drop('Om');
    const membership = (await table.getMembership(LOBBY_ID, 'Om'))!;
    assert.equal(seatControl(membership), 'RECONNECTING');
  });

  test('is never started for a bot', async () => {
    table.seat('Judge', { isBot: true });

    const result = await drop('Judge');

    assert.equal(result, null);
    assert.equal(service.pendingCount(), 0, 'no timer for a bot');
    assert.equal(table.find('Judge')!.connected, true);
    assert.equal(hooks.disconnected.length, 0);
  });

  test('is not started twice for one drop, so timers cannot pile up', async () => {
    await drop('Om');
    const again = await drop('Om');

    assert.equal(again, null, 'the second call is a no-op');
    assert.equal(service.pendingCount(), 1);
    assert.equal(hooks.disconnected.length, 1);
  });

  test('is not started while the lobby is still waiting', async () => {
    // A waiting lobby is the other service's business entirely.
    table.status = 'WAITING';

    const result = await drop('Om');

    assert.equal(result, null);
    assert.equal(service.pendingCount(), 0);
  });

  test('a late disconnect for a socket the player already replaced is ignored', async () => {
    hooks.live.add('Om');

    const result = await drop('Om', 'socket-old');

    assert.equal(result, null);
    assert.equal(service.pendingCount(), 0, 'no countdown started');
    assert.equal(table.find('Om')!.connected, true);
    assert.equal(hooks.disconnected.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Coming back inside the grace period
// ---------------------------------------------------------------------------

describe('reconnecting inside the grace period', () => {
  test('is restored on the spot, with no bot and no prompt', async () => {
    await drop('Om');

    mock.timers.tick(service.gracePeriodMs - 1_000);
    const outcome = await comeBack('Om');

    assert.equal(outcome.mode, 'RESTORED');
    assert.equal(service.isPending(LOBBY_ID, 'Om'), false, 'takeover cancelled');
    assert.equal(service.pendingCount(), 0);

    const lobby = (outcome as { lobby: LobbyState }).lobby;
    assert.equal(lobby.playerCount, 4);
    assert.equal(
      lobby.players.filter(p => p.playerId === 'Om').length,
      1,
      'exactly one Om - no duplicate player'
    );

    const om = lobby.players.find(p => p.playerId === 'Om')!;
    assert.equal(om.connected, true);
    assert.equal(om.controlledByBot, false);
    assert.equal(om.seatPosition, 0, 'same seat');
    assert.equal(om.isHost, true, 'still host');
    assert.equal(om.reconnectDeadline, null, 'deadline cleared');

    assert.deepEqual(hooks.reconnected, [
      { playerId: 'Om', connected: true, controlledByBot: false },
    ]);
    assert.equal(hooks.takenOver.length, 0, 'the bot never got involved');
  });

  test('the seat is not handed over a millisecond early', async () => {
    await drop('Om');

    mock.timers.tick(service.gracePeriodMs - 1);
    await settle();

    assert.equal(table.find('Om')!.controlledByBot, false);
    assert.equal(hooks.takenOver.length, 0);
  });

  test('an ordinary first connect is not reported as a reconnect', async () => {
    const outcome = await comeBack('Yukta');

    assert.equal(outcome.mode, 'NONE');
    assert.equal(hooks.reconnected.length, 0, 'nothing broadcast');
  });

  test('a stale timer firing afterwards cannot hand the seat to the bot', async () => {
    await drop('Om');

    // Back at 29 of the 30 seconds.
    mock.timers.tick(29_000);
    await comeBack('Om');

    // The original timer's moment arrives anyway.
    mock.timers.tick(5_000);
    await settle();

    assert.equal(table.find('Om')!.controlledByBot, false, 'Om still plays for himself');
    assert.equal(table.find('Om')!.connected, true);
    assert.equal(hooks.takenOver.length, 0);
  });

  test('a stale timer is refused even if the cancellation is lost', async () => {
    await drop('Om');
    const stale = service.pendingTakeover(LOBBY_ID, 'Om')!;
    await comeBack('Om');

    // Invoke the takeover directly with the generation the dead timer captured,
    // as if clearTimeout had not taken effect.
    await service.takeOverWithBot(LOBBY_ID, LOBBY_CODE, 'Om', stale.generation);

    assert.equal(table.find('Om')!.controlledByBot, false);
    assert.equal(hooks.takenOver.length, 0);
  });

  test('a live socket beats a stale disconnected row rather than losing the seat', async () => {
    await drop('Om');

    // The row still says absent, but a socket of theirs is in the room.
    hooks.live.add('Om');

    await elapse();

    assert.equal(table.find('Om')!.controlledByBot, false, 'not handed over');
    assert.equal(table.find('Om')!.connected, true, 'the row was repaired');
    assert.equal(hooks.reconnected.length, 1, 'the table was told they are back');
  });

  test('reconnecting twice in a row leaves nothing armed', async () => {
    await drop('Om');
    await comeBack('Om');
    await drop('Om');
    await comeBack('Om');

    mock.timers.tick(service.gracePeriodMs * 3);
    await settle();

    assert.equal(table.find('Om')!.controlledByBot, false);
    assert.equal(service.pendingCount(), 0, 'no timers left behind');
    assert.equal(hooks.takenOver.length, 0);
  });

  test('two sockets racing to restore the same session restore it once', async () => {
    await drop('Om');

    const [first, second] = await Promise.all([comeBack('Om'), comeBack('Om')]);

    const modes = [first.mode, second.mode].sort();
    assert.deepEqual(modes, ['NONE', 'RESTORED'], 'one restores, the other no-ops');
    assert.equal(hooks.reconnected.length, 1, 'announced exactly once');
    assert.equal(table.find('Om')!.connected, true);
  });
});

// ---------------------------------------------------------------------------
// Bot takeover
// ---------------------------------------------------------------------------

describe('bot takeover', () => {
  test('hands the seat over when nobody comes back, changing only the controller', async () => {
    const before = table.state().players.find(p => p.playerId === 'Om')!;
    await drop('Om');

    await elapse();

    const om = table.find('Om')!;
    assert.equal(om.controlledByBot, true, 'the bot is playing the seat');
    assert.equal(om.connected, false, 'the human is still away');
    assert.equal(om.playerId, before.playerId, 'the same player, not a substitute');
    assert.equal(om.name, before.name, 'name unchanged');
    assert.equal(om.seatPosition, before.seatPosition, 'seat unchanged');
    assert.equal(om.isHost, before.isHost, 'host status unchanged');
    assert.equal(table.state().playerCount, 4, 'nobody was removed and nobody was added');

    assert.deepEqual(hooks.takenOver, [
      { playerId: 'Om', controlledByBot: true, playerCount: 4 },
    ]);
    assert.equal(service.isPending(LOBBY_ID, 'Om'), false, 'tracking cleaned up');
    assert.equal(service.pendingCount(), 0);
  });

  test('the seat state reads as BOT_TAKEOVER', async () => {
    await drop('Om');
    await elapse();

    const membership = (await table.getMembership(LOBBY_ID, 'Om'))!;
    assert.equal(seatControl(membership), 'BOT_TAKEOVER');
  });

  test('is not announced twice if the takeover runs again', async () => {
    await drop('Om');
    const generation = service.pendingTakeover(LOBBY_ID, 'Om')!.generation;
    await elapse();

    await service.takeOverWithBot(LOBBY_ID, LOBBY_CODE, 'Om', generation);

    assert.equal(hooks.takenOver.length, 1, 'still only one takeover');
  });

  test('does not happen once the game is over', async () => {
    await drop('Om');
    // The game finished while they were away; the lobby moves off IN_GAME.
    table.status = 'COMPLETED';

    await elapse();

    assert.equal(table.find('Om')!.controlledByBot, false, 'nothing left to play');
    assert.equal(hooks.takenOver.length, 0);
  });

  test('does not happen for a player who is no longer in the lobby', async () => {
    await drop('Yukta');
    table.remove('Yukta');

    await elapse();

    assert.equal(hooks.takenOver.length, 0);
  });

  test('leaves the bots at the table alone', async () => {
    table.seat('Judge', { isBot: true });

    await drop('Om');
    await elapse();

    const judge = table.find('Judge')!;
    assert.equal(judge.connected, true);
    assert.equal(judge.reconnectDeadline, null);
    assert.deepEqual(hooks.takenOver.map(t => t.playerId), ['Om']);
  });
});

// ---------------------------------------------------------------------------
// Coming back after a takeover
// ---------------------------------------------------------------------------

describe('coming back after the bot has taken over', () => {
  test('is offered a choice rather than being put straight back', async () => {
    await drop('Om');
    await elapse();

    const outcome = await comeBack('Om');

    assert.equal(outcome.mode, 'REJOIN_AVAILABLE');
    // Nothing changed: the bot is still playing until they actually say yes.
    assert.equal(table.find('Om')!.controlledByBot, true);
    assert.equal(table.find('Om')!.connected, false);
    assert.equal(hooks.reconnected.length, 0, 'not announced as a reconnect');
    assert.equal(hooks.rejoined.length, 0);
  });

  test('offering the choice repeatedly does not change anything', async () => {
    await drop('Om');
    await elapse();

    assert.equal((await comeBack('Om')).mode, 'REJOIN_AVAILABLE');
    assert.equal((await comeBack('Om')).mode, 'REJOIN_AVAILABLE');

    assert.equal(table.find('Om')!.controlledByBot, true);
    assert.equal(hooks.rejoined.length, 0);
  });

  test('REJOIN takes the bot off the seat and gives control back', async () => {
    await drop('Om');
    await elapse();

    const lobby = await service.rejoin(table.state(), 'Om');

    assert.ok(lobby);
    const om = lobby.players.find(p => p.playerId === 'Om')!;
    assert.equal(om.controlledByBot, false, 'the bot is off the seat');
    assert.equal(om.connected, true);
    assert.equal(om.seatPosition, 0, 'same seat');
    assert.equal(om.reconnectDeadline, null);
    assert.equal(lobby.playerCount, 4, 'no duplicate player');
    assert.deepEqual(hooks.rejoined, [
      { playerId: 'Om', connected: true, controlledByBot: false },
    ]);
    assert.equal(service.pendingCount(), 0, 'nothing left armed');
  });

  test('rejoining twice is announced once', async () => {
    await drop('Om');
    await elapse();

    await service.rejoin(table.state(), 'Om');
    await service.rejoin(table.state(), 'Om');

    assert.equal(hooks.rejoined.length, 1);
    assert.equal(table.find('Om')!.controlledByBot, false);
  });

  test('after rejoining, a later drop starts a fresh grace period', async () => {
    await drop('Om');
    await elapse();
    await service.rejoin(table.state(), 'Om');

    const again = await drop('Om');

    assert.ok(again, 'a new grace period, not a refused duplicate');
    assert.equal(again.players.find(p => p.playerId === 'Om')!.controlledByBot, false);
    assert.equal(service.isPending(LOBBY_ID, 'Om'), true);
  });

  test('DISCARD leaves the bot playing and the game running for everyone else', async () => {
    await drop('Om');
    await elapse();

    const lobby = await service.discard(table.state(), 'Om');

    assert.ok(lobby);
    assert.equal(lobby.playerCount, 4, 'the game still has four seats');

    const om = lobby.players.find(p => p.playerId === 'Om')!;
    assert.equal(om.controlledByBot, true, 'the bot keeps the seat');
    assert.equal(table.find('Om')!.sessionDiscarded, true);

    // Everyone else is untouched.
    for (const other of ['Yukta', 'Raj', 'Neha']) {
      assert.equal(table.find(other)!.connected, true, `${other} unaffected`);
      assert.equal(table.find(other)!.controlledByBot, false);
    }
    assert.deepEqual(hooks.discarded, [{ playerId: 'Om', controlledByBot: true }]);
  });

  test('a discarded player is not offered the game again', async () => {
    await drop('Om');
    await elapse();
    await service.discard(table.state(), 'Om');

    const outcome = await comeBack('Om');

    assert.equal(outcome.mode, 'DISCARDED');
    const membership = (await table.getMembership(LOBBY_ID, 'Om'))!;
    assert.equal(seatControl(membership), 'DISCARDED');
  });

  test('discarding from inside the grace period still leaves the bot driving', async () => {
    // They killed the app, reopened it and said no before the 30s were up. The
    // seat must not be left with nobody playing it.
    await drop('Om');
    mock.timers.tick(5_000);

    await service.discard(table.state(), 'Om');

    assert.equal(table.find('Om')!.controlledByBot, true);
    assert.equal(service.pendingCount(), 0, 'the countdown was dropped');

    // And the timer that would have fired changes nothing.
    await elapse();
    assert.equal(hooks.takenOver.length, 0, 'no second handover');
  });

  test('a player who changes their mind can still rejoin after discarding', async () => {
    await drop('Om');
    await elapse();
    await service.discard(table.state(), 'Om');

    const lobby = await service.rejoin(table.state(), 'Om');

    assert.ok(lobby);
    assert.equal(table.find('Om')!.controlledByBot, false);
    assert.equal(table.find('Om')!.sessionDiscarded, false);
  });
});

// ---------------------------------------------------------------------------
// The boundary race, forced
// ---------------------------------------------------------------------------

describe('a reconnect landing exactly on the boundary', () => {
  test('either the human or the bot gets the seat, never both', async () => {
    await drop('Om');
    const generation = service.pendingTakeover(LOBBY_ID, 'Om')!.generation;

    // Both halves of the race, started together: the timer's takeover and the
    // returning socket's restore.
    const [, outcome] = await Promise.all([
      service.takeOverWithBot(LOBBY_ID, LOBBY_CODE, 'Om', generation),
      comeBack('Om'),
    ]);

    const om = table.find('Om')!;
    assert.equal(
      om.connected && om.controlledByBot,
      false,
      'never present AND bot-controlled at once'
    );

    if (outcome.mode === 'RESTORED') {
      assert.equal(om.connected, true);
      assert.equal(om.controlledByBot, false);
      assert.equal(hooks.takenOver.length, 0, 'the takeover stood down');
    } else {
      assert.equal(outcome.mode, 'REJOIN_AVAILABLE', 'otherwise they are asked');
      assert.equal(om.controlledByBot, true);
      assert.equal(hooks.reconnected.length, 0, 'not silently restored');
    }
  });

  test('a takeover that loses the race announces nothing', async () => {
    await drop('Om');
    const generation = service.pendingTakeover(LOBBY_ID, 'Om')!.generation;

    // The reconnect gets there first...
    await comeBack('Om');
    // ...and the takeover, already in flight, arrives second.
    await service.takeOverWithBot(LOBBY_ID, LOBBY_CODE, 'Om', generation);

    assert.equal(hooks.takenOver.length, 0);
    assert.equal(table.find('Om')!.controlledByBot, false);
  });
});

// ---------------------------------------------------------------------------
// Several players away at once
// ---------------------------------------------------------------------------

describe('more than one player away at a time', () => {
  test('each has an independent countdown', async () => {
    await drop('Om');
    mock.timers.tick(10_000);
    await drop('Yukta');

    assert.equal(service.pendingCount(), 2, 'a countdown each');
    assert.notEqual(
      service.pendingTakeover(LOBBY_ID, 'Om')!.generation,
      undefined,
      'Om has his own timer'
    );
    assert.ok(service.pendingTakeover(LOBBY_ID, 'Yukta'), 'and Yukta has hers');

    // Om's window runs out first; Yukta still has ten seconds.
    mock.timers.tick(20_001);
    await settle();
    assert.equal(table.find('Om')!.controlledByBot, true);
    assert.equal(table.find('Yukta')!.controlledByBot, false, 'not swept up with Om');

    mock.timers.tick(10_000);
    await settle();
    assert.equal(table.find('Yukta')!.controlledByBot, true);
  });

  test('one reconnecting does not affect the other', async () => {
    await drop('Om');
    await drop('Yukta');

    await comeBack('Om');

    assert.equal(table.find('Om')!.connected, true);
    assert.equal(service.isPending(LOBBY_ID, 'Om'), false);
    assert.equal(table.find('Yukta')!.connected, false, "Yukta's state untouched");
    assert.equal(service.isPending(LOBBY_ID, 'Yukta'), true, "Yukta's timer untouched");

    await elapse();
    assert.equal(table.find('Om')!.controlledByBot, false);
    assert.equal(table.find('Yukta')!.controlledByBot, true);
  });

  test('one rejoining does not take the bot off the other seat', async () => {
    await drop('Om');
    await drop('Yukta');
    await elapse();

    await service.rejoin(table.state(), 'Om');

    assert.equal(table.find('Om')!.controlledByBot, false);
    assert.equal(table.find('Yukta')!.controlledByBot, true);
  });

  test('one discarding does not affect the other', async () => {
    await drop('Om');
    await drop('Yukta');
    await elapse();

    await service.discard(table.state(), 'Om');

    assert.equal(table.find('Om')!.sessionDiscarded, true);
    assert.equal(table.find('Yukta')!.sessionDiscarded, false);
    assert.equal((await comeBack('Yukta')).mode, 'REJOIN_AVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Cancelling for other reasons
// ---------------------------------------------------------------------------

describe('cancelling a countdown for other reasons', () => {
  test('cancelGracePeriod stops the takeover entirely', async () => {
    await drop('Yukta');

    service.cancelGracePeriod(LOBBY_ID, 'Yukta');
    await elapse();

    assert.equal(service.pendingCount(), 0);
    assert.equal(table.find('Yukta')!.controlledByBot, false, 'the timer never fired');
  });

  test('the game ending drops every countdown in the lobby', async () => {
    await drop('Yukta');
    await drop('Raj');
    assert.equal(service.pendingCount(), 2);

    service.cancelLobby(LOBBY_ID);
    await elapse();

    assert.equal(service.pendingCount(), 0);
    assert.equal(hooks.takenOver.length, 0);
  });

  test('cancelAll leaves nothing armed', async () => {
    await drop('Om');
    await drop('Yukta');

    service.cancelAll();
    await elapse();

    assert.equal(service.pendingCount(), 0);
    assert.equal(hooks.takenOver.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Surviving a server restart
// ---------------------------------------------------------------------------

describe('surviving a server restart', () => {
  test('a deadline still in the future is picked back up', async () => {
    // An absent seat written by the previous process: no timer exists for it.
    const seat = table.find('Om')!;
    seat.connected = false;
    seat.disconnectedAt = new Date();
    seat.reconnectDeadline = new Date(Date.now() + 20_000);
    table.generations.set('Om', 1);

    const resumed = await service.recoverPendingTakeovers();

    assert.equal(resumed, 1);
    assert.equal(service.isPending(LOBBY_ID, 'Om'), true);

    mock.timers.tick(19_000);
    await settle();
    assert.equal(table.find('Om')!.controlledByBot, false, 'not before the deadline');

    mock.timers.tick(2_000);
    await settle();
    assert.equal(table.find('Om')!.controlledByBot, true, 'handed over at the deadline');
  });

  test('a deadline that passed while the process was down is settled at once', async () => {
    const seat = table.find('Yukta')!;
    seat.connected = false;
    seat.disconnectedAt = new Date(Date.now() - 60_000);
    seat.reconnectDeadline = new Date(Date.now() - 30_000);
    table.generations.set('Yukta', 1);

    const resumed = await service.recoverPendingTakeovers();

    assert.equal(resumed, 1);
    assert.equal(table.find('Yukta')!.controlledByBot, true);
    assert.equal(service.pendingCount(), 0, 'no timer left armed');
  });

  test('seats already handed to the bot are not counted again', async () => {
    await drop('Om');
    await elapse();

    const resumed = await service.recoverPendingTakeovers();

    assert.equal(resumed, 0, 'nothing left pending - the handover already happened');
    assert.equal(hooks.takenOver.length, 1);
  });

  test('connected players and bots are not swept up', async () => {
    table.seat('Judge', { isBot: true });

    const resumed = await service.recoverPendingTakeovers();

    assert.equal(resumed, 0);
    assert.equal(service.pendingCount(), 0);
  });
});

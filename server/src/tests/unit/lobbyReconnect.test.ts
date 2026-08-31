// The waiting-room disconnect grace period: timing, cancellation and races.
//
// These run against an in-memory stand-in for lobbyService, so there is no
// database and no Socket.IO in the way and every ordering can be forced
// exactly. Timers are faked - nothing here waits 30 real seconds - and the
// database-backed half (host transfer, capacity, real broadcasts) is covered by
// tests/integration/lobbyDisconnect.test.ts.

import test, { describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { LOBBY_DISCONNECT_GRACE_MS } from '../../config/constants';
import {
  LobbyReconnectHooks,
  LobbyReconnectService,
  LobbyReconnectStore,
} from '../../services/lobbyReconnect.service';
import { countDisconnectedHumans, DisconnectMark } from '../../services/lobby.service';
import { LobbyState, LobbyStatus } from '../../types/lobby';
import { LobbyMembership, LobbyPlayer } from '../../types/player';
import { canStartGame } from '../../utils/validateLobby';

const LOBBY_ID = 'lobby-1';
const LOBBY_CODE = 'ABC123';

/**
 * A lobby in memory, exposing exactly the surface the reconnect service uses.
 * Mutations are the same ones lobbyService performs against Postgres.
 */
class FakeLobbies implements LobbyReconnectStore {
  status: LobbyStatus = 'WAITING';
  exists = true;
  seats: LobbyPlayer[] = [];
  generations = new Map<string, number>();
  /** Players actually removed, in order. */
  removed: string[] = [];

  seat(playerId: string, options: Partial<LobbyPlayer> = {}): LobbyPlayer {
    const player: LobbyPlayer = {
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
      ...options,
    };
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
      canStart: canStartGame(players.length, this.status, countDisconnectedHumans(players))
        .canStart,
    };
  }

  find(playerId: string): LobbyPlayer | undefined {
    return this.seats.find(p => p.playerId === playerId);
  }

  generation(playerId: string): number {
    return this.generations.get(playerId) ?? 0;
  }

  async markPlayerDisconnected(
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
      this.status !== 'WAITING' ||
      !seat.connected
    ) {
      return null;
    }

    const disconnectedAt = new Date();
    const reconnectDeadline = new Date(disconnectedAt.getTime() + graceMs);
    seat.connected = false;
    seat.disconnectedAt = disconnectedAt;
    seat.reconnectDeadline = reconnectDeadline;
    const generation = this.generation(playerId) + 1;
    this.generations.set(playerId, generation);

    return { lobby: this.state(), generation, disconnectedAt, reconnectDeadline };
  }

  async markPlayerConnected(
    lobbyId: string,
    playerId: string
  ): Promise<{ lobby: LobbyState | null; changed: boolean }> {
    const seat = this.find(playerId);
    if (lobbyId !== LOBBY_ID || !this.exists || !seat) {
      return { lobby: null, changed: false };
    }
    if (seat.connected) {
      return { lobby: this.state(), changed: false };
    }

    seat.connected = true;
    seat.disconnectedAt = null;
    seat.reconnectDeadline = null;
    this.generations.set(playerId, this.generation(playerId) + 1);

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
      // The waiting room never hands a seat to a bot - that is the in-game grace
      // period's business (see gameReconnect.test.ts).
      controlledByBot: seat.controlledByBot,
      sessionDiscarded: false,
    };
  }

  async getPendingReconnects(): Promise<LobbyMembership[]> {
    if (!this.exists || this.status !== 'WAITING') {
      return [];
    }
    const pending: LobbyMembership[] = [];
    for (const seat of this.seats) {
      if (seat.connected || seat.isBot) continue;
      pending.push((await this.getMembership(LOBBY_ID, seat.playerId))!);
    }
    return pending;
  }

  async removePlayerFromLobby(lobbyId: string, playerId: string): Promise<LobbyState | null> {
    const seat = this.find(playerId);
    if (lobbyId !== LOBBY_ID || !this.exists || !seat) {
      throw new Error('Player not in lobby');
    }

    this.seats = this.seats.filter(p => p.playerId !== playerId);
    this.generations.delete(playerId);
    this.removed.push(playerId);

    if (this.seats.length === 0) {
      this.exists = false;
      return null;
    }
    return this.state();
  }
}

/** Records what the room would have been told, and who is "live". */
class FakeHooks implements LobbyReconnectHooks {
  live = new Set<string>();
  disconnected: { playerId: string; deadline: Date; connected: boolean }[] = [];
  reconnected: { playerId: string; connected: boolean; playerCount: number }[] = [];
  expired: { playerId: string; lobbyExists: boolean }[] = [];

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

  onReconnected(lobby: LobbyState, player: LobbyPlayer): void {
    this.reconnected.push({
      playerId: player.playerId,
      connected: lobby.players.find(p => p.playerId === player.playerId)!.connected,
      playerCount: lobby.playerCount,
    });
  }

  onExpired(_lobbyCode: string, playerId: string, lobby: LobbyState | null): void {
    this.expired.push({ playerId, lobbyExists: lobby !== null });
  }
}

let lobbies: FakeLobbies;
let hooks: FakeHooks;
let service: LobbyReconnectService;

/** Lets the async work kicked off by a fired timer finish. */
async function settle(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

/** Drops a player exactly as an unexpected socket close would. */
async function drop(playerId: string, socketId = `socket-${playerId}`) {
  return service.startGracePeriod(lobbies.state(), playerId, socketId);
}

/** Brings a player back exactly as restoreSession would. */
async function comeBack(playerId: string) {
  return service.restorePlayer(lobbies.state(), playerId);
}

beforeEach(() => {
  // Only setTimeout is faked, so the microtask/setImmediate plumbing the async
  // store relies on still works normally.
  mock.timers.enable({ apis: ['setTimeout'] });

  lobbies = new FakeLobbies();
  hooks = new FakeHooks();
  service = new LobbyReconnectService(lobbies);
  service.attach(hooks);

  lobbies.seat('Om');
  lobbies.seat('Yukta');
  lobbies.seat('Raj');
  lobbies.seat('Neha');
});

afterEach(() => {
  service.cancelAll();
  mock.timers.reset();
});

describe('the grace period', () => {
  test('is thirty seconds by default', () => {
    assert.equal(LOBBY_DISCONNECT_GRACE_MS, 30_000);
    assert.equal(service.gracePeriodMs, 30_000);
  });

  test('a dropped player keeps their seat and is only marked disconnected', async () => {
    const before = lobbies.state().players.map(p => p.seatPosition);

    const lobby = await drop('Om');

    assert.ok(lobby, 'a grace period was started');
    assert.equal(lobby.playerCount, 4, 'the lobby still holds four players');

    const om = lobby.players.find(p => p.playerId === 'Om')!;
    assert.equal(om.connected, false);
    assert.equal(om.seatPosition, 0, 'seat preserved');
    assert.equal(om.isHost, true, 'host status preserved');
    assert.ok(om.disconnectedAt, 'disconnectedAt recorded');
    assert.ok(om.reconnectDeadline, 'a deadline was recorded');
    assert.equal(
      om.reconnectDeadline!.getTime() - om.disconnectedAt!.getTime(),
      service.gracePeriodMs
    );

    assert.deepEqual(
      lobby.players.map(p => p.seatPosition),
      before,
      'nobody else moved'
    );
    assert.equal(lobbies.removed.length, 0, 'nothing was removed');
    assert.equal(service.isPending(LOBBY_ID, 'Om'), true, 'a removal is scheduled');
    assert.equal(hooks.disconnected.length, 1, 'the room was told once');
    assert.equal(hooks.disconnected[0].connected, false);
  });

  test('the seat is not freed a millisecond early', async () => {
    await drop('Om');

    mock.timers.tick(service.gracePeriodMs - 1);
    await settle();

    assert.equal(lobbies.removed.length, 0);
    assert.equal(lobbies.state().playerCount, 4);
  });

  test('the seat is freed when nobody comes back', async () => {
    await drop('Om');

    mock.timers.tick(service.gracePeriodMs + 1);
    await settle();

    assert.deepEqual(lobbies.removed, ['Om']);
    assert.equal(lobbies.state().playerCount, 3);
    assert.equal(lobbies.find('Om'), undefined);
    assert.equal(service.isPending(LOBBY_ID, 'Om'), false, 'tracking cleaned up');
    assert.equal(service.pendingCount(), 0);
    assert.deepEqual(hooks.expired, [{ playerId: 'Om', lobbyExists: true }]);
  });

  test('is never started for a bot', async () => {
    lobbies.seat('Judge', { isBot: true });

    const result = await drop('Judge');

    assert.equal(result, null);
    assert.equal(service.pendingCount(), 0, 'no timer for a bot');
    assert.equal(lobbies.find('Judge')!.connected, true, 'a bot is never disconnected');
    assert.equal(hooks.disconnected.length, 0);
  });

  test('a human dropping out leaves the bots alone', async () => {
    lobbies.seat('Judge', { isBot: true });

    await drop('Om');
    mock.timers.tick(service.gracePeriodMs + 1);
    await settle();

    assert.deepEqual(lobbies.removed, ['Om']);
    assert.equal(lobbies.find('Judge')!.connected, true);
    assert.equal(lobbies.find('Judge')!.reconnectDeadline, null);
  });

  test('is not started twice for one drop, so timers cannot pile up', async () => {
    await drop('Om');
    const again = await drop('Om');

    assert.equal(again, null, 'the second call is a no-op');
    assert.equal(service.pendingCount(), 1);
    assert.equal(hooks.disconnected.length, 1);
  });

  test('is not started once the game has begun', async () => {
    lobbies.status = 'IN_GAME';

    const result = await drop('Om');

    assert.equal(result, null);
    assert.equal(service.pendingCount(), 0);
  });
});

describe('reconnecting', () => {
  test('cancels the removal, keeps the seat and does not duplicate the player', async () => {
    await drop('Om');

    const lobby = await comeBack('Om');

    assert.ok(lobby, 'the seat was reclaimed');
    assert.equal(service.isPending(LOBBY_ID, 'Om'), false, 'timer cancelled');
    assert.equal(service.pendingCount(), 0);
    assert.equal(lobby.playerCount, 4, 'still exactly four players');
    assert.equal(
      lobby.players.filter(p => p.playerId === 'Om').length,
      1,
      'exactly one Om'
    );

    const om = lobby.players.find(p => p.playerId === 'Om')!;
    assert.equal(om.connected, true);
    assert.equal(om.seatPosition, 0, 'same seat');
    assert.equal(om.isHost, true, 'still host');
    assert.equal(om.reconnectDeadline, null, 'deadline cleared');
    assert.deepEqual(
      lobby.players.map(p => p.playerId),
      ['Om', 'Yukta', 'Raj', 'Neha'],
      'player order unchanged'
    );

    assert.deepEqual(hooks.reconnected, [
      { playerId: 'Om', connected: true, playerCount: 4 },
    ]);
    assert.equal(lobbies.removed.length, 0);
  });

  test('a first-time connect is not reported as a reconnect', async () => {
    const result = await comeBack('Yukta');

    assert.equal(result, null, 'nothing to restore');
    assert.equal(hooks.reconnected.length, 0, 'no reconnect broadcast');
  });

  test('a stale timer firing afterwards cannot remove the player', async () => {
    await drop('Om');

    // Back at 28 of the 30 seconds.
    mock.timers.tick(28_000);
    await comeBack('Om');

    // The original timer's moment arrives anyway.
    mock.timers.tick(5_000);
    await settle();

    assert.equal(lobbies.removed.length, 0, 'Om was not removed');
    assert.equal(lobbies.state().playerCount, 4);
    assert.equal(lobbies.find('Om')!.connected, true);
    assert.equal(hooks.expired.length, 0, 'no removal was broadcast');
  });

  test('a stale timer is refused even if the cancellation is lost', async () => {
    await drop('Om');
    const stale = service.pendingRemoval(LOBBY_ID, 'Om')!;
    await comeBack('Om');

    // Invoke the expiry directly with the generation the dead timer captured,
    // as if clearTimeout had not taken effect.
    await service.expireDisconnectedPlayer(LOBBY_ID, LOBBY_CODE, 'Om', stale.generation);

    assert.equal(lobbies.removed.length, 0);
    assert.equal(lobbies.state().playerCount, 4);
  });

  test('a live socket beats a stale disconnected row rather than losing the seat', async () => {
    await drop('Om');
    const pending = service.pendingRemoval(LOBBY_ID, 'Om')!;

    // The row still says absent, but a socket of theirs is in the room.
    hooks.live.add('Om');

    mock.timers.tick(service.gracePeriodMs + 1);
    await settle();

    assert.equal(lobbies.removed.length, 0, 'not removed');
    assert.equal(lobbies.find('Om')!.connected, true, 'the row was repaired');
    assert.equal(hooks.reconnected.length, 1, 'the room was told they are back');
    assert.equal(pending.generation, 1);
  });

  test('a late disconnect for a socket the player already replaced is ignored', async () => {
    // The new connection is already in the room...
    hooks.live.add('Om');

    // ...when the dead socket's disconnect finally arrives.
    const result = await drop('Om', 'socket-old');

    assert.equal(result, null);
    assert.equal(service.pendingCount(), 0, 'no seat put on hold');
    assert.equal(lobbies.find('Om')!.connected, true);
    assert.equal(hooks.disconnected.length, 0);
  });
});

describe('dropping out more than once', () => {
  test('the second drop gets its own window and the first timer stays inert', async () => {
    await drop('Om');
    const first = service.pendingRemoval(LOBBY_ID, 'Om')!;

    mock.timers.tick(10_000);
    await comeBack('Om');

    await drop('Om');
    const second = service.pendingRemoval(LOBBY_ID, 'Om')!;

    assert.notEqual(second.generation, first.generation, 'a new lifecycle, new generation');
    assert.equal(service.pendingCount(), 1, 'still only one timer for the seat');

    // The first timer's original deadline passes: it must do nothing, because
    // the seat now belongs to the second grace period.
    mock.timers.tick(20_001);
    await settle();
    assert.equal(lobbies.removed.length, 0, 'the first timer did not remove Om');
    assert.equal(lobbies.find('Om')!.connected, false, 'still inside the second window');

    // The second window runs out on its own schedule.
    mock.timers.tick(10_000);
    await settle();
    assert.deepEqual(lobbies.removed, ['Om'], 'the second grace period expired normally');
  });

  test('reconnecting again after the second drop keeps the seat', async () => {
    await drop('Om');
    await comeBack('Om');
    await drop('Om');
    await comeBack('Om');

    mock.timers.tick(service.gracePeriodMs * 3);
    await settle();

    assert.equal(lobbies.removed.length, 0);
    assert.equal(lobbies.state().playerCount, 4);
    assert.equal(service.pendingCount(), 0, 'no timers left behind');
  });
});

describe('cancelling a held seat for other reasons', () => {
  test('a kick drops the pending removal', async () => {
    await drop('Yukta');
    assert.equal(service.isPending(LOBBY_ID, 'Yukta'), true);

    service.cancelGracePeriod(LOBBY_ID, 'Yukta');

    mock.timers.tick(service.gracePeriodMs + 1);
    await settle();

    assert.equal(service.pendingCount(), 0);
    assert.equal(lobbies.removed.length, 0, 'the timer never fired');
  });

  test('the game starting drops every held seat in the lobby', async () => {
    await drop('Yukta');
    await drop('Raj');
    assert.equal(service.pendingCount(), 2);

    service.cancelLobby(LOBBY_ID);
    lobbies.status = 'IN_GAME';

    mock.timers.tick(service.gracePeriodMs + 1);
    await settle();

    assert.equal(service.pendingCount(), 0);
    assert.equal(lobbies.state().playerCount, 4, 'nobody was removed mid-game');
  });

  test('a timer that survives into a started game still refuses to remove anyone', async () => {
    await drop('Yukta');
    // Deliberately do NOT cancel: prove the expiry guard, not just the cleanup.
    lobbies.status = 'IN_GAME';

    mock.timers.tick(service.gracePeriodMs + 1);
    await settle();

    assert.equal(lobbies.removed.length, 0);
  });

  test('a player already gone from the lobby is not removed twice', async () => {
    await drop('Yukta');
    await lobbies.removePlayerFromLobby(LOBBY_ID, 'Yukta');
    lobbies.removed.length = 0;

    mock.timers.tick(service.gracePeriodMs + 1);
    await settle();

    assert.equal(lobbies.removed.length, 0, 'no second removal');
    assert.equal(hooks.expired.length, 0);
  });

  test('the last seat expiring closes the lobby and clears its other timers', async () => {
    lobbies.seats = lobbies.seats.filter(p => p.playerId === 'Om');

    await drop('Om');
    mock.timers.tick(service.gracePeriodMs + 1);
    await settle();

    assert.deepEqual(lobbies.removed, ['Om']);
    assert.equal(lobbies.exists, false, 'the lobby is gone');
    assert.equal(service.pendingCount(), 0);
    assert.deepEqual(hooks.expired, [{ playerId: 'Om', lobbyExists: false }]);
  });

  test('cancelAll leaves nothing armed', async () => {
    await drop('Om');
    await drop('Yukta');

    service.cancelAll();

    mock.timers.tick(service.gracePeriodMs + 1);
    await settle();

    assert.equal(service.pendingCount(), 0);
    assert.equal(lobbies.removed.length, 0);
  });
});

describe('surviving a server restart', () => {
  test('a deadline still in the future is picked back up', async () => {
    // A held seat written by the previous process: no timer exists for it.
    const seat = lobbies.find('Om')!;
    seat.connected = false;
    seat.disconnectedAt = new Date();
    seat.reconnectDeadline = new Date(Date.now() + 20_000);
    lobbies.generations.set('Om', 1);

    const resumed = await service.recoverPendingGracePeriods();

    assert.equal(resumed, 1);
    assert.equal(service.isPending(LOBBY_ID, 'Om'), true);

    mock.timers.tick(19_000);
    await settle();
    assert.equal(lobbies.removed.length, 0, 'not removed before the deadline');

    mock.timers.tick(2_000);
    await settle();
    assert.deepEqual(lobbies.removed, ['Om'], 'removed at the persisted deadline');
  });

  test('a deadline that passed while the process was down is settled at once', async () => {
    const seat = lobbies.find('Yukta')!;
    seat.connected = false;
    seat.disconnectedAt = new Date(Date.now() - 60_000);
    seat.reconnectDeadline = new Date(Date.now() - 30_000);
    lobbies.generations.set('Yukta', 1);

    const resumed = await service.recoverPendingGracePeriods();

    assert.equal(resumed, 1);
    assert.deepEqual(lobbies.removed, ['Yukta']);
    assert.equal(service.pendingCount(), 0, 'no timer left armed');
  });

  test('connected players and bots are not swept up', async () => {
    lobbies.seat('Judge', { isBot: true });

    const resumed = await service.recoverPendingGracePeriods();

    assert.equal(resumed, 0);
    assert.equal(service.pendingCount(), 0);
  });
});

describe('starting the game while somebody is reconnecting', () => {
  test('a held human seat blocks the deal', async () => {
    await drop('Yukta');

    const lobby = lobbies.state();
    assert.equal(lobby.canStart, false, 'the client sees the button as unavailable');
    assert.equal(
      canStartGame(lobby.playerCount, lobby.status, countDisconnectedHumans(lobby.players))
        .reason,
      'Waiting for all players to reconnect before starting the game.'
    );
  });

  test('the block lifts the moment they are back', async () => {
    await drop('Yukta');
    await comeBack('Yukta');

    assert.equal(lobbies.state().canStart, true);
  });

  test('a bot is never counted as disconnected', async () => {
    lobbies.seat('Judge', { isBot: true, connected: false });

    const lobby = lobbies.state();
    assert.equal(countDisconnectedHumans(lobby.players), 0);
    assert.equal(lobby.canStart, true, 'bots never hold up the start');
  });
});

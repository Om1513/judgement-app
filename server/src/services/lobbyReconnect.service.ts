// Lobby reconnect service - the disconnect grace period for waiting rooms.
//
// A phone in a lobby drops out constantly: the app is backgrounded while the
// code is shared, WiFi hands over to mobile data, a browser tab is refreshed,
// Socket.IO reconnects. None of that should cost a player their seat, so a
// socket drop from a WAITING lobby does not remove anybody. Instead the seat is
// held - name, seat position, host status and all - for
// LOBBY_DISCONNECT_GRACE_MS, and the player is shown to everyone else as
// reconnecting. Come back in time and nothing was lost; don't, and the seat is
// freed exactly as if they had left.
//
// This is the pre-game half of the reconnection architecture whose other half
// already exists: identity is the stable clientId resolved by playerService, and
// the socket that comes back is re-attached by restoreSession() in socket/
// index.ts, which is also what cancels the grace period. There is no second
// identity or session mechanism here.
//
// Everything timing- and race-related lives in this file. The persistence it
// drives (connected / disconnectedAt / reconnectDeadline / disconnectGeneration
// on LobbyPlayer) lives in lobbyService.
//
// The two races that matter, and how they are handled:
//
//   1. Player reconnects at 28s, the 30s timer still fires. Every removal
//      re-reads the row first and refuses to act unless it is still
//      disconnected AND still on the same disconnectGeneration the timer was
//      scheduled against. A reconnect bumps that generation, so a stale timer
//      recognises itself and returns.
//
//   2. A dead socket's `disconnect` event arrives *after* the player has already
//      reconnected on a new socket (a ping timeout can be reported late). Before
//      starting a grace period we check whether that player already has a live
//      socket in the lobby room, and if so do nothing at all.

import { LOBBY_DISCONNECT_GRACE_MS } from '../config/constants';
import { LobbyState } from '../types/lobby';
import { LobbyMembership, LobbyPlayer } from '../types/player';
import { DisconnectMark, lobbyService } from './lobby.service';

/**
 * The slice of lobbyService this service needs. Narrowed to an interface so the
 * timing and race logic can be unit-tested against an in-memory fake, with no
 * database and no sockets in the way.
 */
export interface LobbyReconnectStore {
  markPlayerDisconnected(
    lobbyId: string,
    playerId: string,
    graceMs: number
  ): Promise<DisconnectMark | null>;
  markPlayerConnected(
    lobbyId: string,
    playerId: string
  ): Promise<{ lobby: LobbyState | null; changed: boolean }>;
  getMembership(lobbyId: string, playerId: string): Promise<LobbyMembership | null>;
  getPendingReconnects(): Promise<LobbyMembership[]>;
  removePlayerFromLobby(lobbyId: string, playerId: string): Promise<LobbyState | null>;
}

/**
 * The socket-layer effects this service triggers. Supplied once at startup by
 * socket/lobby.events.ts so the service itself stays free of Socket.IO.
 */
export interface LobbyReconnectHooks {
  /**
   * Whether `playerId` currently has a live socket in the lobby room, ignoring
   * `excludeSocketId` (the connection whose disconnect we are processing).
   */
  hasLiveSocket(
    lobbyCode: string,
    playerId: string,
    excludeSocketId?: string | null
  ): Promise<boolean>;
  /** A player's seat has just been put on hold. */
  onDisconnected(lobby: LobbyState, player: LobbyPlayer, reconnectDeadline: Date): void;
  /** A player has reclaimed their seat. Never a "joined" event - this is not a new join. */
  onReconnected(lobby: LobbyState, player: LobbyPlayer): void;
  /**
   * A held seat was given up. `lobby` is null when the lobby itself is gone
   * (the last human left, or only bots remained behind the host).
   */
  onExpired(lobbyCode: string, playerId: string, lobby: LobbyState | null): void;
}

interface PendingRemoval {
  timer: ReturnType<typeof setTimeout>;
  /** The disconnectGeneration this timer is allowed to act on. */
  generation: number;
  /** Wall-clock ms at which the seat is given up. */
  expiresAt: number;
}

function timerKey(lobbyId: string, playerId: string): string {
  return `${lobbyId}:${playerId}`;
}

export class LobbyReconnectService {
  private readonly pending = new Map<string, PendingRemoval>();
  private hooks: LobbyReconnectHooks | null = null;
  private graceMs = LOBBY_DISCONNECT_GRACE_MS;

  constructor(private readonly store: LobbyReconnectStore = lobbyService) {}

  /** Wires up the Socket.IO-backed effects. Called once, from initializeSocket. */
  attach(hooks: LobbyReconnectHooks): void {
    this.hooks = hooks;
  }

  /**
   * Overrides the grace period. Only for tests, which need a window measured in
   * milliseconds rather than half a minute; production runs on the constant.
   */
  configure(options: { graceMs?: number }): void {
    if (typeof options.graceMs === 'number' && options.graceMs >= 0) {
      this.graceMs = options.graceMs;
    }
  }

  /** The grace period currently in force, in milliseconds. */
  get gracePeriodMs(): number {
    return this.graceMs;
  }

  /** Whether a removal is currently scheduled for this player. */
  isPending(lobbyId: string, playerId: string): boolean {
    return this.pending.has(timerKey(lobbyId, playerId));
  }

  /** How many removals are scheduled in total. Used by tests to prove cleanup. */
  pendingCount(): number {
    return this.pending.size;
  }

  /**
   * The scheduled removal for this seat, if any: which disconnect generation it
   * belongs to and when it fires. Introspection for tests and diagnostics.
   */
  pendingRemoval(
    lobbyId: string,
    playerId: string
  ): { generation: number; expiresAt: number } | null {
    const entry = this.pending.get(timerKey(lobbyId, playerId));
    return entry ? { generation: entry.generation, expiresAt: entry.expiresAt } : null;
  }

  /**
   * Holds a player's seat after an unexpected socket drop and schedules its
   * removal for when the grace period runs out.
   *
   * Returns the lobby to broadcast, or null when no grace period was started -
   * a bot, a lobby that is no longer waiting, a player who is not a member, a
   * player already inside a grace period, or a stale disconnect for a socket the
   * player has already replaced.
   */
  async startGracePeriod(
    lobby: LobbyState,
    playerId: string,
    socketId?: string | null
  ): Promise<LobbyState | null> {
    if (lobby.status !== 'WAITING') {
      return null;
    }

    const member = lobby.players.find(p => p.playerId === playerId);
    if (!member || member.isBot) {
      // Bots have no socket to lose, so they are never marked disconnected and
      // never get a timer.
      return null;
    }

    // Race 2: the disconnect belongs to a connection this player has already
    // replaced. They are here, on a different socket - do nothing.
    if (await this.playerIsLive(lobby.code, playerId, socketId)) {
      return null;
    }

    const mark = await this.store.markPlayerDisconnected(lobby.id, playerId, this.graceMs);
    if (!mark) {
      return null;
    }

    this.schedule(lobby.id, lobby.code, playerId, mark.generation, this.graceMs);

    const held = mark.lobby.players.find(p => p.playerId === playerId);
    if (held) {
      this.hooks?.onDisconnected(mark.lobby, held, mark.reconnectDeadline);
    }

    return mark.lobby;
  }

  /**
   * Gives a returning player their existing seat back.
   *
   * Called from the normal reconnect path (restoreSession), so the player has
   * already been re-attached to the lobby room by the time we get here. Cancels
   * the pending removal, marks them connected and returns the lobby to
   * broadcast - or null when there was nothing to restore, which is the case for
   * an ordinary first connect.
   */
  async restorePlayer(lobby: LobbyState, playerId: string): Promise<LobbyState | null> {
    const member = lobby.players.find(p => p.playerId === playerId);
    if (!member || member.isBot) {
      return null;
    }

    // Cancel first: even if the row already says connected (two sockets racing
    // to restore), a leftover timer must not survive this connection.
    this.cancelGracePeriod(lobby.id, playerId);

    const { lobby: updated, changed } = await this.store.markPlayerConnected(lobby.id, playerId);
    if (!changed || !updated) {
      return null;
    }

    const restored = updated.players.find(p => p.playerId === playerId);
    if (restored) {
      this.hooks?.onReconnected(updated, restored);
    }

    return updated;
  }

  /**
   * Drops a pending removal without touching the player's state.
   *
   * Called wherever a seat stops being held for a reason other than the player
   * returning: an explicit Leave Lobby, a kick, the game starting, the lobby
   * being deleted, or the timer having just fired.
   */
  cancelGracePeriod(lobbyId: string, playerId: string): void {
    const key = timerKey(lobbyId, playerId);
    const entry = this.pending.get(key);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(key);
  }

  /** Drops every pending removal for one lobby (game started, lobby deleted). */
  cancelLobby(lobbyId: string): void {
    const prefix = `${lobbyId}:`;
    for (const [key, entry] of this.pending) {
      if (key.startsWith(prefix)) {
        clearTimeout(entry.timer);
        this.pending.delete(key);
      }
    }
  }

  /** Drops every pending removal. Used on shutdown and between test suites. */
  cancelAll(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }

  /**
   * Frees a held seat, but only after proving it is still genuinely abandoned.
   *
   * Every guard here exists to stop a timer from evicting somebody who is
   * actually present: the row is re-read from the database rather than trusted
   * from the closure, the generation must still match, and a live socket wins
   * over a stale `connected: false` (in which case we repair the row instead of
   * removing the player).
   */
  async expireDisconnectedPlayer(
    lobbyId: string,
    lobbyCode: string,
    playerId: string,
    expectedGeneration: number
  ): Promise<void> {
    this.pending.delete(timerKey(lobbyId, playerId));

    const membership = await this.store.getMembership(lobbyId, playerId);

    // Already gone: they left, were kicked, or the lobby was deleted.
    if (!membership) {
      return;
    }

    // The game started while they were away - the in-game disconnect handling
    // owns them now, and removing a seated player mid-game would break it.
    if (membership.lobbyStatus !== 'WAITING') {
      return;
    }

    // Reconnected, on this generation or a later one.
    if (membership.connected) {
      return;
    }

    // A newer disconnect/reconnect cycle owns this seat; that cycle has its own
    // timer and this one has no business acting.
    if (membership.disconnectGeneration !== expectedGeneration) {
      return;
    }

    // Belt and braces: the row says absent but a socket of theirs is sitting in
    // the room. Trust the live connection and repair the row.
    if (await this.playerIsLive(lobbyCode, playerId)) {
      const { lobby: repaired, changed } = await this.store.markPlayerConnected(lobbyId, playerId);
      const restored = repaired?.players.find(p => p.playerId === playerId);
      if (changed && repaired && restored) {
        this.hooks?.onReconnected(repaired, restored);
      }
      return;
    }

    const lobby = await this.store.removePlayerFromLobby(lobbyId, playerId);

    if (lobby === null) {
      // The lobby went with them; its siblings' timers are meaningless now.
      this.cancelLobby(lobbyId);
    }

    this.hooks?.onExpired(lobbyCode, playerId, lobby);
  }

  /**
   * Resumes grace periods that were in flight when the process last stopped.
   *
   * The countdown is persisted as `reconnectDeadline`, so a restart does not
   * quietly hand out permanent seats: deadlines already in the past are settled
   * immediately, and the rest get a fresh timer for whatever time is left.
   * Returns how many held seats were found.
   */
  async recoverPendingGracePeriods(): Promise<number> {
    const pending = await this.store.getPendingReconnects();

    for (const membership of pending) {
      const remaining = membership.reconnectDeadline
        ? membership.reconnectDeadline.getTime() - Date.now()
        : 0;

      if (remaining <= 0) {
        await this.expireDisconnectedPlayer(
          membership.lobbyId,
          membership.lobbyCode,
          membership.playerId,
          membership.disconnectGeneration
        );
        continue;
      }

      this.schedule(
        membership.lobbyId,
        membership.lobbyCode,
        membership.playerId,
        membership.disconnectGeneration,
        remaining
      );
    }

    if (pending.length > 0) {
      console.log(`Resumed ${pending.length} lobby reconnect grace period(s) after restart`);
    }

    return pending.length;
  }

  /**
   * Arms the removal timer, replacing any timer already held for this seat so
   * they can never accumulate - one seat, at most one pending removal.
   */
  private schedule(
    lobbyId: string,
    lobbyCode: string,
    playerId: string,
    generation: number,
    delayMs: number
  ): void {
    const key = timerKey(lobbyId, playerId);
    this.cancelGracePeriod(lobbyId, playerId);

    const timer = setTimeout(() => {
      this.pending.delete(key);
      void this.expireDisconnectedPlayer(lobbyId, lobbyCode, playerId, generation).catch(
        error => {
          console.error('Error expiring disconnected lobby player:', error);
        }
      );
    }, delayMs);

    // Never let a held seat be the reason the process cannot exit.
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    this.pending.set(key, {
      timer,
      generation,
      expiresAt: Date.now() + delayMs,
    });
  }

  /** Presence probe, defaulting to "not live" when no socket layer is attached. */
  private async playerIsLive(
    lobbyCode: string,
    playerId: string,
    excludeSocketId?: string | null
  ): Promise<boolean> {
    if (!this.hooks) {
      return false;
    }
    return this.hooks.hasLiveSocket(lobbyCode, playerId, excludeSocketId);
  }
}

// Export singleton instance
export const lobbyReconnectService = new LobbyReconnectService();

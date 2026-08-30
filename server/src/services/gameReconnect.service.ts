// Game reconnect service - the disconnect grace period, bot takeover and
// rejoin decision for a game that is already under way.
//
// A phone drops out mid-game for all the same mundane reasons it drops out of a
// lobby - backgrounded app, WiFi handing over to mobile data, a tunnel - and
// none of that should cost anyone their hand. But a live game cannot simply wait
// the way a lobby can: an unplayed turn blocks everybody else indefinitely. So
// the lifecycle has three stages rather than two:
//
//   HUMAN -> (drops out) -> RECONNECTING -> (grace elapses) -> BOT CONTROLLED
//                                |                                   |
//                          comes back:                        comes back:
//                        restored silently                 asked to REJOIN
//
// Two rules shape everything here:
//
//   1. Nobody is ever removed and no substitute player is ever created. The
//      takeover flips one flag on the *same* seat, so name, avatar, seat
//      position, hand, bid, tricks won and score are untouched and only the
//      controller changes. That is what makes a rejoin a resumption rather than
//      a reconstruction.
//
//   2. Coming back after a takeover is the player's decision, not something that
//      happens to them. Bidding and cards have been played in their name; being
//      teleported into a hand they no longer recognise is worse than being asked.
//      So `session:restore` reports REJOIN_AVAILABLE and waits (see
//      socket/index.ts), and only an explicit `session:rejoin` hands control
//      back. `session:discard` is the other answer: the game carries on with the
//      bot, and the other players are not affected in any way.
//
// This is the in-game half of the reconnection architecture whose other halves
// already exist: identity is the stable clientId resolved by playerService, the
// waiting-room grace period lives in lobbyReconnect.service.ts, and the bot that
// takes over is the existing bot engine - there is no second AI, no second
// session mechanism and no second identity here.
//
// Everything timing- and race-related lives in this file; the persistence it
// drives (connected / disconnectedAt / reconnectDeadline / disconnectGeneration
// / controlledByBot / sessionDiscarded on LobbyPlayer) lives in lobbyService.
//
// The races that matter, and how they are handled:
//
//   1. Player reconnects at 29s, the 30s timer still fires. The takeover re-reads
//      the row and claims the seat with a *conditional* write: still absent,
//      still not taken over, still the same disconnectGeneration the timer was
//      scheduled against. A reconnect bumps that generation, so the stale timer
//      loses the race rather than parking a bot on an occupied seat.
//
//   2. A dead socket's `disconnect` arrives after the player has already
//      reconnected on a new socket (a ping timeout can be reported late). Before
//      starting a grace period we check for a live socket of theirs in the room,
//      and if there is one, do nothing at all.
//
//   3. The bot is mid-action when the human rejoins. The rejoin clears
//      controlledByBot, and every bot action re-checks - at the moment it fires,
//      not when it was scheduled - that it is still that seat's controller. On
//      top of that the game service itself refuses any action that is not the
//      current turn, so at most one of the two can ever commit.

import { GAME_DISCONNECT_GRACE_MS } from '../config/constants';
import { LobbyState } from '../types/lobby';
import { LobbyMembership, LobbyPlayer } from '../types/player';
import { DisconnectMark, lobbyService } from './lobby.service';

/**
 * Who is driving a seat right now. Derived from the membership row rather than
 * stored, so there is exactly one source of truth.
 */
export type SeatControl =
  /** The player is here and playing for themselves. */
  | 'CONNECTED'
  /** Dropped out, inside the grace period, seat held, nobody playing it. */
  | 'RECONNECTING'
  /** Grace period elapsed; the bot engine is playing this seat. */
  | 'BOT_TAKEOVER'
  /** Bot-controlled, and the player has said they are not coming back. */
  | 'DISCARDED';

/** The seat's current controller, from a freshly read membership row. */
export function seatControl(membership: LobbyMembership): SeatControl {
  if (membership.sessionDiscarded) {
    return 'DISCARDED';
  }
  if (membership.controlledByBot) {
    return 'BOT_TAKEOVER';
  }
  return membership.connected ? 'CONNECTED' : 'RECONNECTING';
}

/** What a (re)connecting socket should be given back. */
export type GameRestoreOutcome =
  /** Nothing was being held for them - an ordinary connect into a live game. */
  | { mode: 'NONE' }
  /** They were inside the grace period: restored silently, no prompt. */
  | { mode: 'RESTORED'; lobby: LobbyState }
  /** The bot is playing their seat; they must choose REJOIN or DISCARD. */
  | { mode: 'REJOIN_AVAILABLE'; lobby: LobbyState }
  /** They already chose DISCARD for this game; do not offer it again. */
  | { mode: 'DISCARDED' };

/**
 * The slice of lobbyService this service needs. Narrowed to an interface so the
 * timing and race logic can be unit-tested against an in-memory fake, with no
 * database and no sockets in the way.
 */
export interface GameReconnectStore {
  markGamePlayerDisconnected(
    lobbyId: string,
    playerId: string,
    graceMs: number
  ): Promise<DisconnectMark | null>;
  reclaimSeatFromGrace(
    lobbyId: string,
    playerId: string
  ): Promise<{ lobby: LobbyState | null; changed: boolean }>;
  claimSeatForBot(
    lobbyId: string,
    playerId: string,
    expectedGeneration: number
  ): Promise<{ lobby: LobbyState | null; changed: boolean }>;
  markGamePlayerRejoined(
    lobbyId: string,
    playerId: string
  ): Promise<{ lobby: LobbyState | null; changed: boolean }>;
  markSessionDiscarded(
    lobbyId: string,
    playerId: string
  ): Promise<{ lobby: LobbyState | null; changed: boolean }>;
  getMembership(lobbyId: string, playerId: string): Promise<LobbyMembership | null>;
  getPendingGameDisconnects(): Promise<LobbyMembership[]>;
}

/**
 * The socket-layer effects this service triggers. Supplied once at startup by
 * socket/game.events.ts so the service itself stays free of Socket.IO - and,
 * just as importantly, free of the bot engine: driving the bot is an effect of a
 * takeover, not part of deciding one.
 */
export interface GameReconnectHooks {
  /**
   * Whether `playerId` currently has a live socket in the lobby room, ignoring
   * `excludeSocketId` (the connection whose disconnect we are processing).
   */
  hasLiveSocket(
    lobbyCode: string,
    playerId: string,
    excludeSocketId?: string | null
  ): Promise<boolean>;
  /** A player has dropped out; show them as "Reconnecting..." to the table. */
  onDisconnected(lobby: LobbyState, player: LobbyPlayer, reconnectDeadline: Date): void;
  /**
   * The bot now owns this seat. This is where the game is nudged forward: if it
   * was that player's turn, the table has been waiting on it.
   */
  onBotTakeover(lobby: LobbyState, player: LobbyPlayer): void;
  /** Back inside the grace period - a silent restoration, never a prompt. */
  onReconnected(lobby: LobbyState, player: LobbyPlayer): void;
  /** Back after a takeover, by their own choice. Human control resumes. */
  onRejoined(lobby: LobbyState, player: LobbyPlayer): void;
  /** They chose not to come back. The bot keeps their seat; the game goes on. */
  onDiscarded(lobby: LobbyState, player: LobbyPlayer): void;
}

interface PendingTakeover {
  timer: ReturnType<typeof setTimeout>;
  /** The disconnectGeneration this timer is allowed to act on. */
  generation: number;
  /** Wall-clock ms at which the bot takes over. */
  expiresAt: number;
}

function timerKey(lobbyId: string, playerId: string): string {
  return `${lobbyId}:${playerId}`;
}

export class GameReconnectService {
  private readonly pending = new Map<string, PendingTakeover>();
  private hooks: GameReconnectHooks | null = null;
  private graceMs = GAME_DISCONNECT_GRACE_MS;

  constructor(private readonly store: GameReconnectStore = lobbyService) {}

  /** Wires up the Socket.IO-backed effects. Called once, from initializeSocket. */
  attach(hooks: GameReconnectHooks): void {
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

  /** Whether a bot takeover is currently scheduled for this player. */
  isPending(lobbyId: string, playerId: string): boolean {
    return this.pending.has(timerKey(lobbyId, playerId));
  }

  /** How many takeovers are scheduled in total. Used by tests to prove cleanup. */
  pendingCount(): number {
    return this.pending.size;
  }

  /**
   * The scheduled takeover for this seat, if any: which disconnect generation it
   * belongs to and when it fires. Introspection for tests and diagnostics.
   */
  pendingTakeover(
    lobbyId: string,
    playerId: string
  ): { generation: number; expiresAt: number } | null {
    const entry = this.pending.get(timerKey(lobbyId, playerId));
    return entry ? { generation: entry.generation, expiresAt: entry.expiresAt } : null;
  }

  /**
   * Marks a player as reconnecting after an unexpected socket drop mid-game and
   * schedules the bot takeover for when the grace period runs out.
   *
   * Nothing is removed and nobody is replaced: the seat, hand, bid and score are
   * all left alone. Returns the lobby to broadcast, or null when no grace period
   * was started - a bot, a lobby that is not in a game, a player who is not a
   * member, a player already absent (their existing timer owns the seat), or a
   * stale disconnect for a socket the player has already replaced.
   */
  async startGracePeriod(
    lobby: LobbyState,
    playerId: string,
    socketId?: string | null
  ): Promise<LobbyState | null> {
    if (lobby.status !== 'IN_GAME') {
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

    const mark = await this.store.markGamePlayerDisconnected(lobby.id, playerId, this.graceMs);
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
   * Decides what a (re)connecting socket gets back, and is the whole reason the
   * two comebacks feel different.
   *
   * Called from the normal reconnect path (restoreSession), so the player has
   * already been re-attached to the lobby room by the time we get here.
   *
   *   * still inside the grace period -> restored on the spot, timer cancelled,
   *     no prompt: as far as they are concerned the drop never happened;
   *   * the bot has taken over        -> REJOIN_AVAILABLE, and deliberately no
   *     state change and no game state, because they have not come back yet;
   *   * they already discarded        -> DISCARDED, so nothing is offered again;
   *   * nothing was being held        -> NONE, the ordinary connect.
   */
  async restorePlayer(lobby: LobbyState, playerId: string): Promise<GameRestoreOutcome> {
    const member = lobby.players.find(p => p.playerId === playerId);
    if (!member || member.isBot) {
      return { mode: 'NONE' };
    }

    const membership = await this.store.getMembership(lobby.id, playerId);
    if (!membership) {
      return { mode: 'NONE' };
    }

    switch (seatControl(membership)) {
      case 'DISCARDED':
        return { mode: 'DISCARDED' };

      case 'BOT_TAKEOVER':
        // Do NOT cancel anything and do NOT touch the row: the bot keeps playing
        // until they actually say they want the seat back.
        return { mode: 'REJOIN_AVAILABLE', lobby };

      case 'CONNECTED':
        // Already marked present - a first connect, or a second socket racing to
        // restore the same session. Drop any leftover timer regardless, so it
        // cannot fire against a player who is demonstrably here.
        this.cancelGracePeriod(lobby.id, playerId);
        return { mode: 'NONE' };

      case 'RECONNECTING': {
        // Cancel first: even if the write below loses a race, a leftover timer
        // must not survive this connection.
        this.cancelGracePeriod(lobby.id, playerId);

        const { lobby: updated, changed } = await this.store.reclaimSeatFromGrace(
          lobby.id,
          playerId
        );

        if (!changed || !updated) {
          // Race 1 at its tightest: the takeover claimed the seat between our
          // read and our write. The bot owns it now, so this is the other
          // comeback - ask them.
          const after = await this.store.getMembership(lobby.id, playerId);
          if (after && seatControl(after) === 'BOT_TAKEOVER') {
            return { mode: 'REJOIN_AVAILABLE', lobby: updated ?? lobby };
          }
          return { mode: 'NONE' };
        }

        const restored = updated.players.find(p => p.playerId === playerId);
        if (restored) {
          this.hooks?.onReconnected(updated, restored);
        }
        return { mode: 'RESTORED', lobby: updated };
      }
    }
  }

  /**
   * The REJOIN GAME answer: stops bot control, marks the player present and
   * hands the seat back.
   *
   * What they get back is the *current* state, not the state they left. Anything
   * the bot did in their name - a bid, cards played, tricks lost - stands; there
   * is nothing to undo here, because the game has simply moved on.
   *
   * Returns the refreshed lobby, or null when there was nothing to rejoin.
   */
  async rejoin(lobby: LobbyState, playerId: string): Promise<LobbyState | null> {
    if (lobby.status !== 'IN_GAME') {
      return null;
    }

    const member = lobby.players.find(p => p.playerId === playerId);
    if (!member || member.isBot) {
      return null;
    }

    // The seat is theirs again, so no takeover may fire against it.
    this.cancelGracePeriod(lobby.id, playerId);

    const { lobby: updated, changed } = await this.store.markGamePlayerRejoined(
      lobby.id,
      playerId
    );

    if (!updated) {
      return null;
    }

    const restored = updated.players.find(p => p.playerId === playerId);
    if (changed && restored) {
      this.hooks?.onRejoined(updated, restored);
    }

    return updated;
  }

  /**
   * The DISCARD answer: they are not coming back to this game.
   *
   * Explicitly NOT a deletion. The game keeps running exactly as it was, with
   * the bot on their seat, and the other players notice nothing - the only thing
   * that changes is that this player is never offered the game again.
   */
  async discard(lobby: LobbyState, playerId: string): Promise<LobbyState | null> {
    const member = lobby.players.find(p => p.playerId === playerId);
    if (!member || member.isBot) {
      return null;
    }

    // A discard can arrive while the grace period is still running (they killed
    // the app, reopened it and said no before 30s were up). Marking the seat
    // bot-controlled here is what stops it being left with nobody driving it.
    this.cancelGracePeriod(lobby.id, playerId);

    const { lobby: updated, changed } = await this.store.markSessionDiscarded(
      lobby.id,
      playerId
    );

    if (!updated) {
      return null;
    }

    const discarded = updated.players.find(p => p.playerId === playerId);
    if (changed && discarded) {
      this.hooks?.onDiscarded(updated, discarded);
    }

    return updated;
  }

  /**
   * Drops a pending takeover without touching the player's state.
   *
   * Called wherever a countdown stops mattering for a reason other than it
   * elapsing: the player returning, an explicit Leave Game, the game ending, or
   * the timer having just fired.
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

  /** Drops every pending takeover for one lobby (game over, lobby deleted). */
  cancelLobby(lobbyId: string): void {
    const prefix = `${lobbyId}:`;
    for (const [key, entry] of this.pending) {
      if (key.startsWith(prefix)) {
        clearTimeout(entry.timer);
        this.pending.delete(key);
      }
    }
  }

  /** Drops every pending takeover. Used on shutdown and between test suites. */
  cancelAll(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }

  /**
   * Hands a seat to the bot, but only after proving its owner is still genuinely
   * absent.
   *
   * Every guard here exists to stop a timer from taking a seat away from
   * somebody who is actually present: the row is re-read from the database
   * rather than trusted from the closure, the game must still be running, a live
   * socket wins over a stale `connected: false` (in which case we repair the row
   * instead), and the claim itself is conditional on the generation so a
   * reconnect landing in the same instant wins.
   */
  async takeOverWithBot(
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

    // The game finished (or never started) while they were away. A completed
    // game has nothing left for a bot to play.
    if (membership.lobbyStatus !== 'IN_GAME') {
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

    // Already handed over - by an earlier timer, or by an explicit discard.
    if (membership.controlledByBot) {
      return;
    }

    // Belt and braces: the row says absent but a socket of theirs is sitting in
    // the room. Trust the live connection and repair the row.
    if (await this.playerIsLive(lobbyCode, playerId)) {
      const { lobby: repaired, changed } = await this.store.reclaimSeatFromGrace(
        lobbyId,
        playerId
      );
      const restored = repaired?.players.find(p => p.playerId === playerId);
      if (changed && repaired && restored) {
        this.hooks?.onReconnected(repaired, restored);
      }
      return;
    }

    const { lobby, changed } = await this.store.claimSeatForBot(
      lobbyId,
      playerId,
      expectedGeneration
    );

    if (!changed || !lobby) {
      // Lost the race to a reconnect. Nothing to do and nothing to announce.
      return;
    }

    const seat = lobby.players.find(p => p.playerId === playerId);
    if (seat) {
      this.hooks?.onBotTakeover(lobby, seat);
    }
  }

  /**
   * Resumes takeover countdowns that were in flight when the process last
   * stopped.
   *
   * The countdown is persisted as `reconnectDeadline`, so a restart does not
   * leave a table waiting on a seat nobody is driving: deadlines already in the
   * past are handed to the bot immediately, and the rest get a fresh timer for
   * whatever time is left. Returns how many absent seats were found.
   */
  async recoverPendingTakeovers(): Promise<number> {
    const pending = await this.store.getPendingGameDisconnects();

    for (const membership of pending) {
      const remaining = membership.reconnectDeadline
        ? membership.reconnectDeadline.getTime() - Date.now()
        : 0;

      if (remaining <= 0) {
        await this.takeOverWithBot(
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
      console.log(`Resumed ${pending.length} in-game reconnect grace period(s) after restart`);
    }

    return pending.length;
  }

  /**
   * Arms the takeover timer, replacing any timer already held for this seat so
   * they can never accumulate - one seat, at most one pending takeover.
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
      void this.takeOverWithBot(lobbyId, lobbyCode, playerId, generation).catch(error => {
        console.error('Error handing a disconnected seat to the bot:', error);
      });
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
export const gameReconnectService = new GameReconnectService();

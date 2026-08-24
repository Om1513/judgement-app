// Lobby service - handles lobby CRUD and player management

import { getDB } from '../db/connection';
import {
  LobbyState,
  LobbySettings,
  CreateLobbyInput,
  JoinLobbyInput,
  UpdateLobbySettingsInput,
} from '../types/lobby';
import { LobbyMembership, LobbyPlayer } from '../types/player';
import { generateLobbyCode, isValidLobbyCode } from '../utils/generateLobbyCode';
import { validateLobbySettings, canStartGame } from '../utils/validateLobby';

/** The state written when a player drops out of a waiting lobby. */
export interface DisconnectMark {
  lobby: LobbyState;
  /** Generation the removal timer must still match when it fires. */
  generation: number;
  disconnectedAt: Date;
  reconnectDeadline: Date;
}

/** How many human players are currently holding a seat open mid-reconnect. */
export function countDisconnectedHumans(players: LobbyPlayer[]): number {
  return players.filter(p => !p.isBot && !p.connected).length;
}

export class LobbyService {
  /**
   * Creates a new lobby.
   */
  async createLobby(input: CreateLobbyInput): Promise<LobbyState> {
    const db = getDB();

    // Validate and merge settings with defaults
    const settingsValidation = validateLobbySettings(input.settings || {});
    if (!settingsValidation.valid) {
      throw new Error(settingsValidation.errors.join(', '));
    }

    // Generate unique lobby code
    const existingCodes = await db.lobby.findMany({
      where: { status: 'WAITING' },
      select: { code: true },
    });

    let code: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      code = generateLobbyCode();
      attempts++;
    } while (
      existingCodes.some(l => l.code === code) &&
      attempts < maxAttempts
    );

    if (attempts >= maxAttempts) {
      throw new Error('Failed to generate unique lobby code');
    }

    // Create lobby with host as first player
    const lobby = await db.lobby.create({
      data: {
        code,
        hostPlayerId: input.hostPlayerId,
        status: 'WAITING',
        settings: settingsValidation.settings as any,
        lobbyPlayers: {
          create: {
            playerId: input.hostPlayerId,
            isHost: true,
            seatPosition: 0,
          },
        },
      },
      include: {
        lobbyPlayers: {
          include: {
            player: true,
          },
          orderBy: {
            seatPosition: 'asc',
          },
        },
        hostPlayer: true,
      },
    });

    return this.toLobbyState(lobby);
  }

  /**
   * Gets a lobby by code.
   */
  async getLobbyByCode(code: string): Promise<LobbyState | null> {
    if (!isValidLobbyCode(code)) {
      return null;
    }

    const db = getDB();

    const lobby = await db.lobby.findUnique({
      where: { code },
      include: {
        lobbyPlayers: {
          include: {
            player: true,
          },
          orderBy: {
            seatPosition: 'asc',
          },
        },
        hostPlayer: true,
      },
    });

    if (!lobby) {
      return null;
    }

    return this.toLobbyState(lobby);
  }

  /**
   * Gets a lobby by ID.
   */
  async getLobbyById(lobbyId: string): Promise<LobbyState | null> {
    const db = getDB();

    const lobby = await db.lobby.findUnique({
      where: { id: lobbyId },
      include: {
        lobbyPlayers: {
          include: {
            player: true,
          },
          orderBy: {
            seatPosition: 'asc',
          },
        },
        hostPlayer: true,
      },
    });

    if (!lobby) {
      return null;
    }

    return this.toLobbyState(lobby);
  }

  /**
   * Joins a player to a lobby.
   */
  async joinLobby(input: JoinLobbyInput): Promise<LobbyState> {
    const db = getDB();

    const lobby = await this.getLobbyByCode(input.code);

    if (!lobby) {
      throw new Error('Lobby not found');
    }

    if (lobby.status !== 'WAITING') {
      throw new Error('Lobby is no longer accepting players');
    }

    if (lobby.playerCount >= lobby.settings.maxPlayers) {
      throw new Error('Lobby is full');
    }

    // Check if player is already in the lobby
    const existingPlayer = lobby.players.find(p => p.playerId === input.playerId);
    if (existingPlayer) {
      throw new Error('Already in this lobby');
    }

    // Find next available seat position
    const usedSeats = new Set(lobby.players.map(p => p.seatPosition));
    let nextSeat = 0;
    while (usedSeats.has(nextSeat)) {
      nextSeat++;
    }

    // Add player to lobby
    await db.lobbyPlayer.create({
      data: {
        lobbyId: lobby.id,
        playerId: input.playerId,
        isHost: false,
        seatPosition: nextSeat,
      },
    });

    // Return updated lobby state
    return (await this.getLobbyById(lobby.id))!;
  }

  /**
   * Removes a player from a lobby because they chose to leave.
   *
   * This is the *explicit* exit - pressing Leave Lobby - so it takes effect
   * immediately and never grants a disconnect grace period. An unexpected
   * socket drop goes through lobbyReconnectService instead, which holds the seat
   * and only ends up here if the player never comes back.
   */
  async leaveLobby(lobbyId: string, playerId: string): Promise<LobbyState | null> {
    return this.removePlayerFromLobby(lobbyId, playerId);
  }

  /**
   * Frees a player's seat and settles the consequences.
   *
   * The single removal path, shared by an explicit leave and by a grace period
   * expiring, so the two can never drift apart. Returns the updated lobby, or
   * null when the lobby itself is gone (see below).
   *
   * When the departing player was the host:
   *   - the earliest-joined connected human inherits it;
   *   - failing that, the earliest-joined human still inside their own grace
   *     period inherits it (they hold a seat, and their own timer will settle
   *     things if they never return);
   *   - if only bots are left the lobby is closed, because a bot cannot host,
   *     change settings or deal, and nobody is left to watch it.
   */
  async removePlayerFromLobby(lobbyId: string, playerId: string): Promise<LobbyState | null> {
    const db = getDB();

    const lobby = await this.getLobbyById(lobbyId);
    if (!lobby) {
      throw new Error('Lobby not found');
    }

    const playerInLobby = lobby.players.find(p => p.playerId === playerId);
    if (!playerInLobby) {
      throw new Error('Player not in lobby');
    }

    // Remove player from lobby
    await db.lobbyPlayer.deleteMany({
      where: {
        lobbyId,
        playerId,
      },
    });

    const remainingPlayers = lobby.players.filter(p => p.playerId !== playerId);

    if (remainingPlayers.length === 0) {
      // Delete empty lobby
      await db.lobby.delete({
        where: { id: lobbyId },
      });
      return null;
    }

    // If host left, hand the lobby on - or close it if there is nobody to hand
    // it to.
    if (lobby.hostPlayerId === playerId) {
      const newHost = this.pickNewHost(remainingPlayers);

      if (!newHost) {
        await db.lobby.delete({
          where: { id: lobbyId },
        });
        return null;
      }

      await db.lobby.update({
        where: { id: lobbyId },
        data: { hostPlayerId: newHost.playerId },
      });

      await db.lobbyPlayer.update({
        where: {
          lobbyId_playerId: {
            lobbyId,
            playerId: newHost.playerId,
          },
        },
        data: { isHost: true },
      });
    }

    return this.getLobbyById(lobbyId);
  }

  /**
   * Chooses the next host from whoever is left. Connected humans first, then
   * humans mid-reconnect, never a bot. Null when only bots remain.
   */
  private pickNewHost(remaining: LobbyPlayer[]): LobbyPlayer | null {
    const humans = [...remaining]
      .filter(p => !p.isBot)
      .sort(
        (a, b) =>
          a.joinedAt.getTime() - b.joinedAt.getTime() || a.seatPosition - b.seatPosition
      );

    return humans.find(p => p.connected) ?? humans[0] ?? null;
  }

  /**
   * Kicks a player from the lobby (host only).
   */
  async kickPlayer(lobbyId: string, hostPlayerId: string, targetPlayerId: string): Promise<LobbyState> {
    const lobby = await this.getLobbyById(lobbyId);

    if (!lobby) {
      throw new Error('Lobby not found');
    }

    if (lobby.hostPlayerId !== hostPlayerId) {
      throw new Error('Only the host can kick players');
    }

    if (hostPlayerId === targetPlayerId) {
      throw new Error('Host cannot kick themselves');
    }

    const targetPlayer = lobby.players.find(p => p.playerId === targetPlayerId);
    if (!targetPlayer) {
      throw new Error('Player not in lobby');
    }

    const db = getDB();

    await db.lobbyPlayer.deleteMany({
      where: {
        lobbyId,
        playerId: targetPlayerId,
      },
    });

    return (await this.getLobbyById(lobbyId))!;
  }

  // -------------------------------------------------------------------------
  // Waiting-room connection state
  //
  // These are the persistence half of the disconnect grace period; the timing
  // and race handling live in lobbyReconnect.service.ts.
  // -------------------------------------------------------------------------

  /**
   * Marks a waiting-lobby player as temporarily disconnected, holding their
   * seat until `graceMs` has elapsed.
   *
   * Returns null - meaning "nothing to do, do not start a timer" - for a bot, a
   * lobby that is no longer waiting, a player who is not a member, or a player
   * already marked disconnected (their existing timer still owns the seat).
   */
  async markPlayerDisconnected(
    lobbyId: string,
    playerId: string,
    graceMs: number
  ): Promise<DisconnectMark | null> {
    const db = getDB();

    const row = await db.lobbyPlayer.findUnique({
      where: { lobbyId_playerId: { lobbyId, playerId } },
      include: { player: true, lobby: true },
    });

    if (!row || row.player.isBot || row.lobby.status !== 'WAITING' || !row.connected) {
      return null;
    }

    const disconnectedAt = new Date();
    const reconnectDeadline = new Date(disconnectedAt.getTime() + graceMs);

    const updated = await db.lobbyPlayer.update({
      where: { id: row.id },
      data: {
        connected: false,
        disconnectedAt,
        reconnectDeadline,
        // Every transition gets its own generation, so the timer scheduled
        // against this disconnect can recognise itself as stale later.
        disconnectGeneration: { increment: 1 },
      },
    });

    const lobby = await this.getLobbyById(lobbyId);
    if (!lobby) {
      return null;
    }

    return {
      lobby,
      generation: updated.disconnectGeneration,
      disconnectedAt,
      reconnectDeadline,
    };
  }

  /**
   * Marks a player connected again, clearing their reconnect deadline.
   *
   * `changed` is false when they were already connected, which is the common
   * case for a first-time connect and makes a duplicate "reconnected" broadcast
   * easy to suppress.
   */
  async markPlayerConnected(
    lobbyId: string,
    playerId: string
  ): Promise<{ lobby: LobbyState | null; changed: boolean }> {
    const db = getDB();

    const row = await db.lobbyPlayer.findUnique({
      where: { lobbyId_playerId: { lobbyId, playerId } },
    });

    if (!row) {
      return { lobby: null, changed: false };
    }

    if (row.connected) {
      return { lobby: await this.getLobbyById(lobbyId), changed: false };
    }

    await db.lobbyPlayer.update({
      where: { id: row.id },
      data: {
        connected: true,
        disconnectedAt: null,
        reconnectDeadline: null,
        // Bumping here too invalidates the pending removal timer even if it
        // has already fired and is waiting on this very read.
        disconnectGeneration: { increment: 1 },
      },
    });

    return { lobby: await this.getLobbyById(lobbyId), changed: true };
  }

  /**
   * Reads a membership row fresh from the database, for the checks a removal
   * timer must make before it is allowed to evict anyone.
   */
  async getMembership(lobbyId: string, playerId: string): Promise<LobbyMembership | null> {
    const db = getDB();

    const row = await db.lobbyPlayer.findUnique({
      where: { lobbyId_playerId: { lobbyId, playerId } },
      include: { player: true, lobby: true },
    });

    return row ? this.toMembership(row) : null;
  }

  /**
   * Every held-open seat across all waiting lobbies, with the deadline it is
   * held until. Used on boot to resume (or immediately settle) grace periods
   * whose in-memory timers died with the previous process.
   */
  async getPendingReconnects(): Promise<LobbyMembership[]> {
    const db = getDB();

    const rows = await db.lobbyPlayer.findMany({
      where: {
        connected: false,
        lobby: { status: 'WAITING' },
        player: { isBot: false },
      },
      include: { player: true, lobby: true },
      orderBy: { reconnectDeadline: 'asc' },
    });

    return rows.map(row => this.toMembership(row));
  }

  private toMembership(row: any): LobbyMembership {
    return {
      lobbyId: row.lobbyId,
      lobbyCode: row.lobby.code,
      lobbyStatus: row.lobby.status,
      playerId: row.playerId,
      isBot: row.player.isBot || false,
      isHost: row.isHost,
      connected: row.connected,
      disconnectedAt: row.disconnectedAt,
      reconnectDeadline: row.reconnectDeadline,
      disconnectGeneration: row.disconnectGeneration,
    };
  }

  /**
   * Updates lobby settings (host only).
   */
  async updateSettings(input: UpdateLobbySettingsInput): Promise<LobbyState> {
    const db = getDB();

    const lobby = await this.getLobbyById(input.lobbyId);

    if (!lobby) {
      throw new Error('Lobby not found');
    }

    if (lobby.hostPlayerId !== input.hostPlayerId) {
      throw new Error('Only the host can update settings');
    }

    if (lobby.status !== 'WAITING') {
      throw new Error('Cannot update settings after game has started');
    }

    // Merge with existing settings and validate
    const mergedSettings = { ...lobby.settings, ...input.settings };
    const validation = validateLobbySettings(mergedSettings);

    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }

    // Check if maxPlayers is less than current player count
    if (validation.settings.maxPlayers < lobby.playerCount) {
      throw new Error(`Cannot set max players below current player count (${lobby.playerCount})`);
    }

    await db.lobby.update({
      where: { id: input.lobbyId },
      data: {
        settings: validation.settings as any,
      },
    });

    return (await this.getLobbyById(input.lobbyId))!;
  }

  /**
   * Starts the game (host only).
   */
  async startGame(lobbyId: string, hostPlayerId: string): Promise<{ lobby: LobbyState; gameId: string }> {
    const db = getDB();

    const lobby = await this.getLobbyById(lobbyId);

    if (!lobby) {
      throw new Error('Lobby not found');
    }

    if (lobby.hostPlayerId !== hostPlayerId) {
      throw new Error('Only the host can start the game');
    }

    const startCheck = canStartGame(
      lobby.playerCount,
      lobby.status,
      countDisconnectedHumans(lobby.players)
    );
    if (!startCheck.canStart) {
      throw new Error(startCheck.reason || 'Cannot start game');
    }

    // Update lobby status
    await db.lobby.update({
      where: { id: lobbyId },
      data: { status: 'IN_GAME' },
    });

    // Create game record
    const game = await db.game.create({
      data: {
        lobbyId,
        currentRound: 1,
        status: 'BIDDING',
        gameStateJson: {},
      },
    });

    const updatedLobby = (await this.getLobbyById(lobbyId))!;

    return {
      lobby: updatedLobby,
      gameId: game.id,
    };
  }

  /**
   * Gets the lobby a player is currently in.
   */
  async getPlayerLobby(playerId: string): Promise<LobbyState | null> {
    const db = getDB();

    const lobbyPlayer = await db.lobbyPlayer.findFirst({
      where: { playerId },
      include: {
        lobby: {
          include: {
            lobbyPlayers: {
              include: {
                player: true,
              },
              orderBy: {
                seatPosition: 'asc',
              },
            },
            hostPlayer: true,
          },
        },
      },
    });

    if (!lobbyPlayer) {
      return null;
    }

    return this.toLobbyState(lobbyPlayer.lobby);
  }

  /**
   * Converts database lobby to LobbyState.
   */
  private toLobbyState(lobby: any): LobbyState {
    const settings = lobby.settings as LobbySettings;
    const players: LobbyPlayer[] = lobby.lobbyPlayers.map((lp: any) => {
      const isBot = lp.player.isBot || false;
      return {
        id: lp.id,
        playerId: lp.playerId,
        name: lp.player.name,
        isHost: lp.isHost,
        isBot,
        seatPosition: lp.seatPosition,
        joinedAt: lp.joinedAt,
        // A bot has no socket, so it can never be "reconnecting" - report it as
        // present regardless of what the column happens to hold.
        connected: isBot ? true : lp.connected,
        disconnectedAt: isBot ? null : lp.disconnectedAt ?? null,
        reconnectDeadline: isBot ? null : lp.reconnectDeadline ?? null,
      };
    });

    const playerCount = players.length;
    // A held-open seat still counts towards the lobby's size (so a ninth player
    // cannot steal it) but blocks the deal until its owner is back.
    const startCheck = canStartGame(
      playerCount,
      lobby.status,
      countDisconnectedHumans(players)
    );

    return {
      id: lobby.id,
      code: lobby.code,
      hostPlayerId: lobby.hostPlayerId,
      hostName: lobby.hostPlayer.name,
      status: lobby.status,
      settings,
      players,
      playerCount,
      canStart: startCheck.canStart,
    };
  }
}

// Export singleton instance
export const lobbyService = new LobbyService();

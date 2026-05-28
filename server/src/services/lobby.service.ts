// Lobby service - handles lobby CRUD and player management

import { getDB } from '../db/connection';
import {
  Lobby,
  LobbyState,
  LobbySettings,
  CreateLobbyInput,
  JoinLobbyInput,
  UpdateLobbySettingsInput,
  DEFAULT_LOBBY_SETTINGS,
} from '../types/lobby';
import { LobbyPlayer } from '../types/player';
import { generateLobbyCode, isValidLobbyCode } from '../utils/generateLobbyCode';
import { validateLobbySettings, canStartGame, LOBBY_CONSTRAINTS } from '../utils/validateLobby';
import { playerService } from './player.service';

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
   * Removes a player from a lobby.
   */
  async leaveLobby(lobbyId: string, playerId: string): Promise<LobbyState | null> {
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

    // If host left, handle host transfer or lobby deletion
    if (lobby.hostPlayerId === playerId) {
      const remainingPlayers = lobby.players.filter(p => p.playerId !== playerId);

      if (remainingPlayers.length === 0) {
        // Delete empty lobby
        await db.lobby.delete({
          where: { id: lobbyId },
        });
        return null;
      }

      // Transfer host to next player
      const newHost = remainingPlayers[0];
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

    const startCheck = canStartGame(lobby.playerCount, lobby.status);
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
    const players: LobbyPlayer[] = lobby.lobbyPlayers.map((lp: any) => ({
      id: lp.id,
      playerId: lp.playerId,
      name: lp.player.name,
      isHost: lp.isHost,
      isBot: lp.player.isBot || false,
      seatPosition: lp.seatPosition,
      joinedAt: lp.joinedAt,
    }));

    const playerCount = players.length;
    const startCheck = canStartGame(playerCount, lobby.status);

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

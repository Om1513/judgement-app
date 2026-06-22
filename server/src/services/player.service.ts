// Player service - handles player CRUD operations

import { getDB } from '../db/connection';
import { Player, CreatePlayerInput, UpdatePlayerInput } from '../types/player';
import { validatePlayerName } from '../utils/validateLobby';

export class PlayerService {
  /**
   * Creates a new player.
   */
  async createPlayer(input: CreatePlayerInput): Promise<Player> {
    const db = getDB();

    // Validate name
    const nameValidation = validatePlayerName(input.name);
    if (!nameValidation.valid) {
      throw new Error(nameValidation.error || 'Invalid player name');
    }

    const player = await db.player.create({
      data: {
        name: nameValidation.sanitized,
        clientId: input.clientId || null,
        socketId: input.socketId || null,
        isBot: input.isBot || false,
        botDifficulty: input.botDifficulty || null,
      },
    });

    return this.toPlayer(player);
  }

  /**
   * Gets a player by ID.
   */
  async getPlayerById(playerId: string): Promise<Player | null> {
    const db = getDB();

    const player = await db.player.findUnique({
      where: { id: playerId },
    });

    return player ? this.toPlayer(player) : null;
  }

  /**
   * Gets a player by socket ID.
   */
  async getPlayerBySocketId(socketId: string): Promise<Player | null> {
    const db = getDB();

    const player = await db.player.findUnique({
      where: { socketId },
    });

    return player ? this.toPlayer(player) : null;
  }

  /**
   * Gets a player by their stable client ID.
   */
  async getPlayerByClientId(clientId: string): Promise<Player | null> {
    const db = getDB();

    const player = await db.player.findUnique({
      where: { clientId },
    });

    return player ? this.toPlayer(player) : null;
  }

  /**
   * Maps a Prisma player row to the Player domain type.
   */
  private toPlayer(player: {
    id: string;
    name: string;
    clientId: string | null;
    socketId: string | null;
    isBot: boolean;
    botDifficulty: string | null;
    createdAt: Date;
  }): Player {
    return {
      id: player.id,
      name: player.name,
      clientId: player.clientId,
      socketId: player.socketId,
      isBot: player.isBot,
      botDifficulty: player.botDifficulty,
      createdAt: player.createdAt,
    };
  }

  /**
   * Updates a player.
   */
  async updatePlayer(playerId: string, input: UpdatePlayerInput): Promise<Player> {
    const db = getDB();

    const updateData: any = {};

    if (input.name !== undefined) {
      const nameValidation = validatePlayerName(input.name);
      if (!nameValidation.valid) {
        throw new Error(nameValidation.error || 'Invalid player name');
      }
      updateData.name = nameValidation.sanitized;
    }

    if (input.socketId !== undefined) {
      updateData.socketId = input.socketId;
    }

    if (input.clientId !== undefined) {
      updateData.clientId = input.clientId;
    }

    const player = await db.player.update({
      where: { id: playerId },
      data: updateData,
    });

    return this.toPlayer(player);
  }

  /**
   * Updates player's socket ID.
   */
  async updateSocketId(playerId: string, socketId: string | null): Promise<Player> {
    return this.updatePlayer(playerId, { socketId });
  }

  /**
   * Resolves the player for a (re)connecting socket.
   *
   * Identity is keyed on the stable, client-generated `clientId` so a player
   * keeps the same Player row (and therefore their lobby seat / hand) across
   * reconnects, network switches and new socket ids. The `socketId` is just the
   * current live connection and is refreshed here on every connect.
   *
   * Falls back to socket-id matching when no clientId is supplied (older
   * clients), preserving previous behaviour.
   */
  async getOrCreatePlayer(
    name: string,
    socketId: string,
    clientId?: string | null
  ): Promise<Player> {
    if (clientId) {
      const existing = await this.getPlayerByClientId(clientId);
      if (existing) {
        // Returning player: refresh their live socket and name.
        return this.updatePlayer(existing.id, { socketId, name });
      }
      // First time we've seen this clientId: create and bind it.
      return this.createPlayer({ name, socketId, clientId });
    }

    // Legacy path: no stable identity supplied, match on socket id.
    const existingPlayer = await this.getPlayerBySocketId(socketId);
    if (existingPlayer) {
      if (existingPlayer.name !== name) {
        return this.updatePlayer(existingPlayer.id, { name });
      }
      return existingPlayer;
    }

    return this.createPlayer({ name, socketId });
  }

  /**
   * Clears socket ID when player disconnects.
   */
  async handleDisconnect(socketId: string): Promise<Player | null> {
    const player = await this.getPlayerBySocketId(socketId);

    if (!player) {
      return null;
    }

    return this.updateSocketId(player.id, null);
  }

  /**
   * Deletes a player.
   */
  async deletePlayer(playerId: string): Promise<void> {
    const db = getDB();

    await db.player.delete({
      where: { id: playerId },
    });
  }
}

// Export singleton instance
export const playerService = new PlayerService();

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
        socketId: input.socketId || null,
      },
    });

    return {
      id: player.id,
      name: player.name,
      socketId: player.socketId,
      createdAt: player.createdAt,
    };
  }

  /**
   * Gets a player by ID.
   */
  async getPlayerById(playerId: string): Promise<Player | null> {
    const db = getDB();

    const player = await db.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      return null;
    }

    return {
      id: player.id,
      name: player.name,
      socketId: player.socketId,
      createdAt: player.createdAt,
    };
  }

  /**
   * Gets a player by socket ID.
   */
  async getPlayerBySocketId(socketId: string): Promise<Player | null> {
    const db = getDB();

    const player = await db.player.findUnique({
      where: { socketId },
    });

    if (!player) {
      return null;
    }

    return {
      id: player.id,
      name: player.name,
      socketId: player.socketId,
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

    const player = await db.player.update({
      where: { id: playerId },
      data: updateData,
    });

    return {
      id: player.id,
      name: player.name,
      socketId: player.socketId,
      createdAt: player.createdAt,
    };
  }

  /**
   * Updates player's socket ID.
   */
  async updateSocketId(playerId: string, socketId: string | null): Promise<Player> {
    return this.updatePlayer(playerId, { socketId });
  }

  /**
   * Gets or creates a player by name.
   * If a player with the same socket exists, updates their name.
   */
  async getOrCreatePlayer(name: string, socketId: string): Promise<Player> {
    const db = getDB();

    // Check if player with this socket exists
    const existingPlayer = await this.getPlayerBySocketId(socketId);

    if (existingPlayer) {
      // Update name if different
      if (existingPlayer.name !== name) {
        return this.updatePlayer(existingPlayer.id, { name });
      }
      return existingPlayer;
    }

    // Create new player
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

// Socket.IO lobby event handlers

import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  SocketErrorCodes,
} from '../types/socket';
import { LobbyState } from '../types/lobby';
import { lobbyService } from '../services/lobby.service';
import { lobbyReconnectService } from '../services/lobbyReconnect.service';
import { gameReconnectService } from '../services/gameReconnect.service';
import { gameService } from '../services/game.service';
import { botService } from '../services/bot.service';
import { isGameFinished } from './game.events';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Gives the lobby reconnect service its Socket.IO-backed effects: how to tell
 * whether a player is really still connected, and how to tell the room about a
 * seat being held, reclaimed or given up.
 *
 * Called once per server from initializeSocket, so listeners and hooks cannot
 * accumulate per connection.
 */
export function attachLobbyReconnect(io: TypedServer): void {
  lobbyReconnectService.attach({
    async hasLiveSocket(lobbyCode, playerId, excludeSocketId) {
      const sockets = await io.in(`lobby:${lobbyCode}`).fetchSockets();
      return sockets.some(s => s.data.playerId === playerId && s.id !== excludeSocketId);
    },

    onDisconnected(lobby, player, reconnectDeadline) {
      console.log(
        `Player ${player.name} dropped out of lobby ${lobby.code}; ` +
          `holding their seat until ${reconnectDeadline.toISOString()}`
      );

      io.to(`lobby:${lobby.code}`).emit('lobby:player-disconnected', {
        playerId: player.playerId,
        playerName: player.name,
        reconnectDeadline: reconnectDeadline.toISOString(),
        lobby,
      });
      io.to(`lobby:${lobby.code}`).emit('lobby:update', { lobby });
    },

    onReconnected(lobby, player) {
      console.log(`Player ${player.name} reclaimed their seat in lobby ${lobby.code}`);

      io.to(`lobby:${lobby.code}`).emit('lobby:player-reconnected', {
        playerId: player.playerId,
        playerName: player.name,
        lobby,
      });
      io.to(`lobby:${lobby.code}`).emit('lobby:update', { lobby });
    },

    onExpired(lobbyCode, playerId, lobby) {
      console.log(`Grace period expired for ${playerId} in lobby ${lobbyCode}`);

      // A null lobby means it was closed along with the seat, so there is
      // nobody left in the room to tell.
      if (!lobby) {
        return;
      }

      io.to(`lobby:${lobbyCode}`).emit('lobby:player-left', { playerId, lobby });
      io.to(`lobby:${lobbyCode}`).emit('lobby:update', { lobby });
    },
  });
}

/**
 * Registers lobby-related socket event handlers.
 */
export function registerLobbyEvents(io: TypedServer, socket: TypedSocket): void {
  /**
   * Creates a new lobby.
   * The socket's player becomes the host.
   */
  socket.on('lobby:create', async (data) => {
    try {
      const { playerName, settings } = data;

      if (!socket.data.playerId) {
        socket.emit('lobby:error', {
          message: 'Not connected. Please reconnect.',
          code: SocketErrorCodes.PLAYER_NOT_FOUND,
        });
        return;
      }

      // Check if player is already in a lobby
      const existingLobby = await lobbyService.getPlayerLobby(socket.data.playerId);
      if (existingLobby) {
        socket.emit('lobby:error', {
          message: 'Already in a lobby. Leave first to create a new one.',
          code: SocketErrorCodes.ALREADY_IN_LOBBY,
        });
        return;
      }

      // Create the lobby
      const lobby = await lobbyService.createLobby({
        hostPlayerId: socket.data.playerId,
        hostName: playerName || socket.data.playerName,
        settings,
      });

      // Update socket data
      socket.data.lobbyId = lobby.id;

      // Join the Socket.IO room
      void socket.join(`lobby:${lobby.code}`);

      console.log(`Player ${socket.data.playerName} created lobby ${lobby.code}`);

      // Send lobby created event
      socket.emit('lobby:created', { lobby });
    } catch (error) {
      console.error('Error creating lobby:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to create lobby',
        code: SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Joins an existing lobby.
   */
  socket.on('lobby:join', async (data) => {
    try {
      const { code, playerName } = data;

      if (!socket.data.playerId) {
        socket.emit('lobby:error', {
          message: 'Not connected. Please reconnect.',
          code: SocketErrorCodes.PLAYER_NOT_FOUND,
        });
        return;
      }

      const requestedCode = code.toUpperCase();

      // Check if player is already in a lobby
      const existingLobby = await lobbyService.getPlayerLobby(socket.data.playerId);
      if (existingLobby) {
        // Re-entering the lobby they already hold a seat in - a player who
        // dropped out and is punching the code back in rather than letting the
        // automatic reconnect finish. Identity here is the playerId resolved
        // from their stable clientId, never their name, so two players with
        // similar names cannot claim each other's seat. Give them their own seat
        // back instead of an error.
        if (existingLobby.code === requestedCode && existingLobby.status === 'WAITING') {
          socket.data.lobbyId = existingLobby.id;
          void socket.join(`lobby:${existingLobby.code}`);

          const restored = await lobbyReconnectService.restorePlayer(
            existingLobby,
            socket.data.playerId
          );
          const lobby = restored ?? existingLobby;

          console.log(`Player ${socket.data.playerName} rejoined lobby ${lobby.code} by code`);

          socket.emit('lobby:joined', { lobby });
          // restorePlayer already broadcast the change when there was one.
          if (!restored) {
            io.to(`lobby:${lobby.code}`).emit('lobby:update', { lobby });
          }
          return;
        }

        socket.emit('lobby:error', {
          message: 'Already in a lobby. Leave first to join another.',
          code: SocketErrorCodes.ALREADY_IN_LOBBY,
        });
        return;
      }

      // Find the lobby
      const lobbyBefore = await lobbyService.getLobbyByCode(requestedCode);
      if (!lobbyBefore) {
        socket.emit('lobby:error', {
          message: 'Lobby not found. Check the code and try again.',
          code: SocketErrorCodes.LOBBY_NOT_FOUND,
        });
        return;
      }

      // Join the lobby
      const lobby = await lobbyService.joinLobby({
        code: requestedCode,
        playerId: socket.data.playerId,
        playerName: playerName || socket.data.playerName,
      });

      // Update socket data
      socket.data.lobbyId = lobby.id;

      // Join the Socket.IO room
      void socket.join(`lobby:${lobby.code}`);

      console.log(`Player ${socket.data.playerName} joined lobby ${lobby.code}`);

      // Send joined event to this player
      socket.emit('lobby:joined', { lobby });

      // Notify other players in the lobby
      socket.to(`lobby:${lobby.code}`).emit('lobby:player-joined', {
        player: { id: socket.data.playerId, name: socket.data.playerName },
        lobby,
      });

      // Broadcast updated lobby state to all
      io.to(`lobby:${lobby.code}`).emit('lobby:update', { lobby });
    } catch (error) {
      console.error('Error joining lobby:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to join lobby',
        code: SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Leaves the current lobby.
   */
  socket.on('lobby:leave', async () => {
    try {
      if (!socket.data.playerId || !socket.data.lobbyId) {
        socket.emit('lobby:error', {
          message: 'Not in a lobby',
          code: SocketErrorCodes.LOBBY_NOT_FOUND,
        });
        return;
      }

      const lobby = await lobbyService.getLobbyById(socket.data.lobbyId);
      if (!lobby) {
        socket.data.lobbyId = null;
        return;
      }

      const lobbyCode = lobby.code;
      const lobbyId = socket.data.lobbyId;

      // Pressing Leave Lobby / Leave Game is deliberate, so it takes effect now:
      // no grace period, and any timer left over from an earlier drop is dropped
      // with it.
      lobbyReconnectService.cancelGracePeriod(lobbyId, socket.data.playerId);
      gameReconnectService.cancelGracePeriod(lobbyId, socket.data.playerId);

      // Walking out of a game that is under way is not the same as walking out of
      // a lobby. The other players are mid-round with cards already dealt, so the
      // seat cannot simply vanish - deleting it would leave the table waiting
      // forever on a turn nobody can take. It is exactly the DISCARD case: the
      // player is done with this game, and the bot finishes their hands.
      if (lobby.status === 'IN_GAME') {
        await handleLeaveDuringGame(io, socket, lobby);
        return;
      }

      // Leave the lobby
      const updatedLobby = await lobbyService.leaveLobby(lobbyId, socket.data.playerId);

      // Leave the Socket.IO room
      void socket.leave(`lobby:${lobbyCode}`);

      console.log(`Player ${socket.data.playerName} left lobby ${lobbyCode}`);

      // Clear socket data
      socket.data.lobbyId = null;
      socket.data.gameId = null;

      // Notify remaining players
      if (updatedLobby) {
        io.to(`lobby:${lobbyCode}`).emit('lobby:player-left', {
          playerId: socket.data.playerId,
          lobby: updatedLobby,
        });
        io.to(`lobby:${lobbyCode}`).emit('lobby:update', { lobby: updatedLobby });
      } else {
        // The lobby went with them - nothing left to hold a seat in.
        lobbyReconnectService.cancelLobby(lobbyId);
      }
    } catch (error) {
      console.error('Error leaving lobby:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to leave lobby',
        code: SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Kicks a player from the lobby (host only).
   */
  socket.on('lobby:kick-player', async (data) => {
    try {
      const { playerId: targetPlayerId } = data;

      if (!socket.data.playerId || !socket.data.lobbyId) {
        socket.emit('lobby:error', {
          message: 'Not in a lobby',
          code: SocketErrorCodes.LOBBY_NOT_FOUND,
        });
        return;
      }

      const lobby = await lobbyService.kickPlayer(
        socket.data.lobbyId,
        socket.data.playerId,
        targetPlayerId
      );

      // A kick is immediate and final. Dropping the target's grace-period timer
      // stops it lingering, and because their membership row is now gone they
      // have nothing to reclaim if they do reconnect - restoreSession finds no
      // lobby for them and restores nothing. Done only once the kick has
      // actually succeeded, so a rejected kick cannot strand a held seat.
      lobbyReconnectService.cancelGracePeriod(socket.data.lobbyId, targetPlayerId);
      gameReconnectService.cancelGracePeriod(socket.data.lobbyId, targetPlayerId);

      console.log(`Host ${socket.data.playerName} kicked player ${targetPlayerId} from lobby ${lobby.code}`);

      // Find the kicked player's socket and notify them. Bots have no socket,
      // so this loop simply finds no match for them - no error.
      const sockets = await io.in(`lobby:${lobby.code}`).fetchSockets();
      for (const s of sockets) {
        if (s.data.playerId === targetPlayerId) {
          s.emit('lobby:kicked', { message: 'You have been removed from the lobby by the host.' });
          s.leave(`lobby:${lobby.code}`);
          s.data.lobbyId = null;
          s.data.gameId = null;
          break;
        }
      }

      // Broadcast updated lobby state
      io.to(`lobby:${lobby.code}`).emit('lobby:update', { lobby });
    } catch (error) {
      console.error('Error kicking player:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to kick player',
        code: error instanceof Error && error.message.includes('host')
          ? SocketErrorCodes.NOT_HOST
          : SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Adds a bot to the lobby (host only).
   */
  socket.on('lobby:add-bot', async () => {
    try {
      if (!socket.data.playerId || !socket.data.lobbyId) {
        socket.emit('lobby:error', {
          message: 'Not in a lobby',
          code: SocketErrorCodes.LOBBY_NOT_FOUND,
        });
        return;
      }

      // Add bot to lobby
      const botPlayer = await botService.addBotToLobby(
        socket.data.lobbyId,
        socket.data.playerId
      );

      // Get updated lobby state
      const lobby = await lobbyService.getLobbyById(socket.data.lobbyId);
      if (!lobby) {
        throw new Error('Lobby not found after adding bot');
      }

      console.log(`Bot ${botPlayer.name} added to lobby ${lobby.code}`);

      // Broadcast updated lobby state
      io.to(`lobby:${lobby.code}`).emit('lobby:update', { lobby });
    } catch (error) {
      console.error('Error adding bot:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to add bot',
        code: error instanceof Error && error.message.includes('host')
          ? SocketErrorCodes.NOT_HOST
          : SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Updates lobby settings (host only).
   */
  socket.on('lobby:update-settings', async (data) => {
    try {
      const { settings } = data;

      if (!socket.data.playerId || !socket.data.lobbyId) {
        socket.emit('lobby:error', {
          message: 'Not in a lobby',
          code: SocketErrorCodes.LOBBY_NOT_FOUND,
        });
        return;
      }

      const lobby = await lobbyService.updateSettings({
        lobbyId: socket.data.lobbyId,
        hostPlayerId: socket.data.playerId,
        settings,
      });

      console.log(`Host ${socket.data.playerName} updated settings for lobby ${lobby.code}`);

      // Broadcast updated lobby state
      io.to(`lobby:${lobby.code}`).emit('lobby:update', { lobby });
    } catch (error) {
      console.error('Error updating settings:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to update settings',
        code: error instanceof Error && error.message.includes('host')
          ? SocketErrorCodes.NOT_HOST
          : SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Starts the game (host only).
   */
  socket.on('lobby:start-game', async () => {
    try {
      if (!socket.data.playerId || !socket.data.lobbyId) {
        socket.emit('lobby:error', {
          message: 'Not in a lobby',
          code: SocketErrorCodes.LOBBY_NOT_FOUND,
        });
        return;
      }

      // Start the game. This refuses while any human is inside a disconnect
      // grace period - dealing a hand to somebody who is not at the table would
      // strand their cards for the whole round.
      const { lobby, gameId } = await lobbyService.startGame(
        socket.data.lobbyId,
        socket.data.playerId
      );

      // Waiting-room grace periods end here: from now on a disconnect is an
      // in-game disconnect, and no lobby timer may remove a seated player.
      lobbyReconnectService.cancelLobby(lobby.id);

      // Initialize game state
      await gameService.initializeGame(gameId, lobby.id);

      console.log(`Game started in lobby ${lobby.code}`);

      // Update all sockets in the lobby with game ID
      const sockets = await io.in(`lobby:${lobby.code}`).fetchSockets();
      for (const s of sockets) {
        s.data.gameId = gameId;
      }

      // Send personalized game state to each player (hiding others' cards)
      const game = await gameService.getGameById(gameId);
      if (game) {
        const presence = await gameService.getPresence(lobby.id);
        for (const s of sockets) {
          const clientState = gameService.getClientGameState(game, s.data.playerId, presence);
          s.emit('game:started', { gameState: clientState });
        }
      }

      // Process pending bot actions (if first player is a bot)
      await botService.processPendingBotActions(gameId);
    } catch (error) {
      console.error('Error starting game:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to start game',
        code: error instanceof Error && error.message.includes('host')
          ? SocketErrorCodes.NOT_HOST
          : SocketErrorCodes.INVALID_ACTION,
      });
    }
  });
}

/**
 * Walking out of a game that is under way.
 *
 * Explicit and immediate - no grace period and no later automatic restoration -
 * but the seat is not deleted: the game keeps its player count, its turn order
 * and its dealt hands, and the bot plays out the seat exactly as it would after a
 * takeover. Recorded as a discard, so reopening the app lands on Home rather
 * than offering back a game they chose to walk out of.
 *
 * A finished game has none of those constraints, so leaving one still removes the
 * membership normally - the caller only routes here while the lobby is IN_GAME
 * with a live game.
 */
async function handleLeaveDuringGame(
  io: TypedServer,
  socket: TypedSocket,
  lobby: LobbyState
): Promise<void> {
  const playerId = socket.data.playerId;
  const game = await gameService.getGameByLobbyId(lobby.id);

  if (game && !isGameFinished(game.gameState.status)) {
    await gameReconnectService.discard(lobby, playerId);
    console.log(`Player ${socket.data.playerName} left game in lobby ${lobby.code}`);
  } else {
    // The game is over; the seat has no hands left to play, so it can go.
    const updated = await lobbyService.leaveLobby(lobby.id, playerId);
    if (updated) {
      io.to(`lobby:${lobby.code}`).emit('lobby:player-left', { playerId, lobby: updated });
      io.to(`lobby:${lobby.code}`).emit('lobby:update', { lobby: updated });
    } else {
      lobbyReconnectService.cancelLobby(lobby.id);
      gameReconnectService.cancelLobby(lobby.id);
    }
  }

  void socket.leave(`lobby:${lobby.code}`);
  socket.data.lobbyId = null;
  socket.data.gameId = null;
}

/**
 * Handles an unexpected socket drop from a lobby.
 *
 * Nobody is removed here. A player sitting in a waiting lobby keeps their seat -
 * name, position, host status and all - for the grace period, and is shown to
 * the rest of the room as reconnecting; lobbyReconnectService removes them only
 * if they never come back. An explicit Leave Lobby does not come through this
 * path, so it stays immediate.
 *
 * A game already in progress is untouched, exactly as before: the player stays
 * seated and handleGameDisconnect deals with it.
 *
 * Note this handler is registered once per socket by initializeSocket, and the
 * broadcast side lives in the hooks installed by attachLobbyReconnect, so
 * nothing here accumulates listeners.
 */
export async function handleLobbyDisconnect(
  _io: TypedServer,
  socket: TypedSocket
): Promise<void> {
  if (!socket.data.lobbyId || !socket.data.playerId) {
    return;
  }

  try {
    const lobby = await lobbyService.getLobbyById(socket.data.lobbyId);
    if (!lobby || lobby.status !== 'WAITING') {
      return;
    }

    // Passing this socket's id lets the service ignore a disconnect that arrives
    // late for a connection the player has already replaced.
    await lobbyReconnectService.startGracePeriod(lobby, socket.data.playerId, socket.id);
  } catch (error) {
    console.error('Error handling lobby disconnect:', error);
  }
}

// Socket.IO main setup and event registration

import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  SessionRestorePayload,
} from '../types/socket';
import { LobbyState } from '../types/lobby';
import { playerService } from '../services/player.service';
import { lobbyService } from '../services/lobby.service';
import { gameService } from '../services/game.service';
import { scoreboardService } from '../services/scoreboard.service';
import { botService } from '../services/bot.service';
import { lobbyReconnectService } from '../services/lobbyReconnect.service';
import { gameReconnectService } from '../services/gameReconnect.service';
import { registerLobbyEvents, handleLobbyDisconnect, attachLobbyReconnect } from './lobby.events';
import {
  registerGameEvents,
  handleGameDisconnect,
  attachGameReconnect,
  isGameFinished,
} from './game.events';
import { registerScoreboardEvents } from './scoreboard.events';
import { getCorsOrigin } from '../utils/corsOrigin';
import { perfEnabled, perfLog } from '../utils/perf';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

let io: TypedServer;

/**
 * Initializes Socket.IO server.
 */
export function initializeSocket(httpServer: HTTPServer): TypedServer {
  io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      cors: {
        origin: getCorsOrigin(),
        methods: ['GET', 'POST'],
        credentials: getCorsOrigin() !== '*',
      },
      // Ping settings for mobile connections
      pingInterval: 25000,
      pingTimeout: 60000,
      // Transport settings
      transports: ['websocket', 'polling'],
    }
  );

  // Give both grace periods their socket-backed effects. Done once here, not per
  // connection, so hooks and timers cannot accumulate.
  attachLobbyReconnect(io);
  attachGameReconnect(io);

  // Connection handler
  io.on('connection', async (socket: TypedSocket) => {
    console.log(`New connection: ${socket.id}`);

    // Observability: which transport did this client land on, and did it
    // upgrade to WebSocket? (Enabled only when PERF_LOG is set.)
    if (perfEnabled) {
      perfLog('socket connected', {
        id: socket.id,
        transport: socket.conn.transport.name,
      });
      socket.conn.on('upgrade', () => {
        perfLog('socket transport upgraded', {
          id: socket.id,
          transport: socket.conn.transport.name,
        });
      });
    }

    // Initialize socket data
    socket.data.playerId = '';
    socket.data.playerName = '';
    socket.data.lobbyId = null;
    socket.data.gameId = null;

    // Handle player connection with name
    socket.on('player:connect', async (data) => {
      try {
        const { name, clientId } = data;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
          socket.emit('error', { message: 'Name is required' });
          return;
        }

        // Resolve identity by stable clientId (survives reconnects).
        const player = await playerService.getOrCreatePlayer(
          name.trim(),
          socket.id,
          typeof clientId === 'string' && clientId.length > 0 ? clientId : null
        );

        // Store player info in socket data
        socket.data.playerId = player.id;
        socket.data.playerName = player.name;

        console.log(`Player connected: ${player.name} (${player.id})`);

        // Restore an in-flight session (lobby / active game) for a returning
        // player, then tell them whether this was a fresh connect or a recovery.
        // The session answer goes out first, so a client that is waiting for one
        // has it in hand by the time `connected` resolves its connect() call.
        const session = await restoreSession(socket);
        socket.emit('connected', { playerId: player.id, reconnected: session.restored });
      } catch (error) {
        console.error('Error connecting player:', error);
        socket.emit('error', {
          message: error instanceof Error ? error.message : 'Failed to connect',
        });
      }
    });

    // Register event handlers
    registerLobbyEvents(io, socket);
    registerGameEvents(io, socket);
    registerScoreboardEvents(io, socket);
    registerSessionEvents(io, socket);

    // Handle disconnection
    socket.on('disconnect', async (reason) => {
      console.log(`Disconnected: ${socket.id} (${reason})`);

      // Handle lobby/game cleanup
      await handleLobbyDisconnect(io, socket);
      await handleGameDisconnect(io, socket);

      // Clear player's socket ID
      if (socket.data.playerId) {
        try {
          await playerService.handleDisconnect(socket.id);
        } catch (error) {
          console.error('Error handling disconnect:', error);
        }
      }
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });

  // Initialize bot service with Socket.IO server
  botService.setIO(io);

  console.log('Socket.IO initialized');

  return io;
}

/** The answer for a connection with nothing to come back to. */
function noSession(reason: SessionRestorePayload['reason']): SessionRestorePayload {
  return { restored: false, reason, lobby: null, gameState: null };
}

/**
 * Restores an in-flight session for a (re)connecting socket.
 *
 * If the player is still a member of a lobby (and possibly an active game),
 * this re-attaches the socket to the lobby room, repopulates socket.data, and
 * pushes the current lobby/game state so the client can resume where it left
 * off after a disconnect, app background, WiFi<->mobile-data switch, or the app
 * being killed outright and reopened.
 *
 * This is also where a disconnect grace period is cancelled - the waiting-room
 * one and the in-game one alike. The player is identified by the playerId their
 * stable clientId resolved to, so they get *their* existing seat back rather
 * than a new one, and the pending removal/takeover is dropped before it can fire.
 *
 * The one thing it deliberately does NOT do is put somebody back into a game the
 * bot has already taken over. Bids and cards have been played in their name by
 * then, so re-entry is their decision: the answer is REJOIN_AVAILABLE, carrying
 * no game state at all, and they come back only via `session:rejoin`.
 *
 * Always emits `session:restore`, including when there is nothing to restore -
 * a cold-started client is waiting for that answer before it decides which
 * screen to open, and silence is indistinguishable from an unreachable server.
 * The negative reasons are kept apart for the same purpose: only
 * SESSION_NOT_FOUND and SESSION_DISCARDED mean "forget your saved session".
 *
 * Returns the payload that was sent.
 */
async function restoreSession(socket: TypedSocket): Promise<SessionRestorePayload> {
  const answer = (payload: SessionRestorePayload): SessionRestorePayload => {
    socket.emit('session:restore', payload);
    return payload;
  };

  if (!socket.data.playerId) {
    return answer(noSession('SESSION_NOT_FOUND'));
  }

  try {
    const found = await lobbyService.getPlayerLobby(socket.data.playerId);
    if (!found) {
      return answer(noSession('SESSION_NOT_FOUND'));
    }

    if (found.status === 'IN_GAME') {
      const outcome = await gameReconnectService.restorePlayer(found, socket.data.playerId);

      if (outcome.mode === 'DISCARDED') {
        // They said they were not coming back to this game. Authoritative and
        // final: no room, no state, nothing to prompt about. Deliberately not
        // joined to the lobby room either - a discarded player should not keep
        // receiving the table's broadcasts.
        console.log(
          `${socket.data.playerName} has discarded their session in lobby ${found.code}`
        );
        return answer(noSession('SESSION_DISCARDED'));
      }

      if (outcome.mode === 'REJOIN_AVAILABLE') {
        const game = await gameService.getGameByLobbyId(found.id);

        // A game that has since finished is not something to "rejoin" - fall
        // through to the ordinary restore so they land on the final scoreboard.
        if (game && !isGameFinished(game.gameState.status)) {
          console.log(
            `${socket.data.playerName} has a game waiting in lobby ${found.code}; ` +
              'offering rejoin'
          );
          return answer({
            restored: false,
            reason: 'REJOIN_AVAILABLE',
            lobby: null,
            gameState: null,
            rejoin: {
              gameId: game.id,
              lobbyCode: found.code,
              status: game.gameState.status,
              currentRound: game.gameState.currentRound,
              totalRounds: game.gameState.totalRounds,
            },
          });
        }
      }
    }

    // Re-join the room so future broadcasts reach this socket again - and so
    // the reconnect services can see that this player is live again.
    socket.data.lobbyId = found.id;
    void socket.join(`lobby:${found.code}`);

    // Reclaim a held waiting-room seat, if this player had one. Returns the
    // refreshed lobby (and has already told the room); null means there was
    // nothing to reclaim, which is the normal case for a first connect.
    const lobby =
      found.status === 'WAITING'
        ? (await lobbyReconnectService.restorePlayer(found, socket.data.playerId)) ?? found
        : (await lobbyService.getLobbyById(found.id)) ?? found;

    const payload = await buildRestoredSession(socket, lobby);

    console.log(
      `Restored session for ${socket.data.playerName} -> lobby ${lobby.code}` +
        (payload.gameState ? ` (in game, ${payload.gameState.status})` : '')
    );

    // Tell the client what to resume, and also refresh any already-mounted
    // screens that listen for the standard update events. Deliberately never a
    // join event: a reconnect is not a new join, so no join feedback replays.
    socket.emit('session:restore', payload);
    socket.emit('lobby:update', { lobby: payload.lobby! });
    if (payload.gameState) {
      socket.emit('game:update', { gameState: payload.gameState });
    }

    return payload;
  } catch (error) {
    // Deliberately not SESSION_NOT_FOUND: the player may well still have a seat,
    // and telling the client otherwise would make it throw away a valid saved
    // session over a transient database problem.
    console.error('Error restoring session:', error);
    return answer(noSession('RESTORE_FAILED'));
  }
}

/**
 * Assembles the "you are in, here is where" payload for a player who is entitled
 * to it, and points socket.data at the game.
 *
 * The game state is the same per-player view used during normal play - their own
 * hand, and only card *counts* for everyone else - so restoration never becomes
 * a way to see the table's cards. Shared by the automatic restore and by an
 * explicit rejoin, so the two cannot disagree about what a player gets back.
 */
async function buildRestoredSession(
  socket: TypedSocket,
  lobby: LobbyState
): Promise<SessionRestorePayload> {
  let gameState = null;
  let scoreboard = null;

  if (lobby.status === 'IN_GAME') {
    const game = await gameService.getGameByLobbyId(lobby.id);
    if (game) {
      socket.data.gameId = game.id;
      const presence = await gameService.getPresence(lobby.id);
      gameState = gameService.getClientGameState(game, socket.data.playerId, presence);

      // Between rounds the game screen is the scoreboard, and the client
      // cannot render it from gameState alone. Fetching it here (rather than
      // letting the client ask afterwards) is what stops a cold start landing
      // on an empty scoreboard for a beat.
      if (
        game.gameState.status === 'ROUND_SCOREBOARD' ||
        game.gameState.status === 'ROUND_COMPLETE'
      ) {
        scoreboard = await scoreboardService.getScoreboardState(game.id);
      }
    }
  }

  return { restored: true, lobby, gameState, scoreboard };
}

/**
 * Registers the two answers to a REJOIN_AVAILABLE offer.
 *
 * Both are keyed on the identity this connection already established, never on
 * anything the client names: a socket cannot claim to be player X in game Y, it
 * can only accept or decline whatever is actually being held for whoever it has
 * proved itself to be.
 */
function registerSessionEvents(io: TypedServer, socket: TypedSocket): void {
  /**
   * REJOIN GAME: take the bot off my seat and give me the current state.
   */
  socket.on('session:rejoin', async () => {
    try {
      if (!socket.data.playerId) {
        socket.emit('session:restore', noSession('SESSION_NOT_FOUND'));
        return;
      }

      const found = await lobbyService.getPlayerLobby(socket.data.playerId);
      if (!found) {
        socket.emit('session:restore', noSession('SESSION_NOT_FOUND'));
        return;
      }

      // Back in the room first, so the broadcast the rejoin triggers reaches
      // them along with everyone else.
      socket.data.lobbyId = found.id;
      void socket.join(`lobby:${found.code}`);

      const rejoined = (await gameReconnectService.rejoin(found, socket.data.playerId)) ?? found;
      const payload = await buildRestoredSession(socket, rejoined);

      console.log(`${socket.data.playerName} rejoined lobby ${rejoined.code}`);

      socket.emit('session:restore', payload);
      socket.emit('lobby:update', { lobby: payload.lobby! });
      if (payload.gameState) {
        socket.emit('game:update', { gameState: payload.gameState });
      }
    } catch (error) {
      console.error('Error rejoining game:', error);
      socket.emit('session:restore', noSession('RESTORE_FAILED'));
    }
  });

  /**
   * DISCARD: I am not coming back to this game.
   *
   * The game itself is untouched - the bot keeps the seat and the other players
   * play on. Only this player's claim on it ends.
   */
  socket.on('session:discard', async () => {
    try {
      if (!socket.data.playerId) {
        socket.emit('session:restore', noSession('SESSION_NOT_FOUND'));
        return;
      }

      const found = await lobbyService.getPlayerLobby(socket.data.playerId);
      if (!found) {
        socket.emit('session:restore', noSession('SESSION_NOT_FOUND'));
        return;
      }

      if (found.status === 'IN_GAME') {
        await gameReconnectService.discard(found, socket.data.playerId);
      } else {
        // Discarding a lobby they never got into a game with is just leaving it.
        lobbyReconnectService.cancelGracePeriod(found.id, socket.data.playerId);
        const updated = await lobbyService.leaveLobby(found.id, socket.data.playerId);
        if (updated) {
          io.to(`lobby:${found.code}`).emit('lobby:player-left', {
            playerId: socket.data.playerId,
            lobby: updated,
          });
          io.to(`lobby:${found.code}`).emit('lobby:update', { lobby: updated });
        } else {
          lobbyReconnectService.cancelLobby(found.id);
        }
      }

      void socket.leave(`lobby:${found.code}`);
      socket.data.lobbyId = null;
      socket.data.gameId = null;

      socket.emit('session:restore', noSession('SESSION_DISCARDED'));
    } catch (error) {
      console.error('Error discarding session:', error);
      socket.emit('session:restore', noSession('RESTORE_FAILED'));
    }
  });
}

/**
 * Gets the Socket.IO server instance.
 */
export function getIO(): TypedServer {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
}

/**
 * Broadcasts to all sockets in a lobby room.
 */
export function broadcastToLobby(lobbyCode: string, event: string, data: any): void {
  io.to(`lobby:${lobbyCode}`).emit(event as any, data);
}

/**
 * Gets all sockets in a lobby.
 */
export async function getLobbySockets(lobbyCode: string): Promise<TypedSocket[]> {
  const sockets = await io.in(`lobby:${lobbyCode}`).fetchSockets();
  return sockets as unknown as TypedSocket[];
}

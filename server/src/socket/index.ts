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
import { playerService } from '../services/player.service';
import { lobbyService } from '../services/lobby.service';
import { gameService } from '../services/game.service';
import { scoreboardService } from '../services/scoreboard.service';
import { botService } from '../services/bot.service';
import { lobbyReconnectService } from '../services/lobbyReconnect.service';
import { registerLobbyEvents, handleLobbyDisconnect, attachLobbyReconnect } from './lobby.events';
import { registerGameEvents, handleGameDisconnect } from './game.events';
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

  // Give the waiting-room grace period its socket-backed effects. Done once
  // here, not per connection, so hooks and timers cannot accumulate.
  attachLobbyReconnect(io);

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
 * This is also where a waiting-room disconnect grace period is cancelled: the
 * player is identified by the playerId their stable clientId resolved to, so
 * they get *their* existing seat back rather than a new one, and the pending
 * removal is dropped before it can fire.
 *
 * Always emits `session:restore`, including when there is nothing to restore -
 * a cold-started client is waiting for that answer before it decides which
 * screen to open, and silence is indistinguishable from an unreachable server.
 * The two negative reasons are kept apart for the same purpose: only
 * SESSION_NOT_FOUND means "forget your saved session".
 *
 * Returns the payload that was sent.
 */
async function restoreSession(socket: TypedSocket): Promise<SessionRestorePayload> {
  const fail = (payload: SessionRestorePayload): SessionRestorePayload => {
    socket.emit('session:restore', payload);
    return payload;
  };

  if (!socket.data.playerId) {
    return fail(noSession('SESSION_NOT_FOUND'));
  }

  try {
    const found = await lobbyService.getPlayerLobby(socket.data.playerId);
    if (!found) {
      return fail(noSession('SESSION_NOT_FOUND'));
    }

    // Re-join the room so future broadcasts reach this socket again - and so
    // the reconnect service can see that this player is live again.
    socket.data.lobbyId = found.id;
    void socket.join(`lobby:${found.code}`);

    // Reclaim a held seat, if this player had one. Returns the refreshed lobby
    // (and has already told the room); null means there was nothing to reclaim,
    // which is the normal case for a first connect.
    const lobby = (await lobbyReconnectService.restorePlayer(found, socket.data.playerId)) ?? found;

    let clientState = null;
    let scoreboard = null;
    if (lobby.status === 'IN_GAME') {
      const game = await gameService.getGameByLobbyId(lobby.id);
      if (game) {
        socket.data.gameId = game.id;
        clientState = gameService.getClientGameState(game, socket.data.playerId);

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

    console.log(
      `Restored session for ${socket.data.playerName} -> lobby ${lobby.code}` +
        (clientState ? ` (in game, ${clientState.status})` : '')
    );

    const payload: SessionRestorePayload = {
      restored: true,
      lobby,
      gameState: clientState,
      scoreboard,
    };

    // Tell the client what to resume, and also refresh any already-mounted
    // screens that listen for the standard update events. Deliberately never a
    // join event: a reconnect is not a new join, so no join feedback replays.
    socket.emit('session:restore', payload);
    socket.emit('lobby:update', { lobby });
    if (clientState) {
      socket.emit('game:update', { gameState: clientState });
    }

    return payload;
  } catch (error) {
    // Deliberately not SESSION_NOT_FOUND: the player may well still have a seat,
    // and telling the client otherwise would make it throw away a valid saved
    // session over a transient database problem.
    console.error('Error restoring session:', error);
    return fail(noSession('RESTORE_FAILED'));
  }
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

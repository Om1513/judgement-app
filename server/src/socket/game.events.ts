// Socket.IO game event handlers

import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  SocketErrorCodes,
} from '../types/socket';
import { gameService } from '../services/game.service';
import { scoreboardService } from '../services/scoreboard.service';
import { lobbyService } from '../services/lobby.service';
import { botService } from '../services/bot.service';
import { gameReconnectService } from '../services/gameReconnect.service';
import { handleAfterCardPlay, broadcastGameUpdate, resumeAfterTakeover } from './playFlow';
import { perfStart, perfEnd } from '../utils/perf';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Gives the in-game reconnect service its Socket.IO-backed effects: how to tell
 * whether a player is really still connected, how to tell the table that a seat
 * is reconnecting / auto-playing / back, and how to nudge the game forward once
 * the bot owns a seat it has been waiting on.
 *
 * Called once per server from initializeSocket, so listeners and hooks cannot
 * accumulate per connection.
 */
export function attachGameReconnect(io: TypedServer): void {
  /** Pushes the table's new presence to everyone (game:update carries it). */
  const refresh = (lobbyId: string): void => {
    void gameService
      .getGameByLobbyId(lobbyId)
      .then(game => (game ? broadcastGameUpdate(io, game.id, game) : undefined))
      .catch(error => console.error('Error broadcasting table presence:', error));
  };

  gameReconnectService.attach({
    async hasLiveSocket(lobbyCode, playerId, excludeSocketId) {
      const sockets = await io.in(`lobby:${lobbyCode}`).fetchSockets();
      return sockets.some(s => s.data.playerId === playerId && s.id !== excludeSocketId);
    },

    onDisconnected(lobby, player, reconnectDeadline) {
      console.log(
        `Player ${player.name} dropped out of game in lobby ${lobby.code}; ` +
          `holding their seat until ${reconnectDeadline.toISOString()}`
      );
      refresh(lobby.id);
    },

    onBotTakeover(lobby, player) {
      console.log(`Bot is taking over ${player.name}'s seat in lobby ${lobby.code}`);

      // The table may have been waiting on this seat for the whole grace period,
      // so the bot has to be prompted to act - and the broadcast that goes with
      // it is what turns "Reconnecting..." into "Auto Playing".
      void gameService
        .getGameByLobbyId(lobby.id)
        .then(game => (game ? resumeAfterTakeover(io, game.id) : undefined))
        .catch(error => console.error('Error resuming game after bot takeover:', error));
    },

    onReconnected(lobby, player) {
      console.log(`Player ${player.name} reconnected mid-game in lobby ${lobby.code}`);
      refresh(lobby.id);
    },

    onRejoined(lobby, player) {
      console.log(`Player ${player.name} rejoined the game in lobby ${lobby.code}`);
      refresh(lobby.id);
    },

    onDiscarded(lobby, player) {
      console.log(
        `Player ${player.name} discarded their session in lobby ${lobby.code}; ` +
          'the bot keeps their seat'
      );

      // They may have discarded from inside the grace period, in which case the
      // seat has only just become bot-controlled and the game could be waiting
      // on it.
      void gameService
        .getGameByLobbyId(lobby.id)
        .then(game => (game ? resumeAfterTakeover(io, game.id) : undefined))
        .catch(error => console.error('Error resuming game after discard:', error));
    },
  });
}

/**
 * Whether the bot - not this socket's human - is currently the controller of
 * their seat.
 *
 * A bot-controlled seat is one whose owner has not rejoined yet, so an action
 * arriving from their socket must be refused: allowing it is how a seat ends up
 * with two controllers and a trick with two cards from one player.
 */
async function botOwnsMySeat(socket: TypedSocket): Promise<boolean> {
  if (!socket.data.lobbyId || !socket.data.playerId) {
    return false;
  }
  const membership = await lobbyService.getMembership(socket.data.lobbyId, socket.data.playerId);
  return membership?.controlledByBot === true;
}

/**
 * Registers game-related socket event handlers.
 */
export function registerGameEvents(io: TypedServer, socket: TypedSocket): void {
  /**
   * Submits a bid during bidding phase.
   */
  socket.on('game:submit-bid', async (data) => {
    const _t = perfStart();
    try {
      const { bid } = data;

      if (!socket.data.playerId || !socket.data.gameId) {
        socket.emit('game:error', {
          message: 'Not in a game',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      if (await botOwnsMySeat(socket)) {
        socket.emit('game:error', {
          message: 'Rejoin the game before playing - the bot is currently playing your seat.',
          code: SocketErrorCodes.REJOIN_REQUIRED,
        });
        return;
      }

      // Submit bid
      await gameService.submitBid({
        gameId: socket.data.gameId,
        playerId: socket.data.playerId,
        bid,
      });

      console.log(`Player ${socket.data.playerName} bid ${bid}`);

      // Broadcast personalized state to everyone (uses the cached lobby ref).
      await broadcastGameUpdate(io, socket.data.gameId);

      // Process pending bot actions
      await botService.processPendingBotActions(socket.data.gameId);

      perfEnd(_t, 'game:submit-bid');
    } catch (error) {
      console.error('Error submitting bid:', error);
      socket.emit('game:error', {
        message: error instanceof Error ? error.message : 'Failed to submit bid',
        code: error instanceof Error && error.message.includes('turn')
          ? SocketErrorCodes.NOT_YOUR_TURN
          : SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Plays a card during playing phase.
   */
  socket.on('game:play-card', async (data) => {
    const _t = perfStart();
    try {
      const { card } = data;

      if (!socket.data.playerId || !socket.data.gameId) {
        socket.emit('game:error', {
          message: 'Not in a game',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      if (await botOwnsMySeat(socket)) {
        socket.emit('game:error', {
          message: 'Rejoin the game before playing - the bot is currently playing your seat.',
          code: SocketErrorCodes.REJOIN_REQUIRED,
        });
        return;
      }

      // Play card
      const { trickComplete, roundComplete } = await gameService.playCard({
        gameId: socket.data.gameId,
        playerId: socket.data.playerId,
        card,
      });

      console.log(`Player ${socket.data.playerName} played ${card.rank} of ${card.suit}`);

      // Broadcast the new state, run the hand-winner popup / inter-hand pause,
      // and drive any pending bot actions.
      await handleAfterCardPlay(io, socket.data.gameId, { trickComplete, roundComplete });

      perfEnd(_t, 'game:play-card', { trickComplete, roundComplete });
    } catch (error) {
      console.error('Error playing card:', error);
      socket.emit('game:error', {
        message: error instanceof Error ? error.message : 'Failed to play card',
        code: error instanceof Error && error.message.includes('turn')
          ? SocketErrorCodes.NOT_YOUR_TURN
          : SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Requests current game state (for reconnection).
   */
  socket.on('game:state-request', async () => {
    try {
      if (!socket.data.playerId || !socket.data.gameId) {
        socket.emit('game:error', {
          message: 'Not in a game',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      const game = await gameService.getGameById(socket.data.gameId);
      if (!game) {
        socket.emit('game:error', {
          message: 'Game not found',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      const presence = await gameService.getPresence(game.lobbyId);
      const clientState = gameService.getClientGameState(game, socket.data.playerId, presence);
      socket.emit('game:update', { gameState: clientState });
    } catch (error) {
      console.error('Error fetching game state:', error);
      socket.emit('game:error', {
        message: 'Failed to fetch game state',
        code: SocketErrorCodes.GAME_NOT_FOUND,
      });
    }
  });

  /**
   * Returns the final scoreboard (all round scores + totals) for a completed
   * game, including the backend-determined winner(s).
   */
  socket.on('game:get-final-scoreboard', async () => {
    try {
      if (!socket.data.gameId) {
        socket.emit('game:error', {
          message: 'Not in a game',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      const scoreboard = await scoreboardService.getScoreboardState(socket.data.gameId);
      const result = await scoreboardService.finalizeGame(socket.data.gameId);
      if (!scoreboard || !result) {
        socket.emit('game:error', {
          message: 'Final scoreboard not available',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      socket.emit('game:final-scoreboard', {
        scoreboard,
        winnerIds: result.winnerIds,
        winningScore: result.winningScore,
      });
    } catch (error) {
      console.error('Error fetching final scoreboard:', error);
      socket.emit('game:error', {
        message: error instanceof Error ? error.message : 'Failed to get final scoreboard',
        code: SocketErrorCodes.INVALID_ACTION,
      });
    }
  });
}

/**
 * Handles an unexpected socket drop from a game that is under way.
 *
 * Nobody is removed and nothing is rearranged. The player keeps their seat,
 * hand, bid, tricks and score; the table is shown "Reconnecting..." for them;
 * and gameReconnectService hands the seat to the bot only if they are still
 * absent when the grace period runs out. Coming back afterwards is their own
 * decision - see the rejoin/discard flow below.
 *
 * An explicit Leave Game does not come through this path (see handleLobbyLeave
 * in lobby.events), so it stays immediate.
 */
export async function handleGameDisconnect(
  _io: TypedServer,
  socket: TypedSocket
): Promise<void> {
  if (!socket.data.gameId || !socket.data.playerId || !socket.data.lobbyId) {
    return;
  }

  try {
    const game = await gameService.getGameById(socket.data.gameId);
    if (!game || isGameFinished(game.gameState.status)) {
      // A finished game has no turns left to block, so there is nothing to hold
      // a seat for and nothing for a bot to take over.
      return;
    }

    const lobby = await lobbyService.getLobbyById(socket.data.lobbyId);
    if (!lobby) {
      return;
    }

    console.log(
      `Player ${socket.data.playerName} dropped out of game ${socket.data.gameId}`
    );

    // Passing this socket's id lets the service ignore a disconnect that arrives
    // late for a connection the player has already replaced.
    await gameReconnectService.startGracePeriod(lobby, socket.data.playerId, socket.id);
  } catch (error) {
    console.error('Error handling game disconnect:', error);
  }
}

/** Phases in which a game has nothing left to play. */
export function isGameFinished(status: string): boolean {
  return status === 'GAME_OVER' || status === 'FINAL_WINNER' || status === 'COMPLETED';
}

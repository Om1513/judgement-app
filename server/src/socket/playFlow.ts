// Shared orchestration for what happens after a card is played.
//
// This is used by both the human play-card handler (game.events) and the bot
// card-play scheduler (bot.service) so the hand-winner popup / inter-hand pause
// behaves identically regardless of who played the final card of a trick.

import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '../types/socket';
import { gameService } from '../services/game.service';
import { scoreboardService } from '../services/scoreboard.service';
import { lobbyService } from '../services/lobby.service';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// How long the last played card is left on the table before the hand-winner
// popup is announced (ms), so players can see the final play of the trick.
export const LAST_CARD_VIEW_DELAY = 1000;

// How long the hand-winner popup is held before the next hand starts (ms).
// Kept within the 1.5-2s window requested by product.
export const HAND_WINNER_DURATION = 1800;

/**
 * Sends a personalized game state update to every player in the game's lobby.
 */
export async function broadcastGameUpdate(io: TypedServer, gameId: string): Promise<void> {
  const game = await gameService.getGameById(gameId);
  if (!game) {
    return;
  }

  const lobby = await lobbyService.getLobbyById(game.lobbyId);
  if (!lobby) {
    return;
  }

  const sockets = await io.in(`lobby:${lobby.code}`).fetchSockets();
  for (const s of sockets) {
    const clientState = gameService.getClientGameState(game, s.data.playerId);
    s.emit('game:update', { gameState: clientState });
  }
}

/**
 * Orchestrates everything that should happen after a card has been played:
 *  - broadcasts the new state (the completed trick stays on the table)
 *  - if a trick completed, announces the hand winner and holds, then either
 *    starts the next hand or moves to the round scoreboard
 *  - otherwise lets the next bot (if any) take its turn
 *
 * Owns all bot continuation, so callers should NOT also call
 * processPendingBotActions after invoking this.
 */
export async function handleAfterCardPlay(
  io: TypedServer,
  gameId: string,
  result: { trickComplete: boolean; roundComplete: boolean }
): Promise<void> {
  const { botService } = await import('../services/bot.service');

  // Push the latest state to everyone. When a trick just completed, the
  // completed trick is still on the table so clients can show the popup over it.
  await broadcastGameUpdate(io, gameId);

  if (!result.trickComplete) {
    // Ordinary play - let the next player (bot) act.
    await botService.processPendingBotActions(gameId);
    return;
  }

  // A trick completed - announce the hand winner.
  const game = await gameService.getGameById(gameId);
  if (!game) {
    return;
  }
  const lobby = await lobbyService.getLobbyById(game.lobbyId);
  if (!lobby) {
    return;
  }

  const roundState = game.gameState.roundState;
  const completedTrick = roundState?.currentTrick;
  const winnerId = completedTrick?.winnerId || null;
  const winner = game.gameState.players.find(p => p.id === winnerId);
  const trickNumber = roundState?.trickNumber ?? 0;

  // Leave the final card on the table for a moment so players can see the last
  // play, then announce the hand winner.
  setTimeout(() => {
  if (winnerId && winner) {
    io.to(`lobby:${lobby.code}`).emit('hand:winner-announced', {
      playerId: winnerId,
      playerName: winner.name,
      trickNumber,
    });
  }

  // Hold so the popup is visible, then continue the flow.
  setTimeout(async () => {
    try {
      if (result.roundComplete) {
        const isFinalRound =
          game.gameState.currentRound >= game.gameState.totalRounds;

        if (isFinalRound) {
          // Last round: skip the round scoreboard / Continue step entirely and
          // go straight to the winner celebration after the hand popup.
          await gameService.advanceToNextRound(gameId); // sets status GAME_OVER
          await broadcastFinalWinner(io, gameId);
        } else {
          // Round is over - reveal the scoreboard now (after the popup).
          io.to(`lobby:${lobby.code}`).emit('game:round-complete', {
            roundNumber: game.gameState.currentRound,
            scores: game.gameState.scores,
          });
          const { broadcastScoreboard } = await import('./scoreboard.events');
          await broadcastScoreboard(io, gameId);
        }
      } else {
        // Deal/lead the next hand; the trick winner leads.
        const state = await gameService.advanceToNextTrick(gameId);
        await broadcastGameUpdate(io, gameId);
        if (state && winnerId) {
          io.to(`lobby:${lobby.code}`).emit('hand:next-started', {
            trickNumber: state.roundState?.trickNumber ?? trickNumber + 1,
            leaderId: winnerId,
          });
        }
        await botService.processPendingBotActions(gameId);
      }
    } catch (error) {
      console.error('Error advancing after hand winner:', error);
    }
  }, HAND_WINNER_DURATION);
  }, LAST_CARD_VIEW_DELAY);
}

/**
 * Finalizes a completed game and broadcasts the final winner + completion.
 * Safe to call more than once - the underlying result is only stored once.
 */
export async function broadcastFinalWinner(io: TypedServer, gameId: string): Promise<void> {
  const game = await gameService.getGameById(gameId);
  if (!game) {
    return;
  }
  const lobby = await lobbyService.getLobbyById(game.lobbyId);
  if (!lobby) {
    return;
  }

  const result = await scoreboardService.finalizeGame(gameId);
  if (!result) {
    console.warn(`broadcastFinalWinner: no result for game ${gameId}`);
    return;
  }

  console.log(
    `Broadcasting final winner for ${gameId} to lobby:${lobby.code}:`,
    result.winners.map(w => w.name).join(', ')
  );

  io.to(`lobby:${lobby.code}`).emit('game:final-winner', {
    winners: result.winners,
    winnerIds: result.winnerIds,
    winningScore: result.winningScore,
    isTie: result.isTie,
    finalScores: result.finalScores,
  });

  // Keep the legacy event for any older clients / logging.
  io.to(`lobby:${lobby.code}`).emit('game:completed', {
    finalScores: result.finalScores,
    winner: result.winners[0] || { id: '', name: 'Unknown' },
  });
}

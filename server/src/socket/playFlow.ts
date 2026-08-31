// Shared orchestration for what happens after a card is played.
//
// This is used by both the human play-card handler (game.events) and the bot
// card-play scheduler (bot.service) so the hand-winner popup / inter-hand pause
// behaves identically regardless of who played the final card of a trick.

import { Server } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '../types/socket';
import { gameService } from '../services/game.service';
import { scoreboardService } from '../services/scoreboard.service';
import { perfEnabled, perfLog, payloadSize } from '../utils/perf';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// Presentation pauses between tricks. These are deliberate UI beats, not
// mechanics, so they are overridable by env var: integration tests turn them
// down to a few milliseconds instead of waiting ~3s per trick. Unset (i.e.
// every real deployment) keeps the product-tuned defaults.
function pauseMs(envVar: string, fallback: number): number {
  const raw = Number(process.env[envVar]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

// How long the last played card is left on the table before the hand-winner
// popup is announced (ms), so players can see the final play of the trick.
export const LAST_CARD_VIEW_DELAY = pauseMs('LAST_CARD_VIEW_DELAY_MS', 1000);

// How long the hand-winner popup is held before the next hand starts (ms).
// Kept within the 1.5-2s window requested by product.
export const HAND_WINNER_DURATION = pauseMs('HAND_WINNER_DURATION_MS', 1800);

/**
 * Sends a personalized game state update to every player in the game's lobby.
 * Pass `preloadedGame` when the caller already has the fresh game in hand to
 * avoid a redundant re-fetch.
 *
 * Every update carries the table's presence (who is reconnecting, whose seat the
 * bot is playing) alongside the game state, because the two change
 * independently: a takeover is not a game action, so there would otherwise be no
 * broadcast to hang it off.
 */
export async function broadcastGameUpdate(
  io: TypedServer,
  gameId: string,
  preloadedGame?: Awaited<ReturnType<typeof gameService.getGameById>>
): Promise<void> {
  const game = preloadedGame ?? (await gameService.getGameById(gameId));
  if (!game) {
    return;
  }

  const ref = await gameService.getLobbyRef(gameId);
  if (!ref) {
    return;
  }

  const presence = await gameService.getPresence(ref.lobbyId);
  const sockets = await io.in(`lobby:${ref.code}`).fetchSockets();
  let lastSize = 0;
  for (const s of sockets) {
    const clientState = gameService.getClientGameState(game, s.data.playerId, presence);
    if (perfEnabled) {
      lastSize = payloadSize({ gameState: clientState });
    }
    s.emit('game:update', { gameState: clientState });
  }

  if (perfEnabled) {
    perfLog('broadcast game:update', {
      room: ref.code,
      players: sockets.length,
      bytesPerPlayer: lastSize,
    });
  }
}

/**
 * Nudges a game that may be waiting on a seat the bot has just taken over.
 *
 * A takeover is not a game action, so nothing else would prompt the engine to
 * look at whose turn it is. Which prompt is needed depends on the phase - a bid
 * or a card during play, a Continue on the round scoreboard - and getting the
 * scoreboard case wrong is what would leave three players stuck on a Continue
 * button that never turns green.
 *
 * Idempotent: every path it calls re-reads the game and no-ops when the seat is
 * not actually waiting, so calling it needlessly is free.
 */
export async function resumeAfterTakeover(io: TypedServer, gameId: string): Promise<void> {
  const { botService } = await import('../services/bot.service');

  await broadcastGameUpdate(io, gameId);

  const game = await gameService.getGameById(gameId);
  if (!game) {
    return;
  }

  switch (game.gameState.status) {
    case 'BIDDING':
    case 'PLAYING':
    case 'HAND_WINNER':
      await botService.processPendingBotActions(gameId);
      break;
    case 'ROUND_SCOREBOARD':
      botService.scheduleBotContinues(gameId);
      break;
    default:
      // ROUND_COMPLETE is a transient state on the way to the scoreboard, and a
      // finished game has nothing left to play.
      break;
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
  const ref = await gameService.getLobbyRef(gameId);
  if (!ref) {
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
    io.to(`lobby:${ref.code}`).emit('hand:winner-announced', {
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
          io.to(`lobby:${ref.code}`).emit('game:round-complete', {
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
          io.to(`lobby:${ref.code}`).emit('hand:next-started', {
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
  const ref = await gameService.getLobbyRef(gameId);
  if (!ref) {
    return;
  }

  const result = await scoreboardService.finalizeGame(gameId);
  if (!result) {
    console.warn(`broadcastFinalWinner: no result for game ${gameId}`);
    return;
  }

  console.log(
    `Broadcasting final winner for ${gameId} to lobby:${ref.code}:`,
    result.winners.map(w => w.name).join(', ')
  );

  io.to(`lobby:${ref.code}`).emit('game:final-winner', {
    winners: result.winners,
    winnerIds: result.winnerIds,
    winningScore: result.winningScore,
    isTie: result.isTie,
    finalScores: result.finalScores,
  });

  // Keep the legacy event for any older clients / logging.
  io.to(`lobby:${ref.code}`).emit('game:completed', {
    finalScores: result.finalScores,
    winner: result.winners[0] || { id: '', name: 'Unknown' },
  });

  // Game is over - drop the cached lobby ref to bound memory, and any takeover
  // countdown still running against it. There are no turns left to block, so a
  // seat that is still absent has nothing for a bot to play.
  gameService.clearLobbyRef(gameId);
  const { gameReconnectService } = await import('../services/gameReconnect.service');
  gameReconnectService.cancelLobby(ref.lobbyId);
}

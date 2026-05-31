// Scoreboard service - handles scoreboard state and continue confirmations

import { getDB } from '../db/connection';
import {
  ScoreboardState,
  ScoreboardPlayer,
  ScoreboardRow,
  ScoreboardRowScore,
  TrumpInfo,
  FinalResult,
} from '../types/game';
import { LobbySettings } from '../types/lobby';
import { gameService } from './game.service';
import { lobbyService } from './lobby.service';
import { calculateScore } from '../utils/cardUtils';

// Trump suit display mappings
const TRUMP_DISPLAY: Record<string, { name: string; symbol: string }> = {
  spades: { name: 'Spades', symbol: '♠' },
  diamonds: { name: 'Diamonds', symbol: '♦' },
  clubs: { name: 'Clubs', symbol: '♣' },
  hearts: { name: 'Hearts', symbol: '♥' },
};

export class ScoreboardService {
  /**
   * Gets the current scoreboard state for a game.
   */
  async getScoreboardState(gameId: string): Promise<ScoreboardState | null> {
    const db = getDB();

    const game = await gameService.getGameById(gameId);
    if (!game) {
      return null;
    }

    const lobby = await lobbyService.getLobbyById(game.lobbyId);
    if (!lobby) {
      return null;
    }

    // Get all rounds with their scores
    const rounds = await db.gameRound.findMany({
      where: { gameId },
      orderBy: { roundNumber: 'asc' },
      include: {
        roundScores: true,
        scoreboardConfirmations: true,
      },
    });

    // Get lobby players for player info
    const lobbyPlayers = await db.lobbyPlayer.findMany({
      where: { lobbyId: game.lobbyId },
      include: { player: true },
      orderBy: { seatPosition: 'asc' },
    });

    // Get current round
    const currentRound = rounds.find(r => r.roundNumber === game.currentRound);
    if (!currentRound) {
      return null;
    }

    // Build player info with continue status
    const players: ScoreboardPlayer[] = lobbyPlayers.map(lp => {
      const confirmation = currentRound.scoreboardConfirmations.find(
        sc => sc.playerId === lp.playerId
      );
      return {
        id: lp.playerId,
        name: lp.player.name,
        isHost: lp.isHost,
        isBot: lp.player.isBot,
        totalScore: game.gameState.scores[lp.playerId] || 0,
        hasContinued: confirmation?.hasContinued || false,
      };
    });

    // Build rows for all rounds
    const rows: ScoreboardRow[] = [];
    const settings = lobby.settings as LobbySettings;

    for (let roundNum = 1; roundNum <= game.gameState.totalRounds; roundNum++) {
      const round = rounds.find(r => r.roundNumber === roundNum);
      const trumpInfo = game.gameState.trumpOrder[roundNum - 1];

      const trump: TrumpInfo = trumpInfo || {
        key: '',
        name: '',
        suit: '',
        symbol: '',
      };

      // If we have trump info, enhance it with display info
      if (trump.suit && TRUMP_DISPLAY[trump.suit]) {
        trump.name = TRUMP_DISPLAY[trump.suit].name;
        trump.symbol = TRUMP_DISPLAY[trump.suit].symbol;
      }

      const scores: ScoreboardRowScore[] = lobbyPlayers.map(lp => {
        if (!round || roundNum > game.currentRound) {
          // Future round - no scores yet
          return {
            playerId: lp.playerId,
            bid: null,
            handsMade: null,
            score: null,
          };
        }

        const roundScore = round.roundScores.find(rs => rs.playerId === lp.playerId);
        if (roundScore) {
          return {
            playerId: lp.playerId,
            bid: roundScore.bidValue,
            handsMade: roundScore.handsMade,
            score: roundScore.roundScore,
          };
        }

        // Round exists but no score yet (shouldn't happen if round is complete)
        return {
          playerId: lp.playerId,
          bid: null,
          handsMade: null,
          score: null,
        };
      });

      rows.push({
        roundNumber: roundNum,
        trump,
        scores,
      });
    }

    const status = game.gameState.status === 'GAME_OVER' ? 'completed' : 'round_scoreboard';

    return {
      gameId,
      roundId: currentRound.id,
      currentRound: game.currentRound,
      totalRounds: game.gameState.totalRounds,
      scoringMode: settings.scoringMode,
      status,
      players,
      rows,
    };
  }

  /**
   * Creates scoreboard confirmations for all players in a game round.
   */
  async createConfirmations(gameId: string, roundId: string): Promise<void> {
    const db = getDB();

    const game = await gameService.getGameById(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    const lobby = await lobbyService.getLobbyById(game.lobbyId);
    if (!lobby) {
      throw new Error('Lobby not found');
    }

    // Delete any existing confirmations for this round
    await db.scoreboardConfirmation.deleteMany({
      where: { gameId, roundId },
    });

    // Create confirmations for all players
    const confirmations = lobby.players.map(player => ({
      gameId,
      roundId,
      playerId: player.playerId,
      hasContinued: false,
    }));

    await db.scoreboardConfirmation.createMany({
      data: confirmations,
    });
  }

  /**
   * Marks a player as having clicked Continue.
   */
  async playerContinue(gameId: string, playerId: string): Promise<{
    allContinued: boolean;
    scoreboard: ScoreboardState;
  }> {
    const db = getDB();

    const game = await gameService.getGameById(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    if (game.gameState.status !== 'ROUND_SCOREBOARD') {
      throw new Error('Game is not in scoreboard phase');
    }

    // Get current round
    const currentRound = await db.gameRound.findFirst({
      where: { gameId, roundNumber: game.currentRound },
    });

    if (!currentRound) {
      throw new Error('Current round not found');
    }

    // Update the player's confirmation
    await db.scoreboardConfirmation.upsert({
      where: {
        gameId_roundId_playerId: {
          gameId,
          roundId: currentRound.id,
          playerId,
        },
      },
      update: {
        hasContinued: true,
        continuedAt: new Date(),
      },
      create: {
        gameId,
        roundId: currentRound.id,
        playerId,
        hasContinued: true,
        continuedAt: new Date(),
      },
    });

    // Check if all players have continued
    const confirmations = await db.scoreboardConfirmation.findMany({
      where: { gameId, roundId: currentRound.id },
    });

    const lobby = await lobbyService.getLobbyById(game.lobbyId);
    const playerCount = lobby?.playerCount || 0;

    const continuedCount = confirmations.filter(c => c.hasContinued).length;
    const allContinued = continuedCount >= playerCount;

    const scoreboard = await this.getScoreboardState(gameId);
    if (!scoreboard) {
      throw new Error('Failed to get scoreboard state');
    }

    return { allContinued, scoreboard };
  }

  /**
   * Saves round scores for all players.
   */
  async saveRoundScores(
    gameId: string,
    roundId: string,
    roundNumber: number,
    playerScores: {
      playerId: string;
      bid: number;
      handsMade: number;
      score: number;
    }[]
  ): Promise<void> {
    const db = getDB();

    // Delete any existing scores for this round
    await db.roundScore.deleteMany({
      where: { gameId, roundId },
    });

    // Create new scores
    const scores = playerScores.map(ps => ({
      gameId,
      roundId,
      playerId: ps.playerId,
      bidValue: ps.bid,
      handsMade: ps.handsMade,
      roundScore: ps.score,
    }));

    await db.roundScore.createMany({
      data: scores,
    });
  }

  /**
   * Computes and persists the final game result (winner(s), winning score and
   * the full final score map). The result is stored exactly once per game; any
   * subsequent call returns the already-stored result without creating a
   * duplicate. The winner is always computed by the backend (authoritative).
   */
  async finalizeGame(gameId: string): Promise<FinalResult | null> {
    const db = getDB();

    const game = await gameService.getGameById(gameId);
    if (!game) {
      return null;
    }

    const lobby = await lobbyService.getLobbyById(game.lobbyId);
    if (!lobby) {
      return null;
    }

    const finalScores = game.gameState.scores || {};
    const nameOf = (playerId: string) =>
      lobby.players.find(p => p.playerId === playerId)?.name || 'Unknown';

    // Highest total score wins; ties produce multiple winners.
    const scoreValues = Object.values(finalScores);
    const winningScore = scoreValues.length ? Math.max(...scoreValues) : 0;
    const winnerIds = Object.entries(finalScores)
      .filter(([, score]) => score === winningScore)
      .map(([playerId]) => playerId);
    const winners = winnerIds.map(id => ({ id, name: nameOf(id) }));

    const result: FinalResult = {
      winners,
      winnerIds,
      winningScore,
      isTie: winnerIds.length > 1,
      finalScores,
    };

    // Persist the result once (unique gameId guarantees idempotency). This is
    // wrapped so a persistence problem can never block the winner screen - the
    // computed result above is what the clients actually need.
    try {
      const existing = await db.gameResult.findUnique({ where: { gameId } });
      if (!existing) {
        await db.gameResult.create({
          data: {
            gameId,
            winnerPlayerIds: winnerIds as any,
            winningScore,
            finalScoresJson: finalScores as any,
          },
        });

        // Mark the game as fully completed.
        await db.game.update({
          where: { id: gameId },
          data: { status: 'COMPLETED' as any },
        });

        console.log(
          `Game ${gameId} finalized. Winner(s): ${winners.map(w => w.name).join(', ')} @ ${winningScore}`
        );
      }
    } catch (error) {
      // Concurrent finalize race, or a DB/schema issue - log and carry on so
      // the final winner is still broadcast.
      console.error('Failed to persist game result (continuing):', error);
    }

    return result;
  }

  /**
   * Checks if all players have continued.
   */
  async checkAllContinued(gameId: string): Promise<boolean> {
    const db = getDB();

    const game = await gameService.getGameById(gameId);
    if (!game) {
      return false;
    }

    const currentRound = await db.gameRound.findFirst({
      where: { gameId, roundNumber: game.currentRound },
    });

    if (!currentRound) {
      return false;
    }

    const confirmations = await db.scoreboardConfirmation.findMany({
      where: { gameId, roundId: currentRound.id },
    });

    const lobby = await lobbyService.getLobbyById(game.lobbyId);
    const playerCount = lobby?.playerCount || 0;

    const continuedCount = confirmations.filter(c => c.hasContinued).length;
    return continuedCount >= playerCount;
  }
}

// Export singleton instance
export const scoreboardService = new ScoreboardService();

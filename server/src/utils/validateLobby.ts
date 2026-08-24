// Validation utilities for lobby operations

import { LobbySettings, LobbyStatus, DEFAULT_LOBBY_SETTINGS } from '../types/lobby';

// Validation constraints
export const LOBBY_CONSTRAINTS = {
  MIN_PLAYERS: 2, // Changed to 2 for testing
  MAX_PLAYERS: 8,
  MIN_ROUNDS: 4,
  MAX_ROUNDS: 8,
  VALID_ORDER_MODES: ['Kachuful', 'Random'] as const,
  VALID_SCORING_MODES: ['+10', '+1'] as const,
} as const;

/**
 * Validates lobby settings and returns sanitized settings.
 */
export function validateLobbySettings(
  settings: Partial<LobbySettings>
): { valid: boolean; settings: LobbySettings; errors: string[] } {
  const errors: string[] = [];

  // Start with defaults
  const sanitized: LobbySettings = { ...DEFAULT_LOBBY_SETTINGS };

  // Validate rounds
  if (settings.rounds !== undefined) {
    if (
      typeof settings.rounds !== 'number' ||
      settings.rounds < LOBBY_CONSTRAINTS.MIN_ROUNDS ||
      settings.rounds > LOBBY_CONSTRAINTS.MAX_ROUNDS
    ) {
      errors.push(
        `Rounds must be between ${LOBBY_CONSTRAINTS.MIN_ROUNDS} and ${LOBBY_CONSTRAINTS.MAX_ROUNDS}`
      );
    } else {
      sanitized.rounds = Math.floor(settings.rounds);
    }
  }

  // Validate maxPlayers
  if (settings.maxPlayers !== undefined) {
    if (
      typeof settings.maxPlayers !== 'number' ||
      settings.maxPlayers < LOBBY_CONSTRAINTS.MIN_PLAYERS ||
      settings.maxPlayers > LOBBY_CONSTRAINTS.MAX_PLAYERS
    ) {
      errors.push(
        `Max players must be between ${LOBBY_CONSTRAINTS.MIN_PLAYERS} and ${LOBBY_CONSTRAINTS.MAX_PLAYERS}`
      );
    } else {
      sanitized.maxPlayers = Math.floor(settings.maxPlayers);
    }
  }

  // Validate orderMode
  if (settings.orderMode !== undefined) {
    if (!LOBBY_CONSTRAINTS.VALID_ORDER_MODES.includes(settings.orderMode as any)) {
      errors.push(`Order mode must be one of: ${LOBBY_CONSTRAINTS.VALID_ORDER_MODES.join(', ')}`);
    } else {
      sanitized.orderMode = settings.orderMode;
    }
  }

  // Validate scoringMode
  if (settings.scoringMode !== undefined) {
    if (!LOBBY_CONSTRAINTS.VALID_SCORING_MODES.includes(settings.scoringMode as any)) {
      errors.push(`Scoring mode must be one of: ${LOBBY_CONSTRAINTS.VALID_SCORING_MODES.join(', ')}`);
    } else {
      sanitized.scoringMode = settings.scoringMode;
    }
  }

  return {
    valid: errors.length === 0,
    settings: sanitized,
    errors,
  };
}

/**
 * Validates player name.
 */
export function validatePlayerName(name: string): { valid: boolean; sanitized: string; error?: string } {
  if (!name || typeof name !== 'string') {
    return { valid: false, sanitized: '', error: 'Name is required' };
  }

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { valid: false, sanitized: '', error: 'Name cannot be empty' };
  }

  if (trimmed.length > 20) {
    return { valid: false, sanitized: '', error: 'Name cannot exceed 20 characters' };
  }

  // Remove any potentially dangerous characters
  const sanitized = trimmed.replace(/[<>'"&]/g, '');

  return { valid: true, sanitized };
}

/**
 * The error surfaced when the host tries to deal while someone is mid-reconnect.
 * Exported so tests and the client can match on it exactly.
 */
export const RECONNECT_PENDING_REASON =
  'Waiting for all players to reconnect before starting the game.';

/**
 * Checks if a lobby can start the game.
 *
 * `disconnectedHumanCount` is how many human players are currently inside their
 * disconnect grace period. Dealing a hand to someone who is not actually at the
 * table strands their cards for the whole round, so the game waits for them to
 * come back (or for their grace period to expire and free the seat) instead.
 * Bots are never counted - they have no connection to lose.
 */
export function canStartGame(
  playerCount: number,
  status: LobbyStatus,
  disconnectedHumanCount = 0
): { canStart: boolean; reason?: string } {
  if (status !== 'WAITING') {
    return { canStart: false, reason: 'Game has already started' };
  }

  if (playerCount < LOBBY_CONSTRAINTS.MIN_PLAYERS) {
    return {
      canStart: false,
      reason: `Need at least ${LOBBY_CONSTRAINTS.MIN_PLAYERS} players to start`,
    };
  }

  if (disconnectedHumanCount > 0) {
    return { canStart: false, reason: RECONNECT_PENDING_REASON };
  }

  return { canStart: true };
}

/**
 * Validates a bid in the Kachuful game.
 */
export function validateBid(
  bid: number,
  cardsInHand: number,
  totalBidsSoFar: number,
  isLastPlayer: boolean
): { valid: boolean; error?: string } {
  if (typeof bid !== 'number' || !Number.isInteger(bid)) {
    return { valid: false, error: 'Bid must be an integer' };
  }

  if (bid < 0) {
    return { valid: false, error: 'Bid cannot be negative' };
  }

  if (bid > cardsInHand) {
    return { valid: false, error: `Bid cannot exceed ${cardsInHand}` };
  }

  // In Kachuful, the last player cannot bid a number that makes total bids equal to cards
  if (isLastPlayer && totalBidsSoFar + bid === cardsInHand) {
    return {
      valid: false,
      error: `Cannot bid ${bid} - total bids cannot equal ${cardsInHand}`,
    };
  }

  return { valid: true };
}

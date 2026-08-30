// Player types for the Kachuful game

export interface Player {
  id: string;
  name: string;
  clientId?: string | null;
  socketId: string | null;
  isBot: boolean;
  botDifficulty?: string | null;
  createdAt: Date;
}

export interface CreatePlayerInput {
  name: string;
  clientId?: string | null;
  socketId?: string;
  isBot?: boolean;
  botDifficulty?: string;
}

export interface UpdatePlayerInput {
  name?: string;
  clientId?: string | null;
  socketId?: string | null;
}

// Player state in a lobby context
export interface LobbyPlayer {
  id: string;
  playerId: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  seatPosition: number;
  joinedAt: Date;
  /**
   * Live presence. False means they dropped out and are inside their reconnect
   * grace period - they still hold this seat, so clients show them as
   * "Reconnecting..." rather than removing the card.
   *
   * Tracked both in the waiting room and during a live game; the two grace
   * periods differ in what happens when they elapse (the seat is freed vs. the
   * bot takes over). Bots are always connected - they have no socket to lose.
   */
  connected: boolean;
  /** When the current disconnect started; null while connected. */
  disconnectedAt: Date | null;
  /** When the grace period runs out if they have not returned; null while connected. */
  reconnectDeadline: Date | null;
  /**
   * The bot engine is currently playing this seat, because the player's in-game
   * grace period elapsed. Still the same player - same name, seat, hand, bid and
   * score - only the controller changed. Cleared when they explicitly rejoin.
   */
  controlledByBot: boolean;
}

/** A lobby membership row's disconnect bookkeeping, read fresh for race checks. */
export interface LobbyMembership {
  lobbyId: string;
  lobbyCode: string;
  lobbyStatus: 'WAITING' | 'IN_GAME' | 'COMPLETED';
  playerId: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  disconnectedAt: Date | null;
  reconnectDeadline: Date | null;
  /**
   * Bumped on every connect/disconnect transition. A removal or takeover timer
   * captures the value it was scheduled against; a mismatch means the player has
   * since reconnected (or dropped again) and the timer is stale.
   */
  disconnectGeneration: number;
  /** The bot engine is currently playing this seat. */
  controlledByBot: boolean;
  /** The player answered the rejoin prompt with DISCARD. */
  sessionDiscarded: boolean;
}

// Player state in a game context
export interface GamePlayer {
  id: string;
  name: string;
  seatPosition: number;
  hand: Card[];
  bid: number | null;
  tricksWon: number;
  score: number;
  isCurrentTurn: boolean;
}

// Card representation
export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: string; // '2' - '10', 'J', 'Q', 'K', 'A'
  value: number; // numeric value for comparison
}

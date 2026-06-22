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

// Trump suit constants and utilities for Kachuful game

// Trump suit mappings
export const TRUMP_SUITS = {
  Kari: {
    key: 'Kari',
    name: 'Kari',
    suit: 'spades',
    symbol: '♠',
  },
  Chukat: {
    key: 'Chukat',
    name: 'Chukat',
    suit: 'diamonds',
    symbol: '♦',
  },
  Falli: {
    key: 'Falli',
    name: 'Falli',
    suit: 'clubs',
    symbol: '♣',
  },
  Lal: {
    key: 'Lal',
    name: 'Lal',
    suit: 'hearts',
    symbol: '♥',
  },
} as const;

export type TrumpKey = keyof typeof TRUMP_SUITS;
export type TrumpSuit = typeof TRUMP_SUITS[TrumpKey];

// Kachuful trump order: Falli → Chukat → Kari → Lal (repeating)
export const KACHUFUL_TRUMP_ORDER: TrumpKey[] = ['Falli', 'Chukat', 'Kari', 'Lal'];

// Generate trump sequence for a game based on total rounds
export function generateTrumpOrder(totalRounds: number): TrumpSuit[] {
  const trumpOrder: TrumpSuit[] = [];
  for (let i = 0; i < totalRounds; i++) {
    const trumpKey = KACHUFUL_TRUMP_ORDER[i % KACHUFUL_TRUMP_ORDER.length];
    trumpOrder.push(TRUMP_SUITS[trumpKey]);
  }
  return trumpOrder;
}

// Get trump for a specific round (1-indexed)
export function getTrumpForRound(roundNumber: number): TrumpSuit {
  const index = (roundNumber - 1) % KACHUFUL_TRUMP_ORDER.length;
  const trumpKey = KACHUFUL_TRUMP_ORDER[index];
  return TRUMP_SUITS[trumpKey];
}

// Calculate hand size for a round in Kachuful mode
// Kachuful: starts at 1, increases by 1 each round up to max, then decreases
export function calculateHandSize(
  roundNumber: number,
  totalRounds: number,
  maxHandSize: number
): number {
  // In Kachuful mode, hand size follows a pattern:
  // Round 1: 1 card, Round 2: 2 cards, ..., up to maxHandSize
  // Then decreases: maxHandSize-1, maxHandSize-2, ..., 1

  const midPoint = Math.ceil(totalRounds / 2);

  if (roundNumber <= midPoint) {
    // Ascending phase
    return Math.min(roundNumber, maxHandSize);
  } else {
    // Descending phase
    const descendingRound = roundNumber - midPoint;
    return Math.max(1, midPoint - descendingRound);
  }
}

// Alternative: Simple ascending hand size (for non-Kachuful modes)
export function calculateSimpleHandSize(
  roundNumber: number,
  maxHandSize: number
): number {
  return Math.min(roundNumber, maxHandSize);
}

// Suit to color mapping for UI
export const SUIT_COLORS = {
  spades: '#000000',
  clubs: '#000000',
  hearts: '#FF0000',
  diamonds: '#FF0000',
} as const;

// Get color for a trump key
export function getTrumpColor(trumpKey: TrumpKey): string {
  const suit = TRUMP_SUITS[trumpKey].suit;
  return SUIT_COLORS[suit];
}

// Validate bid value
export function isValidBid(bidValue: number, handSize: number): boolean {
  return bidValue >= 0 && bidValue <= handSize && Number.isInteger(bidValue);
}

// Check if it's the last bidder (dealer cannot make total bids equal hand size)
export function canBidValue(
  bidValue: number,
  handSize: number,
  currentTotalBids: number,
  isLastBidder: boolean
): { valid: boolean; reason?: string } {
  if (!isValidBid(bidValue, handSize)) {
    return { valid: false, reason: 'Invalid bid value' };
  }

  // Last bidder (dealer) cannot make total bids equal to hand size
  if (isLastBidder) {
    const wouldBeTotalBids = currentTotalBids + bidValue;
    if (wouldBeTotalBids === handSize) {
      return {
        valid: false,
        reason: `Cannot bid ${bidValue}. Total bids cannot equal ${handSize} (hand size)`,
      };
    }
  }

  return { valid: true };
}

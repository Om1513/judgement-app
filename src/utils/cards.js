// Card helpers shared by the hand, the table and their tests.

/** A card's identity. Unique within a deck, and stable as the hand shrinks. */
export const cardKey = (card) => `${card.suit}-${card.rank}`;

export const SUIT_SYMBOLS = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

export const isRedSuit = (suit) => suit === "hearts" || suit === "diamonds";

// Seat arrangement for the game table.
//
// The server sends players in seat order. The table always shows the local
// player at the bottom, with everyone else placed around them in turn order, so
// each client sees a different rotation of the same list.
//
// `seatIndex` is the on-screen slot, not the server seat:
//   0 = top, 1 = right, 2 = bottom (always me), 3 = left, 4+ = extra slots that
//   the layout spreads along the top / bottom-right for larger tables.
//
// Extracted from GameTableScreen so the rotation can be tested without
// rendering the table.

/**
 * @param {{id: string}[]} players  players in server seat order
 * @param {string} currentPlayerId  the local player
 * @returns {(object|null)[]} seat slots; `null` means "leave this slot empty"
 */
export function arrangeSeats(players, currentPlayerId) {
  if (!players || !players.length) return [];

  const myIndex = players.findIndex((p) => p.id === currentPlayerId);
  // Spectator / unknown player: fall back to the raw server order.
  if (myIndex === -1) return players;

  const at = (offset) => players[(myIndex + offset) % players.length];
  const me = { ...players[myIndex], seatIndex: 2 };

  switch (players.length) {
    // Heads-up: opponent directly opposite.
    case 2:
      return [{ ...at(1), seatIndex: 0 }, null, me, null];

    // Three: one either side, me centered at the bottom.
    case 3:
      return [
        null,
        { ...at(2), seatIndex: 1 },
        me,
        { ...at(1), seatIndex: 3 },
      ];

    // Five and up seat everyone clockwise from me (bottom-left): left -> top
    // row (left to right) -> right -> bottom-right.
    case 5:
      return [
        { ...at(2), seatIndex: 0 }, // Top
        { ...at(3), seatIndex: 1 }, // Right
        me, // Bottom-left
        { ...at(1), seatIndex: 3 }, // Left
        { ...at(4), seatIndex: 4 }, // Bottom-right
      ];

    // Six: two share the top row, clustered toward the center so the top-left
    // leave button and top-right round/trump indicator stay clear.
    case 6:
      return [
        { ...at(2), seatIndex: 0 }, // Top-left
        { ...at(4), seatIndex: 1 }, // Right
        me,
        { ...at(1), seatIndex: 3 }, // Left
        { ...at(5), seatIndex: 4 }, // Bottom-right
        { ...at(3), seatIndex: 5 }, // Top-right
      ];

    // Seven: three across the top.
    case 7:
      return [
        { ...at(2), seatIndex: 0 }, // Top-left
        { ...at(5), seatIndex: 1 }, // Right
        me,
        { ...at(1), seatIndex: 3 }, // Left
        { ...at(6), seatIndex: 4 }, // Bottom-right
        { ...at(4), seatIndex: 5 }, // Top-right
        { ...at(3), seatIndex: 6 }, // Top-center
      ];

    // Eight: four across the top.
    case 8:
      return [
        { ...at(2), seatIndex: 0 }, // Top far-left
        { ...at(6), seatIndex: 1 }, // Right
        me,
        { ...at(1), seatIndex: 3 }, // Left
        { ...at(7), seatIndex: 4 }, // Bottom-right
        { ...at(5), seatIndex: 5 }, // Top far-right
        { ...at(3), seatIndex: 6 }, // Top center-left
        { ...at(4), seatIndex: 7 }, // Top center-right
      ];

    // Four (the common case) and anything unexpected: plain rotation that puts
    // me in slot 2.
    default: {
      const arranged = [];
      for (let i = 0; i < players.length; i++) {
        const actualIndex =
          (myIndex + i - 2 + players.length) % players.length;
        arranged.push({ ...players[actualIndex], seatIndex: i });
      }
      return arranged;
    }
  }
}

// Where everything sits on the game table.
//
// Seats and played cards used to be a pile of absolute pixel offsets -
// `translateX: -235`, `right: 90`, `top: -85` - spread across two files that
// had to agree with each other by hand. Those numbers only added up on one
// viewport, and a phone with a different aspect ratio pulled the top row of
// avatars away from the cards underneath them.
//
// Everything here is expressed instead as a position inside the TABLE RECT:
//
//     x = nx * tableWidth  + dx * scale
//     y = ny * tableHeight + dy * scale
//
// The normalized part (nx, ny) tracks the table, so the eight-seat top row
// spreads with the table however wide it gets. The scaled-pixel part (dx, dy)
// is for overhangs and half-widths - the amount a seat hangs above the table
// edge should follow the design's scale, not the table's aspect ratio, or it
// walks off the top of a 4:3 tablet.
//
// Every constant below is measured off the iPhone 17 Pro layout, where the
// table rect is 834 x 172 and the scale is 1 - so on the baseline device this
// module reproduces the old hand-placed values exactly, to the pixel.
//
// Positions are CENTRES. Anchoring by centre is what lets a seat and the card
// played in front of it share one nx and stay lined up at any width.

import { clamp } from "./responsive";

// The table rect on the baseline device: the screen (874 x 402) less the
// table's own margins (90 top, 140 bottom, 20 each side).
export const BASE_TABLE_WIDTH = 834;
export const BASE_TABLE_HEIGHT = 172;

// Table margins, in baseline points. The top margin clears the round/trump
// indicator and the header buttons; the bottom one clears the player's hand.
export const TABLE_MARGIN_TOP = 90;
export const TABLE_MARGIN_BOTTOM = 140;
export const TABLE_MARGIN_SIDE = 20;

// A seat's footprint. The height is nominal - the seat box sizes itself to its
// contents - but centring needs a number, and 100 is what the original
// `translateY: -50` assumed.
export const SEAT_WIDTH = 90;
export const SEAT_HEIGHT = 100;

// A played card.
export const CARD_WIDTH = 54;
export const CARD_HEIGHT = 76;

/**
 * How far a top-row seat sits from the table midline, in baseline points.
 *
 * One table for both the avatar and the card it plays - they were previously
 * two independent lists of magic numbers that happened to match. At eight
 * players these four offsets are exactly symmetric about the midline, which is
 * the arithmetic that pins BASE_TABLE_WIDTH to 834.
 */
export function topSeatOffset(seatIndex, playerCount) {
  if (playerCount <= 5) return 0; // one centred top seat

  if (playerCount === 6 || playerCount === 7) {
    if (seatIndex === 0) return -150;
    if (seatIndex === 5) return 150;
    return 0; // seat 6, the top-centre seat of a seven-player table
  }

  // Eight: four across the top.
  if (seatIndex === 0) return -190;
  if (seatIndex === 6) return -65;
  if (seatIndex === 7) return 65;
  if (seatIndex === 5) return 190;
  return 0;
}

/** The same offset as a fraction of the table width. */
export function topSeatNx(seatIndex, playerCount) {
  return 0.5 + topSeatOffset(seatIndex, playerCount) / BASE_TABLE_WIDTH;
}

const TOP_SEATS = new Set([0, 5, 6, 7]);

/**
 * The normalized position of a seat's centre.
 *
 * @returns {{nx: number, ny: number, dx: number, dy: number}}
 */
export function getSeatSpec(seatIndex, playerCount) {
  if (TOP_SEATS.has(seatIndex)) {
    // Top seats hang above the table by a fixed scaled amount; only their
    // horizontal spread follows the table.
    return { nx: topSeatNx(seatIndex, playerCount), ny: 0, dx: 0, dy: -35 };
  }

  switch (seatIndex) {
    case 1: // Right - pinned to the table's right edge, vertically centred.
      // Three players raise the side seats above centre so they clear the
      // bottom-left "You" seat.
      return { nx: 1, ny: playerCount === 3 ? 0.4 : 0.5, dx: -SEAT_WIDTH / 2, dy: 0 };
    case 3: // Left
      return { nx: 0, ny: playerCount === 3 ? 0.4 : 0.5, dx: SEAT_WIDTH / 2, dy: 0 };
    case 4: // Bottom-right, the mirror of "You" at the bottom-left.
      return { nx: 1, ny: 1, dx: -65, dy: -74 };
    case 2: // Bottom (the local player) is anchored to the screen, not the
            // table - see GameTableScreen. Centre of the table is a sane
            // fallback if anything ever asks.
    default:
      return { nx: 0.5, ny: 1, dx: 0, dy: -SEAT_HEIGHT / 2 };
  }
}

/**
 * Resolves a seat spec against a measured table rect.
 *
 * @param {number} seatIndex   on-screen slot (see utils/seating)
 * @param {number} playerCount players at the table
 * @param {{width: number, height: number}} table  measured table rect, in px
 * @param {number} scale       the app's uniform scale factor
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function getSeatPosition(seatIndex, playerCount, table, scale = 1) {
  const spec = getSeatSpec(seatIndex, playerCount);
  const width = SEAT_WIDTH * scale;
  const height = SEAT_HEIGHT * scale;
  const cx = spec.nx * table.width + spec.dx * scale;
  const cy = spec.ny * table.height + spec.dy * scale;
  return { left: cx - width / 2, top: cy - height / 2, width, height };
}

/**
 * The normalized position of a seat's played card, plus how it animates.
 *
 * `point` is the anchor cards slide toward when a trick resolves. It is a
 * direction anchor rather than a real position - roughly where the player is,
 * not where their card is - so a trick collapses toward the winner without
 * every card flying the full width of the table.
 */
export function getCardSpec(seatIndex, playerCount) {
  if (TOP_SEATS.has(seatIndex)) {
    const nx = topSeatNx(seatIndex, playerCount);
    return {
      nx, ny: 0, dx: 0, dy: 54,
      enterFrom: { x: 0, y: -26 },
      point: { nx, dy: -120 },
    };
  }

  switch (seatIndex) {
    case 1: // Right - just inboard of the right seat, in line with it.
      return {
        nx: 1, ny: 0.5, dx: -117, dy: -3,
        enterFrom: { x: 30, y: 0 },
        point: { nx: 0.5 + 130 / BASE_TABLE_WIDTH, dy: 0 },
      };
    case 3: // Left
      return {
        nx: 0, ny: 0.5, dx: 117, dy: -3,
        enterFrom: { x: -30, y: 0 },
        point: { nx: 0.5 - 130 / BASE_TABLE_WIDTH, dy: 0 },
      };
    case 4: // Bottom-right - the right column, but down beside its avatar.
      return {
        nx: 1, ny: 1, dx: -117, dy: 72,
        enterFrom: { x: 22, y: 24 },
        point: { nx: 0.5 + 130 / BASE_TABLE_WIDTH, dy: 120 },
      };
    case 2: // Bottom (me). The "You" avatar lives in the corner, but our card
            // sits centre-bottom, opposite the top player's, to close the
            // diamond.
    default:
      return {
        nx: 0.5, ny: 1, dx: 0, dy: 4,
        enterFrom: { x: 0, y: 26 },
        point: { nx: 0.5, dy: 130 },
      };
  }
}

/**
 * Resolves a card spec against a measured table rect.
 *
 * @returns {{left, top, width, height, enterFrom: {x, y}, point: {x, y}}}
 */
export function getCardZone(seatIndex, playerCount, table, scale = 1) {
  const spec = getCardSpec(seatIndex, playerCount);
  const width = CARD_WIDTH * scale;
  const height = CARD_HEIGHT * scale;
  const cx = spec.nx * table.width + spec.dx * scale;
  const cy = spec.ny * table.height + spec.dy * scale;

  return {
    left: cx - width / 2,
    top: cy - height / 2,
    width,
    height,
    enterFrom: {
      x: spec.enterFrom.x * scale,
      y: spec.enterFrom.y * scale,
    },
    point: {
      x: spec.point.nx * table.width,
      y: 0.5 * table.height + spec.point.dy * scale,
    },
  };
}

/**
 * Fans the local player's hand across the width it actually has.
 *
 * The baseline design overlaps cards by 16pt (a -8 margin either side), which
 * fits any hand this game deals on a phone-sized screen. On a narrower one, or
 * with a long hand, the overlap tightens instead of the cards shrinking - a
 * smaller card is unreadable, whereas a card with only its corner showing is
 * still perfectly playable, which is how a real fanned hand works anyway.
 *
 * Below `minVisible` the fan stops tightening and the hand scrolls instead.
 *
 * @returns {{cardWidth, stride, margin, totalWidth, overflows}}
 *   `margin` is the per-side marginHorizontal to apply (negative = overlap).
 */
export function getHandCardLayout({
  availableWidth,
  cardCount,
  cardWidth,
  baseOverlap = 16,
}) {
  const defaultStride = cardWidth - baseOverlap;
  // Enough of each card to read its rank and hit it with a thumb.
  const minStride = Math.max(cardWidth * 0.3, 12);

  if (cardCount <= 1) {
    return {
      cardWidth,
      stride: defaultStride,
      margin: -baseOverlap / 2,
      totalWidth: cardCount * cardWidth,
      overflows: cardCount * cardWidth > availableWidth,
    };
  }

  const needed = cardWidth + (cardCount - 1) * defaultStride;
  const fitted = (availableWidth - cardWidth) / (cardCount - 1);
  const stride = needed <= availableWidth
    ? defaultStride
    : clamp(fitted, minStride, defaultStride);

  const totalWidth = cardWidth + (cardCount - 1) * stride;

  return {
    cardWidth,
    stride,
    margin: (stride - cardWidth) / 2,
    totalWidth,
    overflows: totalWidth > availableWidth,
  };
}

// Game-table geometry.
//
// Two things are being protected here. First, that the baseline device still
// gets the exact hand-placed pixel positions the design was tuned to - these
// tests carry those original numbers, so a change to the normalized specs that
// moves anything on an iPhone 17 Pro fails immediately. Second, that the
// arrangement stays sane on viewports the baseline numbers know nothing about:
// seats on the table, cards under their own avatar, nothing off-screen.

import {
  BASE_TABLE_HEIGHT,
  BASE_TABLE_WIDTH,
  CARD_HEIGHT,
  CARD_WIDTH,
  SEAT_HEIGHT,
  SEAT_WIDTH,
  getCardZone,
  getHandCardLayout,
  getSeatPosition,
  topSeatOffset,
} from "../tableLayout";

const BASE_TABLE = { width: BASE_TABLE_WIDTH, height: BASE_TABLE_HEIGHT };

// A few table rects, as they come out on real devices once the scaled margins
// are taken off. Only the ratios matter to the maths under test.
const TABLES = {
  smallPhone: { table: { width: 616, height: 199 }, scale: 0.763 },
  baseline: { table: BASE_TABLE, scale: 1 },
  wide: { table: { width: 1160, height: 172 }, scale: 1 }, // 21:9
  tablet: { table: { width: 978, height: 499 }, scale: 1.171 }, // 4:3
};

const centreOf = (box) => ({
  x: box.left + box.width / 2,
  y: box.top + box.height / 2,
});

describe("the baseline layout is reproduced exactly", () => {
  // These are the literal values from the original hand-placed stylesheet,
  // converted to top-left corners. If any of them changes, the reference
  // device's table has moved.
  const seat = (i, n) => getSeatPosition(i, n, BASE_TABLE, 1);

  it("places a four-player table where it always was", () => {
    expect(seat(0, 4)).toMatchObject({ left: 372, top: -85 }); // top, centred
    expect(seat(1, 4)).toMatchObject({ left: 744, top: 36 }); // right edge
    expect(seat(3, 4)).toMatchObject({ left: 0, top: 36 }); // left edge
  });

  it("raises the side seats for three players", () => {
    expect(seat(1, 3).top).toBeCloseTo(0.4 * BASE_TABLE_HEIGHT - SEAT_HEIGHT / 2, 5);
    expect(seat(3, 3).top).toBeCloseTo(0.4 * BASE_TABLE_HEIGHT - SEAT_HEIGHT / 2, 5);
  });

  it("splits the top row for six and seven players", () => {
    expect(seat(0, 6).left).toBeCloseTo(222, 5);
    expect(seat(5, 6).left).toBeCloseTo(522, 5);
    expect(seat(6, 7).left).toBeCloseTo(372, 5); // centred on the midline
  });

  it("fits four seats across the top for eight players", () => {
    expect(seat(0, 8).left).toBeCloseTo(182, 5);
    expect(seat(6, 8).left).toBeCloseTo(307, 5);
    expect(seat(7, 8).left).toBeCloseTo(437, 5);
    expect(seat(5, 8).left).toBeCloseTo(562, 5);
  });

  it("puts played cards exactly where the original stylesheet did", () => {
    const zone = (i, n) => getCardZone(i, n, BASE_TABLE, 1);
    expect(zone(0, 4)).toMatchObject({ left: 390, top: 16 }); // top
    expect(zone(1, 4)).toMatchObject({ left: 690, top: 45 }); // right
    expect(zone(3, 4)).toMatchObject({ left: 90, top: 45 }); // left
    expect(zone(2, 4)).toMatchObject({ left: 390, top: 138 }); // me
    expect(zone(4, 5)).toMatchObject({ left: 690, top: 206 }); // bottom-right
  });

  it("keeps the original entrance directions", () => {
    expect(getCardZone(0, 4, BASE_TABLE, 1).enterFrom).toEqual({ x: 0, y: -26 });
    expect(getCardZone(1, 4, BASE_TABLE, 1).enterFrom).toEqual({ x: 30, y: 0 });
    expect(getCardZone(3, 4, BASE_TABLE, 1).enterFrom).toEqual({ x: -30, y: 0 });
    expect(getCardZone(2, 4, BASE_TABLE, 1).enterFrom).toEqual({ x: 0, y: 26 });
  });
});

describe("the top row is symmetric about the midline", () => {
  it("mirrors its offsets for six, seven and eight players", () => {
    expect(topSeatOffset(0, 6)).toBe(-topSeatOffset(5, 6));
    expect(topSeatOffset(0, 7)).toBe(-topSeatOffset(5, 7));
    expect(topSeatOffset(6, 7)).toBe(0);
    expect(topSeatOffset(0, 8)).toBe(-topSeatOffset(5, 8));
    expect(topSeatOffset(6, 8)).toBe(-topSeatOffset(7, 8));
  });

  it("orders the eight-player row left to right with no crossings", () => {
    const order = [0, 6, 7, 5].map((i) => topSeatOffset(i, 8));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("stays symmetric on every table width", () => {
    for (const { table, scale } of Object.values(TABLES)) {
      const left = centreOf(getSeatPosition(0, 8, table, scale)).x;
      const right = centreOf(getSeatPosition(5, 8, table, scale)).x;
      expect(left + right).toBeCloseTo(table.width, 5);
    }
  });
});

describe("a card always lands in front of its own player", () => {
  it("shares the avatar's centre line on the top row, at any width", () => {
    for (const { table, scale } of Object.values(TABLES)) {
      for (const count of [6, 7, 8]) {
        for (const seatIndex of [0, 5, 6, 7]) {
          if (count === 6 && (seatIndex === 6 || seatIndex === 7)) continue;
          if (count === 7 && seatIndex === 7) continue;
          const avatar = centreOf(getSeatPosition(seatIndex, count, table, scale));
          const card = centreOf(getCardZone(seatIndex, count, table, scale));
          expect(card.x).toBeCloseTo(avatar.x, 5);
          // ...and below it, on the table side.
          expect(card.y).toBeGreaterThan(avatar.y);
        }
      }
    }
  });

  it("puts the side players' cards inboard of their avatars", () => {
    for (const { table, scale } of Object.values(TABLES)) {
      const rightAvatar = centreOf(getSeatPosition(1, 4, table, scale));
      const rightCard = centreOf(getCardZone(1, 4, table, scale));
      expect(rightCard.x).toBeLessThan(rightAvatar.x);

      const leftAvatar = centreOf(getSeatPosition(3, 4, table, scale));
      const leftCard = centreOf(getCardZone(3, 4, table, scale));
      expect(leftCard.x).toBeGreaterThan(leftAvatar.x);
    }
  });

  it("keeps the side cards level with their avatars", () => {
    for (const { table, scale } of Object.values(TABLES)) {
      for (const seatIndex of [1, 3]) {
        const avatar = centreOf(getSeatPosition(seatIndex, 4, table, scale));
        const card = centreOf(getCardZone(seatIndex, 4, table, scale));
        expect(Math.abs(card.y - avatar.y)).toBeLessThan(10 * scale);
      }
    }
  });
});

describe("nothing runs off the table", () => {
  it("keeps every seat's horizontal span inside the table on every viewport", () => {
    for (const { table, scale } of Object.values(TABLES)) {
      for (let count = 2; count <= 8; count++) {
        for (const seatIndex of [0, 1, 3, 5, 6, 7]) {
          const box = getSeatPosition(seatIndex, count, table, scale);
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.left + box.width).toBeLessThanOrEqual(table.width + 0.001);
        }
      }
    }
  });

  it("never overlaps two seats on the eight-player top row", () => {
    for (const { table, scale } of Object.values(TABLES)) {
      const boxes = [0, 6, 7, 5]
        .map((i) => getSeatPosition(i, 8, table, scale))
        .sort((a, b) => a.left - b.left);
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].left).toBeGreaterThanOrEqual(
          boxes[i - 1].left + boxes[i - 1].width
        );
      }
    }
  });

  it("keeps every played card inside the table's width", () => {
    for (const { table, scale } of Object.values(TABLES)) {
      for (let count = 2; count <= 8; count++) {
        for (const seatIndex of [0, 1, 2, 3, 4, 5, 6, 7]) {
          const zone = getCardZone(seatIndex, count, table, scale);
          expect(zone.left).toBeGreaterThanOrEqual(0);
          expect(zone.left + zone.width).toBeLessThanOrEqual(table.width + 0.001);
        }
      }
    }
  });
});

describe("seats and cards scale with the design", () => {
  it("sizes a seat and a card from the scale factor alone", () => {
    const box = getSeatPosition(0, 4, TABLES.tablet.table, TABLES.tablet.scale);
    expect(box.width).toBeCloseTo(SEAT_WIDTH * TABLES.tablet.scale, 5);
    expect(box.height).toBeCloseTo(SEAT_HEIGHT * TABLES.tablet.scale, 5);

    const zone = getCardZone(0, 4, TABLES.tablet.table, TABLES.tablet.scale);
    expect(zone.width).toBeCloseTo(CARD_WIDTH * TABLES.tablet.scale, 5);
    expect(zone.height).toBeCloseTo(CARD_HEIGHT * TABLES.tablet.scale, 5);
  });

  it("scales the entrance travel too, so the animation reads the same", () => {
    const zone = getCardZone(1, 4, TABLES.smallPhone.table, TABLES.smallPhone.scale);
    expect(zone.enterFrom.x).toBeCloseTo(30 * TABLES.smallPhone.scale, 5);
  });
});

describe("the collect-to-winner anchors", () => {
  it("pull a losing card toward the winner's side of the table", () => {
    for (const { table, scale } of Object.values(TABLES)) {
      const left = getCardZone(3, 4, table, scale).point;
      const right = getCardZone(1, 4, table, scale).point;
      const top = getCardZone(0, 4, table, scale).point;
      const me = getCardZone(2, 4, table, scale).point;

      expect(right.x - left.x).toBeGreaterThan(0); // right really is to the right
      expect(me.y - top.y).toBeGreaterThan(0); // and "me" really is below the top
    }
  });
});

describe("the player's hand", () => {
  const CARD = 55;

  it("keeps the design's 16pt overlap when there is room", () => {
    const layout = getHandCardLayout({
      availableWidth: 834,
      cardCount: 8,
      cardWidth: CARD,
    });
    expect(layout.margin).toBe(-8);
    expect(layout.stride).toBe(CARD - 16);
    expect(layout.overflows).toBe(false);
  });

  it("tightens the overlap rather than shrinking the cards", () => {
    const layout = getHandCardLayout({
      availableWidth: 200,
      cardCount: 8,
      cardWidth: CARD,
    });
    expect(layout.cardWidth).toBe(CARD); // cards keep their size
    expect(layout.stride).toBeLessThan(CARD - 16); // they just overlap more
    expect(layout.totalWidth).toBeLessThanOrEqual(200 + 0.001);
  });

  it("stops tightening before a card becomes untappable, and scrolls instead", () => {
    const layout = getHandCardLayout({
      availableWidth: 60,
      cardCount: 13,
      cardWidth: CARD,
    });
    expect(layout.stride).toBeGreaterThanOrEqual(CARD * 0.3);
    expect(layout.overflows).toBe(true);
  });

  it("fits every real hand size on the smallest supported screen", () => {
    // Rounds run 1..8, so eight cards is the largest hand this game deals.
    for (let count = 1; count <= 8; count++) {
      const layout = getHandCardLayout({
        availableWidth: 616, // small-phone table width
        cardCount: count,
        cardWidth: 42, // 55pt at the small-phone scale
      });
      expect(layout.overflows).toBe(false);
    }
  });

  it("handles an empty or single-card hand without dividing by zero", () => {
    for (const cardCount of [0, 1]) {
      const layout = getHandCardLayout({
        availableWidth: 400,
        cardCount,
        cardWidth: CARD,
      });
      expect(Number.isFinite(layout.stride)).toBe(true);
      expect(Number.isFinite(layout.margin)).toBe(true);
    }
  });
});

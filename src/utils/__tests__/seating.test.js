// Table seating.
//
// The invariant that matters on every table size: the local player is in slot 2
// (bottom), everyone else appears exactly once, and turn order is preserved
// going clockwise from the local player.

import { arrangeSeats } from "../seating";

const players = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));

const occupied = (seats) => seats.filter(Boolean);

describe("the local player", () => {
  it("is always in the bottom slot", () => {
    for (let n = 2; n <= 8; n++) {
      const list = players(n);
      for (const me of list) {
        const seats = arrangeSeats(list, me.id);
        expect(seats[2].id).toBe(me.id);
        expect(seats[2].seatIndex).toBe(2);
      }
    }
  });
});

describe("everyone is seated exactly once", () => {
  it("holds for every table size and every viewer", () => {
    for (let n = 2; n <= 8; n++) {
      const list = players(n);
      for (const me of list) {
        const ids = occupied(arrangeSeats(list, me.id)).map((p) => p.id);
        expect(ids).toHaveLength(n);
        expect([...ids].sort()).toEqual(list.map((p) => p.id).sort());
      }
    }
  });
});

describe("slot layout per table size", () => {
  it("puts a heads-up opponent at the top with the sides empty", () => {
    const seats = arrangeSeats(players(2), "p1");
    expect(seats.map((s) => s && s.id)).toEqual(["p2", null, "p1", null]);
  });

  it("splits three players left and right of the viewer", () => {
    const seats = arrangeSeats(players(3), "p1");
    expect(seats.map((s) => s && s.id)).toEqual([null, "p3", "p1", "p2"]);
  });

  it("uses all four slots for a four-player table", () => {
    const seats = arrangeSeats(players(4), "p1");
    expect(seats.map((s) => s.id)).toEqual(["p3", "p4", "p1", "p2"]);
    expect(seats.map((s) => s.seatIndex)).toEqual([0, 1, 2, 3]);
  });

  it("seats five to eight players with no empty slots", () => {
    for (let n = 5; n <= 8; n++) {
      const seats = arrangeSeats(players(n), "p1");
      expect(seats).toHaveLength(n);
      expect(occupied(seats)).toHaveLength(n);
      expect(seats.map((s) => s.seatIndex).sort((a, b) => a - b)).toEqual(
        Array.from({ length: n }, (_, i) => i)
      );
    }
  });
});

describe("turn order is preserved", () => {
  it("puts the next player to act on the viewer immediate left", () => {
    // Slot 3 is the "left" seat, which is the next player in turn order.
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const list = players(n);
      const seats = arrangeSeats(list, "p1");
      const left = seats.find((s) => s && s.seatIndex === 3);
      expect(left.id).toBe("p2");
    }
  });

  it("rotates rather than reorders - each viewer sees the same cycle", () => {
    const list = players(4);
    const asP1 = arrangeSeats(list, "p1").map((s) => s.id);
    const asP2 = arrangeSeats(list, "p2").map((s) => s.id);

    // Both are rotations of the same 4-cycle p1 -> p2 -> p3 -> p4.
    const rotationOf = (arr, by) => arr.map((_, i) => arr[(i + by) % arr.length]);
    expect(rotationOf(asP1, 1)).toEqual(asP2);
  });
});

describe("degenerate input", () => {
  it("returns nothing for an empty table", () => {
    expect(arrangeSeats([], "p1")).toEqual([]);
    expect(arrangeSeats(null, "p1")).toEqual([]);
    expect(arrangeSeats(undefined, "p1")).toEqual([]);
  });

  it("falls back to server order for an unknown viewer", () => {
    const list = players(4);
    expect(arrangeSeats(list, "not-at-this-table")).toEqual(list);
  });

  it("does not mutate the list it was given", () => {
    const list = players(6);
    const before = JSON.stringify(list);
    arrangeSeats(list, "p3");
    expect(JSON.stringify(list)).toBe(before);
  });

  it("copies each player rather than tagging the originals", () => {
    const list = players(4);
    arrangeSeats(list, "p1");
    expect(list.every((p) => p.seatIndex === undefined)).toBe(true);
  });
});

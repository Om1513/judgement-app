// Who deals, who opens the bidding, and who leads - round by round.
//
// The dealer moves one seat clockwise every round and bids last, so the player
// to the dealer's left starts the round. With four players the whole cycle
// repeats every four rounds.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { getRoundRotation } from '../../utils/rotation';

const FOUR = ['p1', 'p2', 'p3', 'p4'];

describe('round starter for four players', () => {
  test('the dealer rotates one seat per round and wraps', () => {
    assert.equal(getRoundRotation(1, FOUR).dealerId, 'p1');
    assert.equal(getRoundRotation(2, FOUR).dealerId, 'p2');
    assert.equal(getRoundRotation(3, FOUR).dealerId, 'p3');
    assert.equal(getRoundRotation(4, FOUR).dealerId, 'p4');
    assert.equal(getRoundRotation(5, FOUR).dealerId, 'p1', 'round 5 repeats round 1');
  });

  test('the player to the dealer left opens the bidding and leads', () => {
    const starters = [1, 2, 3, 4, 5].map((r) => getRoundRotation(r, FOUR).bidOrder[0]);
    assert.deepEqual(starters, ['p2', 'p3', 'p4', 'p1', 'p2']);
  });

  test('the starter index matches the seat index of the starting player', () => {
    for (let round = 1; round <= 8; round++) {
      const rotation = getRoundRotation(round, FOUR);
      assert.equal(FOUR[rotation.firstBidderIndex], rotation.bidOrder[0]);
    }
  });
});

describe('bid order', () => {
  test('runs clockwise from the dealer left, with the dealer last', () => {
    assert.deepEqual(getRoundRotation(1, FOUR).bidOrder, ['p2', 'p3', 'p4', 'p1']);
    assert.deepEqual(getRoundRotation(2, FOUR).bidOrder, ['p3', 'p4', 'p1', 'p2']);
    assert.deepEqual(getRoundRotation(3, FOUR).bidOrder, ['p4', 'p1', 'p2', 'p3']);
    assert.deepEqual(getRoundRotation(4, FOUR).bidOrder, ['p1', 'p2', 'p3', 'p4']);
  });

  test('always includes every player exactly once', () => {
    for (let players = 2; players <= 8; players++) {
      const seats = Array.from({ length: players }, (_, i) => `p${i + 1}`);
      for (let round = 1; round <= 8; round++) {
        const { bidOrder } = getRoundRotation(round, seats);
        assert.equal(bidOrder.length, players);
        assert.deepEqual([...bidOrder].sort(), [...seats].sort());
      }
    }
  });

  test('the dealer is always the last to bid', () => {
    for (let players = 2; players <= 8; players++) {
      const seats = Array.from({ length: players }, (_, i) => `p${i + 1}`);
      for (let round = 1; round <= 8; round++) {
        const { bidOrder, dealerId } = getRoundRotation(round, seats);
        assert.equal(bidOrder[bidOrder.length - 1], dealerId, `${players}p round ${round}`);
      }
    }
  });
});

describe('other table sizes', () => {
  test('a three-player table cycles every three rounds', () => {
    const three = ['a', 'b', 'c'];
    assert.deepEqual(
      [1, 2, 3, 4].map((r) => getRoundRotation(r, three).dealerId),
      ['a', 'b', 'c', 'a']
    );
  });

  test('heads-up alternates the dealer every round', () => {
    const two = ['a', 'b'];
    assert.deepEqual(
      [1, 2, 3, 4].map((r) => getRoundRotation(r, two).dealerId),
      ['a', 'b', 'a', 'b']
    );
  });
});

describe('degenerate input', () => {
  test('an empty table is a programming error, not a silent no-op', () => {
    assert.throws(() => getRoundRotation(1, []), /no players/i);
  });
});

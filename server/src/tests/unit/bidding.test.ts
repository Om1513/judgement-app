// Bid validation.
//
// Two separate rules: a bid must fit the hand, and the dealer (who bids last)
// may not make the total equal the hand size - somebody always has to be wrong.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { isValidBid, canBidValue } from '../../utils/trump';
import { validateBid } from '../../utils/validateLobby';
import { getCardsForRound } from '../../utils/cardUtils';

describe('valid bid range per round', () => {
  test('round 1 deals one card, so bids are 0 or 1', () => {
    const handSize = getCardsForRound(1, 8);
    assert.equal(handSize, 1);

    assert.equal(isValidBid(0, handSize), true);
    assert.equal(isValidBid(1, handSize), true);
    assert.equal(isValidBid(2, handSize), false);
  });

  test('round 2 deals two cards, so bids are 0-2', () => {
    const handSize = getCardsForRound(2, 8);
    assert.deepEqual(
      [0, 1, 2, 3].map((b) => isValidBid(b, handSize)),
      [true, true, true, false]
    );
  });

  test('the legal range is always 0..handSize, for every round', () => {
    for (let round = 1; round <= 8; round++) {
      const handSize = getCardsForRound(round, 8);
      for (let bid = 0; bid <= handSize; bid++) {
        assert.equal(isValidBid(bid, handSize), true, `round ${round} bid ${bid}`);
      }
      assert.equal(isValidBid(handSize + 1, handSize), false, `round ${round} overbid`);
    }
  });
});

describe('rejected bids', () => {
  test('a negative bid is rejected', () => {
    assert.equal(isValidBid(-1, 4), false);
    assert.equal(validateBid(-1, 4, 0, false).valid, false);
    assert.match(validateBid(-1, 4, 0, false).error!, /negative/i);
  });

  test('a bid above the hand size is rejected', () => {
    assert.equal(isValidBid(5, 4), false);
    const result = validateBid(5, 4, 0, false);
    assert.equal(result.valid, false);
    assert.match(result.error!, /cannot exceed 4/);
  });

  test('a non-integer bid is rejected', () => {
    assert.equal(isValidBid(1.5, 4), false);
    const result = validateBid(1.5, 4, 0, false);
    assert.equal(result.valid, false);
    assert.match(result.error!, /integer/i);
  });

  test('a non-numeric bid is rejected rather than coerced', () => {
    const result = validateBid('2' as unknown as number, 4, 0, false);
    assert.equal(result.valid, false);
    assert.match(result.error!, /integer/i);
  });

  test('NaN is rejected', () => {
    assert.equal(isValidBid(NaN, 4), false);
    assert.equal(validateBid(NaN, 4, 0, false).valid, false);
  });
});

describe('the dealer constraint (last bidder)', () => {
  test('the dealer cannot make the bids total the hand size', () => {
    // Hand size 4, three players have bid 3 between them: the dealer may not bid 1.
    const result = canBidValue(1, 4, 3, true);
    assert.equal(result.valid, false);
    assert.match(result.reason!, /Total bids cannot equal 4/);
  });

  test('every other value stays open to the dealer', () => {
    for (const bid of [0, 2, 3, 4]) {
      assert.equal(canBidValue(bid, 4, 3, true).valid, true, `bid ${bid}`);
    }
  });

  test('the same total is fine for anyone who is not last to bid', () => {
    assert.equal(canBidValue(1, 4, 3, false).valid, true);
  });

  test('validateBid enforces the identical rule', () => {
    assert.equal(validateBid(1, 4, 3, true).valid, false);
    assert.equal(validateBid(1, 4, 3, false).valid, true);
  });

  test('the dealer can still be blocked from zero when the total is already exact', () => {
    // Hand size 1, the only other bidder took it: the dealer must bid 1.
    assert.equal(canBidValue(0, 1, 1, true).valid, false);
    assert.equal(canBidValue(1, 1, 1, true).valid, true);
  });

  test('an out-of-range bid is rejected before the dealer rule is even considered', () => {
    const result = canBidValue(9, 4, 0, true);
    assert.equal(result.valid, false);
    assert.match(result.reason!, /Invalid bid value/);
  });
});

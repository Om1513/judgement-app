// Lobby codes.
//
// Six characters that a player has to read out loud and someone else has to
// type in, so the format matters: uppercase, alphanumeric, fixed length.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateLobbyCode,
  generateUniqueLobbyCode,
  isValidLobbyCode,
} from '../../utils/generateLobbyCode';
import { withSeed, withFixedRandom } from '../helpers/random';

describe('generated code format', () => {
  test('is always exactly six uppercase alphanumeric characters', () => {
    for (let seed = 0; seed < 200; seed++) {
      const code = withSeed(seed, () => generateLobbyCode());
      assert.equal(code.length, 6, `${code} is not six characters`);
      assert.match(code, /^[A-Z0-9]{6}$/, `${code} contains an invalid character`);
      assert.equal(code, code.toUpperCase());
    }
  });

  test('uses the whole alphabet, not a narrow slice of it', () => {
    const chars = new Set<string>();
    for (let seed = 0; seed < 500; seed++) {
      for (const ch of withSeed(seed, () => generateLobbyCode())) {
        chars.add(ch);
      }
    }
    // 36 possible characters; seeing most of them rules out an off-by-one in
    // the index calculation clipping the ends of the alphabet.
    assert.ok(chars.size >= 30, `only saw ${chars.size} distinct characters`);
    assert.ok(chars.has('A') || chars.has('0'), 'the first characters are reachable');
  });

  test('a random draw of 0 gives the first character, just under 1 the last', () => {
    assert.equal(withFixedRandom(0, () => generateLobbyCode()), 'AAAAAA');
    assert.equal(withFixedRandom(0.9999, () => generateLobbyCode()), '999999');
  });

  test('two codes in a row are not identical', () => {
    withSeed(42, () => {
      assert.notEqual(generateLobbyCode(), generateLobbyCode());
    });
  });
});

describe('isValidLobbyCode', () => {
  test('accepts a well-formed code', () => {
    assert.equal(isValidLobbyCode('AB12CD'), true);
    assert.equal(isValidLobbyCode('000000'), true);
    assert.equal(isValidLobbyCode('ZZZZZZ'), true);
  });

  test('rejects the wrong length', () => {
    assert.equal(isValidLobbyCode('AB12C'), false);
    assert.equal(isValidLobbyCode('AB12CDE'), false);
    assert.equal(isValidLobbyCode(''), false);
  });

  test('rejects lowercase and punctuation', () => {
    assert.equal(isValidLobbyCode('ab12cd'), false);
    assert.equal(isValidLobbyCode('AB-2CD'), false);
    assert.equal(isValidLobbyCode('AB 2CD'), false);
  });

  test('rejects non-strings without throwing', () => {
    assert.equal(isValidLobbyCode(null as unknown as string), false);
    assert.equal(isValidLobbyCode(undefined as unknown as string), false);
    assert.equal(isValidLobbyCode(123456 as unknown as string), false);
  });

  test('accepts everything generateLobbyCode produces', () => {
    for (let seed = 0; seed < 100; seed++) {
      assert.equal(isValidLobbyCode(withSeed(seed, () => generateLobbyCode())), true);
    }
  });
});

describe('collision handling', () => {
  test('returns a code that is not already taken', async () => {
    const taken = new Set(['AAAAAA', 'BBBBBB']);
    const code = await withSeed(7, () => generateUniqueLobbyCode(taken));
    assert.ok(!taken.has(code));
    assert.equal(isValidLobbyCode(code), true);
  });

  test('retries past a collision instead of handing back a duplicate', async () => {
    // Pin the seed, take whatever the first draw would be, then ask again from
    // the same seed with that code already claimed.
    const firstDraw = withSeed(2024, () => generateLobbyCode());

    const code = await withSeed(2024, () => generateUniqueLobbyCode([firstDraw]));

    assert.notEqual(code, firstDraw, 'must not return the colliding code');
    assert.equal(isValidLobbyCode(code), true);
  });

  test('accepts either an array or a Set of taken codes', async () => {
    const asArray = await withSeed(1, () => generateUniqueLobbyCode(['AAAAAA']));
    const asSet = await withSeed(1, () => generateUniqueLobbyCode(new Set(['AAAAAA'])));
    assert.equal(asArray, asSet);
  });

  test('gives up loudly when every attempt collides', async () => {
    // Math.random pinned to 0 makes every code 'AAAAAA', which is taken.
    await assert.rejects(
      () => withFixedRandom(0, () => generateUniqueLobbyCode(['AAAAAA'], 5)),
      /Failed to generate unique lobby code/
    );
  });
});

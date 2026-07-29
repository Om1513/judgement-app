// Lobby settings, player names and the can-we-start check.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateLobbySettings,
  validatePlayerName,
  canStartGame,
  LOBBY_CONSTRAINTS,
} from '../../utils/validateLobby';
import { DEFAULT_LOBBY_SETTINGS } from '../../types/lobby';

describe('validateLobbySettings', () => {
  test('an empty object yields the documented defaults', () => {
    const result = validateLobbySettings({});
    assert.equal(result.valid, true);
    assert.deepEqual(result.settings, DEFAULT_LOBBY_SETTINGS);
  });

  test('accepts the full legal range of rounds', () => {
    for (let rounds = LOBBY_CONSTRAINTS.MIN_ROUNDS; rounds <= LOBBY_CONSTRAINTS.MAX_ROUNDS; rounds++) {
      const result = validateLobbySettings({ rounds });
      assert.equal(result.valid, true, `rounds=${rounds}`);
      assert.equal(result.settings.rounds, rounds);
    }
  });

  test('rejects rounds outside the range and says why', () => {
    for (const rounds of [0, 3, 9, 100]) {
      const result = validateLobbySettings({ rounds });
      assert.equal(result.valid, false, `rounds=${rounds}`);
      assert.match(result.errors[0], /Rounds must be between 4 and 8/);
    }
  });

  test('rejects maxPlayers outside the range', () => {
    assert.equal(validateLobbySettings({ maxPlayers: 1 }).valid, false);
    assert.equal(validateLobbySettings({ maxPlayers: 9 }).valid, false);
    assert.equal(validateLobbySettings({ maxPlayers: 2 }).valid, true);
    assert.equal(validateLobbySettings({ maxPlayers: 8 }).valid, true);
  });

  test('accepts both order modes and rejects anything else', () => {
    assert.equal(validateLobbySettings({ orderMode: 'Kachuful' }).settings.orderMode, 'Kachuful');
    assert.equal(validateLobbySettings({ orderMode: 'Random' }).settings.orderMode, 'Random');

    const bad = validateLobbySettings({ orderMode: 'Chaos' as never });
    assert.equal(bad.valid, false);
    assert.match(bad.errors[0], /Order mode must be one of/);
  });

  test('accepts both scoring modes and rejects anything else', () => {
    assert.equal(validateLobbySettings({ scoringMode: '+10' }).settings.scoringMode, '+10');
    assert.equal(validateLobbySettings({ scoringMode: '+1' }).settings.scoringMode, '+1');

    const bad = validateLobbySettings({ scoringMode: 'x2' as never });
    assert.equal(bad.valid, false);
    assert.match(bad.errors[0], /Scoring mode must be one of/);
  });

  test('floors fractional numbers rather than storing them', () => {
    const result = validateLobbySettings({ rounds: 5.9, maxPlayers: 4.7 });
    assert.equal(result.valid, true);
    assert.equal(result.settings.rounds, 5);
    assert.equal(result.settings.maxPlayers, 4);
  });

  test('collects every problem at once instead of stopping at the first', () => {
    const result = validateLobbySettings({
      rounds: 99,
      maxPlayers: 0,
      orderMode: 'Nope' as never,
    });
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 3);
  });

  test('an invalid field falls back to its default rather than being dropped', () => {
    const result = validateLobbySettings({ rounds: 99 });
    assert.equal(result.settings.rounds, DEFAULT_LOBBY_SETTINGS.rounds);
  });
});

describe('validatePlayerName', () => {
  test('accepts a normal name and trims surrounding whitespace', () => {
    const result = validatePlayerName('  Omkar  ');
    assert.equal(result.valid, true);
    assert.equal(result.sanitized, 'Omkar');
  });

  test('rejects an empty or whitespace-only name', () => {
    assert.equal(validatePlayerName('').valid, false);
    assert.equal(validatePlayerName('   ').valid, false);
    assert.match(validatePlayerName('   ').error!, /empty/i);
  });

  test('rejects a missing or non-string name', () => {
    assert.equal(validatePlayerName(undefined as unknown as string).valid, false);
    assert.equal(validatePlayerName(42 as unknown as string).valid, false);
  });

  test('caps the length at 20 characters', () => {
    assert.equal(validatePlayerName('A'.repeat(20)).valid, true);
    const tooLong = validatePlayerName('A'.repeat(21));
    assert.equal(tooLong.valid, false);
    assert.match(tooLong.error!, /20 characters/);
  });

  test('strips characters that could be injected into markup', () => {
    const result = validatePlayerName('<script>&"\'');
    assert.equal(result.valid, true);
    assert.equal(result.sanitized, 'script');
  });
});

describe('canStartGame', () => {
  test('needs at least the minimum number of players', () => {
    const tooFew = canStartGame(LOBBY_CONSTRAINTS.MIN_PLAYERS - 1, 'WAITING');
    assert.equal(tooFew.canStart, false);
    assert.match(tooFew.reason!, /at least/);

    assert.equal(canStartGame(LOBBY_CONSTRAINTS.MIN_PLAYERS, 'WAITING').canStart, true);
    assert.equal(canStartGame(8, 'WAITING').canStart, true);
  });

  test('refuses to start a lobby that is already playing or finished', () => {
    for (const status of ['IN_GAME', 'COMPLETED'] as const) {
      const result = canStartGame(4, status);
      assert.equal(result.canStart, false, status);
      assert.match(result.reason!, /already started/);
    }
  });
});

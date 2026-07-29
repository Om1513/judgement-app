// Test-database plumbing shared by every integration suite.
//
// The database is provisioned and pointed at by scripts/test.mjs before Node
// starts, so by the time this module loads DATABASE_URL already refers to a
// disposable Postgres with the schema applied. The guard below is a second line
// of defence for anyone who runs `node --test dist/tests/integration/...`
// directly with the wrong environment.

import { getDB } from '../../db/connection';

/** Every table in the schema, ordered irrelevantly - TRUNCATE ... CASCADE handles FKs. */
const TABLES = [
  'GameAction',
  'ScoreboardConfirmation',
  'RoundScore',
  'TrickCard',
  'RoundTrick',
  'RoundBid',
  'GameRound',
  'GameResult',
  'Game',
  'LobbyPlayer',
  'Lobby',
  'Player',
] as const;

function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Run integration tests via `npm run test:integration`, ' +
        'which provisions an isolated database first.'
    );
  }

  const database = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(database)) {
    throw new Error(
      `Refusing to run integration tests against database "${database}". ` +
        'The database name must contain "test" - these tests truncate every table.'
    );
  }
}

assertTestDatabase();

export const db = getDB();

/**
 * Empties every table. Called before each suite so tests never inherit rows
 * from a previous file and can be run in any order.
 */
export async function resetDatabase(): Promise<void> {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Closes the pool so the test process can exit cleanly. */
export async function closeDatabase(): Promise<void> {
  await db.$disconnect();
}

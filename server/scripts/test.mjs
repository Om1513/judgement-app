#!/usr/bin/env node
//
// Test runner for the game server.
//
// Everything the test suites need beyond "run node --test" lives here, so that
// `npm test` behaves identically on a laptop and in CI:
//
//   * picks the compiled test directories (unit and/or integration)
//   * for integration runs, provisions an isolated Postgres and applies the
//     schema to it from empty
//   * pins the presentation delays and bot "thinking time" to ~0 so timing is
//     deterministic rather than a race against real 3-second UI pauses
//   * optionally turns on coverage with thresholds
//
// Usage:
//   node scripts/test.mjs --unit
//   node scripts/test.mjs --integration
//   node scripts/test.mjs --all --coverage
//
// Database selection, in order:
//   1. $TEST_DATABASE_URL              (CI sets this to its service container)
//   2. the docker-compose.test.yml container, started on demand
//
// The real DATABASE_URL from .env is never read. Tests cannot touch a
// development or production database even by accident - see assertSafeTestDb.

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The local docker-compose fallback. Port 55432 keeps it clear of a dev Postgres.
const LOCAL_TEST_DB =
  'postgresql://postgres:postgres@127.0.0.1:55432/kachuful_test?schema=public';

// Coverage floors. These are set at, not above, what the suite actually
// achieves for the game-rule and service code that matters; see CI-CD.md for
// what is deliberately left uncovered.
const COVERAGE_THRESHOLDS = {
  lines: Number(process.env.COVERAGE_LINES ?? 80),
  branches: Number(process.env.COVERAGE_BRANCHES ?? 75),
  functions: Number(process.env.COVERAGE_FUNCTIONS ?? 80),
};

const argv = new Set(process.argv.slice(2));
const wantAll = argv.has('--all') || (!argv.has('--unit') && !argv.has('--integration'));
const runUnit = wantAll || argv.has('--unit');
const runIntegration = wantAll || argv.has('--integration');
const withCoverage = argv.has('--coverage');

/**
 * Refuses to run against anything that is not obviously a disposable test
 * database. A wrong TEST_DATABASE_URL should fail loudly, never silently wipe
 * someone's data: `--force-reset` below drops every table.
 */
function assertSafeTestDb(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a valid URL: ${rawUrl}`);
  }

  const database = url.pathname.replace(/^\//, '');
  const isLocal = ['localhost', '127.0.0.1', '::1', 'postgres'].includes(url.hostname);

  if (!isLocal && process.env.ALLOW_REMOTE_TEST_DB !== '1') {
    throw new Error(
      `Refusing to run tests against remote host "${url.hostname}". ` +
        'Integration tests reset the schema. Set ALLOW_REMOTE_TEST_DB=1 only if ' +
        'you are certain this database is disposable.'
    );
  }

  if (!/test/i.test(database)) {
    throw new Error(
      `Refusing to run tests against database "${database}" - the name must ` +
        'contain "test" so a development or production database can never be reset.'
    );
  }

  return rawUrl;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: serverDir,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function dockerAvailable() {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

function tcpReachable(url, timeoutMs = 750) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = net
      .connect({ host: hostname, port: Number(port || 5432) })
      .setTimeout(timeoutMs)
      .on('connect', () => {
        socket.destroy();
        resolve(true);
      })
      .on('timeout', () => {
        socket.destroy();
        resolve(false);
      })
      .on('error', () => resolve(false));
  });
}

async function waitForPostgres(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (await tcpReachable(url)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Test database at ${new URL(url).host} never became reachable`);
}

/**
 * Resolves the test database and brings the schema up on it from empty.
 *
 * `prisma db push --force-reset` drops the public schema and recreates every
 * table from prisma/schema.prisma. That is the same mechanism the production
 * container runs on boot, so a green integration run is direct evidence that a
 * completely fresh database can be provisioned and played on.
 */
async function prepareDatabase() {
  const provided = process.env.TEST_DATABASE_URL;
  const databaseUrl = assertSafeTestDb(provided || LOCAL_TEST_DB);

  if (!provided) {
    if (!(await tcpReachable(databaseUrl))) {
      if (!dockerAvailable()) {
        throw new Error(
          'No TEST_DATABASE_URL set and Docker is not available.\n' +
            'Either start Docker (the test Postgres is provisioned automatically) ' +
            'or point TEST_DATABASE_URL at a disposable Postgres whose database ' +
            'name contains "test".'
        );
      }
      console.log('› starting throwaway Postgres (docker-compose.test.yml)');
      const status = run('docker', [
        'compose',
        '-f',
        'docker-compose.test.yml',
        'up',
        '-d',
        '--wait',
      ]);
      if (status !== 0) throw new Error('Failed to start the test database container');
    }
  }

  await waitForPostgres(databaseUrl);

  console.log(`› resetting schema on ${new URL(databaseUrl).host}`);
  const status = run(
    'npx',
    ['prisma', 'db', 'push', '--force-reset', '--skip-generate', '--accept-data-loss'],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        // Schema changes go through directUrl; locally it is the same server.
        DIRECT_URL: databaseUrl,
        // Keep the Prisma CLI from reading server/.env over the top of these.
        PRISMA_SKIP_POSTINSTALL_GENERATE: '1',
      },
    }
  );
  if (status !== 0) throw new Error('prisma db push failed against the test database');

  return databaseUrl;
}

function coverageArgs() {
  if (!withCoverage) return [];
  return [
    '--experimental-test-coverage',
    // The tests themselves, the process entry point and the Prisma singleton
    // are not meaningful coverage targets.
    '--test-coverage-exclude=src/tests/**',
    '--test-coverage-exclude=dist/tests/**',
    '--test-coverage-exclude=src/server.ts',
    '--test-coverage-exclude=src/db/connection.ts',
    `--test-coverage-lines=${COVERAGE_THRESHOLDS.lines}`,
    `--test-coverage-branches=${COVERAGE_THRESHOLDS.branches}`,
    `--test-coverage-functions=${COVERAGE_THRESHOLDS.functions}`,
  ];
}

async function main() {
  // Globs rather than bare directories: `node --test <dir>` does not expand a
  // directory when other positional-looking args are present, but glob
  // patterns are handled by the runner itself on every platform.
  const targets = [];
  if (runUnit) targets.push('dist/tests/unit/**/*.test.js');
  if (runIntegration) targets.push('dist/tests/integration/**/*.test.js');

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    // Deterministic timing: no real UI pauses, no bot "thinking time".
    LAST_CARD_VIEW_DELAY_MS: '1',
    HAND_WINNER_DURATION_MS: '1',
    BOT_SPEED_FACTOR: '0',
  };

  if (runIntegration) {
    const databaseUrl = await prepareDatabase();
    env.DATABASE_URL = databaseUrl;
    env.DIRECT_URL = databaseUrl;
    env.TEST_DATABASE_URL = databaseUrl;
  } else {
    // Unit tests must not touch a database at all. Pointing at an unroutable
    // address turns an accidental query into an immediate, obvious failure
    // rather than a silent write somewhere real.
    env.DATABASE_URL = 'postgresql://unit:unit@127.0.0.1:1/unit_tests_should_not_connect';
    env.DIRECT_URL = env.DATABASE_URL;
  }

  const args = [
    '--test',
    // Integration suites share one database, so they must not interleave.
    ...(runIntegration ? ['--test-concurrency=1'] : []),
    // Maps coverage and stack traces back to the original TypeScript.
    '--enable-source-maps',
    ...coverageArgs(),
    ...targets,
  ];

  const child = spawn(process.execPath, args, {
    cwd: serverDir,
    stdio: 'inherit',
    env,
  });

  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 1));
  });
}

main().catch((error) => {
  console.error(`\n✖ ${error.message}`);
  process.exit(1);
});

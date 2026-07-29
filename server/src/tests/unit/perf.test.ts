// Performance instrumentation.
//
// Off by default and must stay that way: if PERF_LOG ever leaked into a
// production default it would log a line for every socket action of every game.
// The enabled path is exercised through a fresh module load with the env var
// set, since the flag is read once at import time.

import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { perfEnabled, perfStart, perfEnd, perfLog, payloadSize } from '../../utils/perf';

/** Captures console output for the duration of `fn`. */
function captureConsole<T>(fn: () => T): { lines: string[]; result: T } {
  const lines: string[] = [];
  const { log, warn } = console;
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  console.warn = (...args: unknown[]) => lines.push(args.join(' '));
  try {
    return { lines, result: fn() };
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

afterEach(() => {
  delete process.env.PERF_LOG;
  delete process.env.PERF_WARN_MS;
});

describe('disabled by default', () => {
  test('the flag is off when PERF_LOG is unset', () => {
    assert.equal(perfEnabled, false);
  });

  test('perfStart hands back nothing to measure', () => {
    assert.equal(perfStart(), null);
  });

  test('perfEnd and perfLog stay silent', () => {
    const { lines } = captureConsole(() => {
      perfEnd(null, 'game:play-card');
      perfEnd(process.hrtime.bigint(), 'game:play-card', { trickComplete: true });
      perfLog('broadcast', { players: 4 });
    });

    assert.deepEqual(lines, [], 'instrumentation must be completely quiet when off');
  });
});

describe('payloadSize', () => {
  test('measures the serialized byte length', () => {
    assert.equal(payloadSize({ a: 1 }), Buffer.byteLength('{"a":1}'));
    assert.equal(payloadSize('hi'), 4, 'the JSON quotes count');
  });

  test('returns -1 rather than throwing on something unserializable', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.equal(payloadSize(circular), -1);
  });
});

describe('when switched on', () => {
  test('perfStart measures and perfEnd reports', async () => {
    process.env.PERF_LOG = '1';
    // Fresh module instance so the import-time flag is re-read.
    delete require.cache[require.resolve('../../utils/perf')];
    const perf = await import('../../utils/perf');

    assert.equal(perf.perfEnabled, true);

    const start = perf.perfStart();
    assert.notEqual(start, null);

    const { lines } = captureConsole(() => {
      perf.perfEnd(start, 'game:submit-bid', { bid: 2 });
      perf.perfLog('broadcast game:update', { players: 4 });
    });

    assert.equal(lines.length, 2);
    assert.match(lines[0], /\[perf\] game:submit-bid \d/);
    assert.match(lines[0], /"bid":2/);
    assert.match(lines[1], /\[perf\] broadcast game:update .*"players":4/);
  });

  test('a handler slower than the threshold is flagged SLOW', async () => {
    process.env.PERF_LOG = '1';
    process.env.PERF_WARN_MS = '0';
    delete require.cache[require.resolve('../../utils/perf')];
    const perf = await import('../../utils/perf');

    const { lines } = captureConsole(() => {
      perf.perfEnd(perf.perfStart(), 'game:play-card');
    });

    assert.match(lines[0], /\[perf\] SLOW game:play-card/);
  });

  test('a null start mark is still ignored, even when enabled', async () => {
    process.env.PERF_LOG = 'true';
    delete require.cache[require.resolve('../../utils/perf')];
    const perf = await import('../../utils/perf');

    const { lines } = captureConsole(() => perf.perfEnd(null, 'nothing-to-measure'));
    assert.deepEqual(lines, []);
  });
});

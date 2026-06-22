// Lightweight, env-gated performance instrumentation.
//
// Disabled by default (zero overhead). Enable in any environment with:
//   PERF_LOG=1            -> emit timing/size logs
//   PERF_WARN_MS=100      -> threshold (ms) above which a handler is logged as SLOW
//
// Designed so normal production logs stay quiet unless explicitly turned on.

export const perfEnabled =
  process.env.PERF_LOG === '1' || process.env.PERF_LOG === 'true';

const WARN_MS = Number(process.env.PERF_WARN_MS || 100);

/** Returns a high-resolution start mark, or null when instrumentation is off. */
export function perfStart(): bigint | null {
  return perfEnabled ? process.hrtime.bigint() : null;
}

/**
 * Logs elapsed time since `start`. No-op when disabled. Handlers slower than
 * PERF_WARN_MS are logged with a SLOW marker via console.warn.
 */
export function perfEnd(
  start: bigint | null,
  label: string,
  extra?: Record<string, unknown>
): void {
  if (!perfEnabled || start === null) {
    return;
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const meta = extra ? ' ' + JSON.stringify(extra) : '';
  const line = `[perf] ${label} ${ms.toFixed(1)}ms${meta}`;
  if (ms >= WARN_MS) {
    console.warn(`[perf] SLOW ${label} ${ms.toFixed(1)}ms${meta}`);
  } else {
    console.log(line);
  }
}

/** Byte size of a JSON payload (for broadcast size logging). -1 if unserializable. */
export function payloadSize(obj: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(obj));
  } catch {
    return -1;
  }
}

/** Emits a perf log line only when instrumentation is enabled. */
export function perfLog(label: string, extra?: Record<string, unknown>): void {
  if (!perfEnabled) {
    return;
  }
  const meta = extra ? ' ' + JSON.stringify(extra) : '';
  console.log(`[perf] ${label}${meta}`);
}

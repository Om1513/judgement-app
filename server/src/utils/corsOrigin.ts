// Resolves the CORS `origin` config from the CORS_ORIGIN env var.
//
//   unset / "*"            -> "*"            (allow any; fine for native apps)
//   "https://a, https://b" -> ["https://a", "https://b"]   (browser allowlist)
//
// Note: when the value is "*" you must NOT also send credentials; callers using
// this for the browser web build should set explicit origins.
export function getCorsOrigin(): string | string[] {
  const raw = process.env.CORS_ORIGIN;

  if (!raw || raw.trim() === '*') {
    return '*';
  }

  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  return origins.length === 1 ? origins[0] : origins;
}

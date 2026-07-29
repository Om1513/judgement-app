// CORS origin parsing.
//
// Small, but it is the switch between "any client can connect" and "only these
// browser origins can", and it is driven entirely by an environment variable -
// exactly the kind of thing that breaks silently in production.

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { getCorsOrigin } from '../../utils/corsOrigin';

const original = process.env.CORS_ORIGIN;

beforeEach(() => {
  delete process.env.CORS_ORIGIN;
});

afterEach(() => {
  if (original === undefined) {
    delete process.env.CORS_ORIGIN;
  } else {
    process.env.CORS_ORIGIN = original;
  }
});

describe('getCorsOrigin', () => {
  test('defaults to allowing any origin when unset', () => {
    assert.equal(getCorsOrigin(), '*');
  });

  test('treats an explicit star, with or without padding, as any origin', () => {
    process.env.CORS_ORIGIN = '*';
    assert.equal(getCorsOrigin(), '*');

    process.env.CORS_ORIGIN = '  *  ';
    assert.equal(getCorsOrigin(), '*');
  });

  test('treats an empty value as unset rather than an empty allowlist', () => {
    process.env.CORS_ORIGIN = '';
    assert.equal(getCorsOrigin(), '*');
  });

  test('returns a bare string for a single origin', () => {
    process.env.CORS_ORIGIN = 'https://play.example.com';
    assert.equal(getCorsOrigin(), 'https://play.example.com');
  });

  test('splits a comma-separated allowlist and trims each entry', () => {
    process.env.CORS_ORIGIN = 'https://a.com, https://b.com ,https://c.com';
    assert.deepEqual(getCorsOrigin(), ['https://a.com', 'https://b.com', 'https://c.com']);
  });

  test('drops empty entries from a sloppy list', () => {
    process.env.CORS_ORIGIN = 'https://a.com,,https://b.com,';
    assert.deepEqual(getCorsOrigin(), ['https://a.com', 'https://b.com']);
  });

  test('a list that collapses to one entry comes back as a bare string', () => {
    process.env.CORS_ORIGIN = 'https://a.com,';
    assert.equal(getCorsOrigin(), 'https://a.com');
  });
});

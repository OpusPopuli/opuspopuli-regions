/* eslint-disable sonarjs/no-clear-text-protocols */
// Test fixtures deliberately include http:// and ftp:// URLs to exercise
// scheme handling — these are not production code paths.

import { parseHostPort, tcpProbe } from '../../src/cli/lib/tcp-probe';

describe('parseHostPort', () => {
  it('extracts host and default 443 from https URLs', () => {
    expect(parseHostPort('https://example.gov/page')).toEqual({
      host: 'example.gov',
      port: 443,
    });
  });

  it('extracts host and default 80 from http URLs', () => {
    expect(parseHostPort('http://example.gov/page')).toEqual({
      host: 'example.gov',
      port: 80,
    });
  });

  it('respects an explicit port in the URL', () => {
    expect(parseHostPort('https://example.gov:8443/page')).toEqual({
      host: 'example.gov',
      port: 8443,
    });
    expect(parseHostPort('http://localhost:3000/api')).toEqual({
      host: 'localhost',
      port: 3000,
    });
  });

  it('strips userinfo, query, and fragment', () => {
    expect(parseHostPort('https://user:pw@example.gov/path?q=1#frag')).toEqual({
      host: 'example.gov',
      port: 443,
    });
  });

  it('returns null for malformed URLs', () => {
    expect(parseHostPort('not a url')).toBeNull();
    expect(parseHostPort('')).toBeNull();
    expect(parseHostPort('://broken')).toBeNull();
  });

  it('returns null for non-HTTP(S) schemes', () => {
    // ftp, file, mailto, etc. — TCP probe is intended for web URLs only.
    expect(parseHostPort('ftp://example.gov/file')).toBeNull();
    expect(parseHostPort('file:///etc/passwd')).toBeNull();
    expect(parseHostPort('mailto:foo@example.gov')).toBeNull();
  });

  it('returns null for port outside 1-65535', () => {
    // Browsers and `new URL()` will accept these; our probe should not.
    expect(parseHostPort('https://example.gov:0/')).toBeNull();
    expect(parseHostPort('https://example.gov:99999/')).toBeNull();
  });
});

describe('tcpProbe', () => {
  it('returns ok:false with "invalid URL" for malformed input — no network call', async () => {
    const result = await tcpProbe('not a url');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid URL');
    expect(result.host).toBe('');
    expect(result.port).toBe(0);
  });

  it('returns ok:false with "invalid URL" for non-HTTP schemes', async () => {
    const result = await tcpProbe('ftp://example.gov/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid URL');
  });

  it('reports timeout error when host is unreachable (short timeout)', async () => {
    // RFC 5737 test-net-1: documentation IP; guaranteed not routable.
    // 100ms timeout to keep the test fast.
    const result = await tcpProbe('https://192.0.2.1/', 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Could be 'timeout' (most common) or a connect error depending on
      // platform behavior. Either way, the host info should be populated.
      expect(result.host).toBe('192.0.2.1');
      expect(result.port).toBe(443);
      expect(result.error).toBeTruthy();
    }
    expect(result.ms).toBeLessThan(2000);
  }, 5000);

  it('reports connect failure when port is closed on a reachable host', async () => {
    // 127.0.0.1:1 — loopback (always routable) on an unused port. Should
    // get an immediate ECONNREFUSED, not a timeout.
    const result = await tcpProbe('http://127.0.0.1:1/', 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.host).toBe('127.0.0.1');
      expect(result.port).toBe(1);
      expect(result.error).toMatch(/ECONNREFUSED|connect/i);
    }
  }, 5000);
});

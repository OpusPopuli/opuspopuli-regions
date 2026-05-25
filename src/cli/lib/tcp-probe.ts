/**
 * TCP-connect probe for URL reachability.
 *
 * Opens a raw TCP socket to the URL's host:port (443 for https, 80 for
 * http, or an explicit port if the URL carries one). Returns success if
 * the handshake completes within `timeoutMs`. Used as a fallback when
 * HTTP HEAD/GET requests fail — many gov sites front Cloudflare/Akamai
 * WAFs that throttle non-browser User-Agents, returning timeouts or 403s
 * even though the host is fine. A TCP probe sidesteps the WAF entirely
 * and tells us whether the host is actually alive.
 *
 * Semantics:
 *   - HTTP succeeds → don't probe; the URL is fully reachable.
 *   - HTTP fails + TCP succeeds → "degraded": host is up, HTTP layer is
 *     slow / WAF-blocked / route-misconfigured. Yellow in CLI output;
 *     informational in CI rather than failing.
 *   - HTTP fails + TCP fails → "unreachable": DNS resolution failed,
 *     host is down, or port closed. Red; CI reports it.
 */

import { createConnection } from 'node:net';

export type TcpProbeResult =
  | { ok: true; ms: number; host: string; port: number }
  | { ok: false; ms: number; host: string; port: number; error: string };

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Parse the host + port from a URL. Returns `null` on malformed input
 * so callers can branch cleanly instead of catching.
 */
export function parseHostPort(
  url: string,
): { host: string; port: number } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }
  const defaultPort = parsed.protocol === 'https:' ? 443 : 80;
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : defaultPort;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return null;
  }
  return { host: parsed.hostname, port };
}

/**
 * Open a TCP connection and wait for the handshake to complete (or
 * fail). Returns a `TcpProbeResult`. Never throws — all failure modes
 * are reported via `ok: false`.
 */
export function tcpProbe(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<TcpProbeResult> {
  const hostPort = parseHostPort(url);
  if (!hostPort) {
    return Promise.resolve({
      ok: false,
      ms: 0,
      host: '',
      port: 0,
      error: 'invalid URL',
    });
  }

  const { host, port } = hostPort;
  const start = Date.now();

  return new Promise<TcpProbeResult>((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;

    const finish = (result: TcpProbeResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        ms: Date.now() - start,
        host,
        port,
        error: 'timeout',
      });
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      finish({ ok: true, ms: Date.now() - start, host, port });
    });

    socket.once('error', (err: Error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        ms: Date.now() - start,
        host,
        port,
        error: err.message,
      });
    });
  });
}

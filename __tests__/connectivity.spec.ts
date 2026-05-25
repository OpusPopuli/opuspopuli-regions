import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { walkJsonFiles } from './helpers';
import { tcpProbe } from '../src/cli/lib/tcp-probe';

const regionsDir = join(__dirname, '..', 'regions');
const HTTP_TIMEOUT = 30_000;
const TCP_TIMEOUT = 5_000;

interface DataSource {
  url: string;
  dataType: string;
  sourceType?: string;
}

/**
 * Try HEAD with `status < 500` as the pass criterion. On failure (network
 * error, timeout, or 5xx) fall back to a TCP-connect probe to confirm the
 * host is at least alive. The test passes if either HTTP succeeds OR TCP
 * succeeds — many gov sites front Cloudflare/Akamai WAFs that throttle
 * non-browser User-Agents and return timeouts or 4xx for HEAD requests,
 * even though the host itself is fine. A TCP probe sidesteps the WAF.
 *
 * Distinguish:
 *   - HTTP ok    → fully reachable (silent pass)
 *   - HTTP fail + TCP ok → host alive, HTTP layer slow/blocked
 *                          (console.warn, but test passes)
 *   - HTTP fail + TCP fail → genuinely unreachable (test fails)
 */
async function checkUrlReachable(url: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    if (res.status < 500) return; // HTTP-level success (incl. 2xx/3xx/4xx)
    throw new Error(`HTTP ${res.status}`);
  } catch (httpErr) {
    // HTTP failed — try TCP probe to see if the host is at least alive.
    const probe = await tcpProbe(url, TCP_TIMEOUT);
    if (probe.ok) {
      console.warn(
        `[degraded] ${url} — HTTP failed (${(httpErr as Error).message}) ` +
          `but TCP ${probe.host}:${probe.port} reachable in ${probe.ms}ms. ` +
          `Likely WAF or HTTP-layer slowness; the host itself is up.`,
      );
      return;
    }
    throw new Error(
      `HTTP failed (${(httpErr as Error).message}) and TCP probe to ` +
        `${probe.host}:${probe.port} also failed (${probe.error})`,
    );
  } finally {
    clearTimeout(timer);
  }
}

describe('Data source URL connectivity', () => {
  const jsonFiles = walkJsonFiles(regionsDir).map((p) => relative(regionsDir, p));

  for (const file of jsonFiles) {
    const config = JSON.parse(readFileSync(join(regionsDir, file), 'utf-8'));
    const sources: DataSource[] = config.config.dataSources.filter(
      (ds: DataSource) => ds.sourceType !== 'bulk_download',
    );
    const urls = [...new Set(sources.map((ds) => ds.url))];

    if (urls.length === 0) continue;

    describe(file, () => {
      it.each(urls)(
        '%s is reachable (HTTP or TCP fallback)',
        async (url) => {
          await checkUrlReachable(url);
        },
        HTTP_TIMEOUT + TCP_TIMEOUT + 5000,
      );
    });
  }
});
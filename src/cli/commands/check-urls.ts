import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfigsOrExit } from '../lib/cli-helpers.js';
import { tcpProbe, type TcpProbeResult } from '../lib/tcp-probe.js';

type UrlResult = {
  url: string;
  region: string;
  dataType: string;
  status: number | null;
  finalUrl: string;
  redirectCount: number;
  durationMs: number;
  error?: string;
  // When HTTP fails but a TCP connect to the host succeeds, the URL is
  // "degraded" — host alive, HTTP layer slow / WAF-blocked / redirect
  // chain broken. Yellow in output; informational in CI rather than
  // blocking. Populated by checkUrl when the HTTP attempt fails.
  tcpFallback?: TcpProbeResult;
};

/** Three-tier reachability classification. */
type Tier = 'reachable' | 'degraded' | 'unreachable';

function classify(result: UrlResult): Tier {
  // HTTP succeeded with a non-error status → fully reachable. 3xx
  // redirects are followed in checkUrl, so a 3xx here would be a
  // redirect-chain anomaly — treat as degraded if TCP confirms host.
  if (result.status !== null && result.status >= 200 && result.status < 400) {
    return 'reachable';
  }
  if (result.tcpFallback?.ok) return 'degraded';
  return 'unreachable';
}

const FETCH_OPTS = {
  redirect: 'manual' as const,
  signal: AbortSignal.timeout(10_000),
  headers: { 'User-Agent': 'OpusPopuli-RegionCLI/1.0' },
};

async function fetchWithFallback(url: string): Promise<{ status: number; location: string | null }> {
  const res = await fetch(url, { method: 'HEAD', ...FETCH_OPTS });
  if (res.status !== 405) {
    return { status: res.status, location: res.headers.get('location') };
  }
  const getRes = await fetch(url, { method: 'GET', ...FETCH_OPTS });
  return { status: getRes.status, location: getRes.headers.get('location') };
}

async function checkUrl(url: string, region: string, dataType: string): Promise<UrlResult> {
  const start = Date.now();
  let current = url;
  let redirectCount = 0;
  let httpResult: UrlResult;

  try {
    let settled = false;
    while (redirectCount < 10) {
      const { status, location } = await fetchWithFallback(current);
      const isRedirect = status >= 300 && status < 400 && location;
      if (isRedirect) {
        current = new URL(location, current).href;
        redirectCount++;
        continue;
      }
      httpResult = { url, region, dataType, status, finalUrl: current, redirectCount, durationMs: Date.now() - start };
      settled = true;
      break;
    }
    if (!settled) {
      httpResult = { url, region, dataType, status: null, finalUrl: current, redirectCount, durationMs: Date.now() - start, error: 'Too many redirects' };
    }
  } catch (err) {
    httpResult = { url, region, dataType, status: null, finalUrl: current, redirectCount, durationMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }

  // If HTTP failed (network error, timeout, or 4xx/5xx), do a TCP probe
  // to the original URL's host. The fallback only kicks in for failures
  // so the happy path stays fast — one probe per actually-broken URL,
  // not per request.
  const httpFailed =
    !!httpResult!.error ||
    httpResult!.status === null ||
    httpResult!.status >= 400;
  if (httpFailed) {
    httpResult!.tcpFallback = await tcpProbe(url);
  }
  return httpResult!;
}

function statusLabel(result: UrlResult): string {
  const tier = classify(result);
  if (tier === 'reachable') {
    const s = result.status!;
    if (s < 300) return chalk.green(String(s));
    return chalk.green(String(s)); // 3xx shouldn't reach here, but be safe
  }
  if (tier === 'degraded') {
    // HTTP status if we have one (e.g. 403 from WAF), otherwise TCP.
    const httpLabel = result.status !== null ? String(result.status) : 'ERR';
    return chalk.yellow(httpLabel);
  }
  // Unreachable
  return chalk.red(result.status !== null ? String(result.status) : 'ERR ');
}

function collectSources(
  entries: ReturnType<typeof loadConfigsOrExit>,
): { url: string; region: string; dataType: string }[] {
  const sources: { url: string; region: string; dataType: string }[] = [];
  for (const { region } of entries) {
    for (const ds of region.config.dataSources) {
      sources.push({
        url: ds.url,
        region: region.config.regionId,
        dataType: ds.dataType,
      });
    }
  }
  return sources;
}

function printResult(r: UrlResult, tier: Tier): void {
  const status = statusLabel(r);
  const ms = chalk.dim(`${r.durationMs}ms`);
  const src = chalk.dim(`[${r.region}/${r.dataType}]`);
  const redirect = r.redirectCount > 0 ? chalk.dim(` → ${r.finalUrl}`) : '';
  console.log(`${status}  ${ms}  ${src}  ${r.url}${redirect}`);
  if (r.error) console.log(`      ${chalk.red(r.error)}`);
  if (r.tcpFallback) printTcpDetail(r.tcpFallback, tier);
}

function printTcpDetail(probe: TcpProbeResult, tier: Tier): void {
  if (tier === 'degraded' && probe.ok) {
    console.log(
      chalk.dim(
        `      TCP ${probe.host}:${probe.port} ok in ${probe.ms}ms — host alive, HTTP slow/blocked`,
      ),
    );
    return;
  }
  if (tier === 'unreachable' && !probe.ok) {
    console.log(
      chalk.dim(
        `      TCP ${probe.host}:${probe.port} also failed: ${probe.error}`,
      ),
    );
  }
}

function formatCount(count: number, label: string, color: 'green' | 'yellow' | 'red'): string {
  const text = `${count} ${label}`;
  if (count === 0) return chalk.dim(text);
  if (color === 'green') return chalk.green(text);
  if (color === 'yellow') return chalk.yellow(text);
  return chalk.red(text);
}

export function registerCheckUrls(program: Command): void {
  program
    .command('check-urls [path]')
    .description('Check HTTP reachability of all data source URLs in region configs')
    .action(async (pathArg?: string) => {
      const sources = collectSources(loadConfigsOrExit(pathArg));

      if (sources.length === 0) {
        console.log(chalk.yellow('No data source URLs found.'));
        return;
      }

      console.log(`Checking ${sources.length} URL(s)...\n`);

      let reachable = 0;
      let degraded = 0;
      let unreachable = 0;

      for (const { url, region, dataType } of sources) {
        const r = await checkUrl(url, region, dataType);
        const tier = classify(r);
        printResult(r, tier);
        if (tier === 'reachable') reachable++;
        else if (tier === 'degraded') degraded++;
        else unreachable++;
      }

      console.log('');
      console.log(
        formatCount(reachable, 'reachable', 'green') +
          '  ' +
          formatCount(degraded, 'degraded', 'yellow') +
          '  ' +
          formatCount(unreachable, 'unreachable', 'red'),
      );

      if (unreachable > 0) {
        process.exit(1);
      }
    });
}

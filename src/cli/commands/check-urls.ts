import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfigsOrExit } from '../lib/cli-helpers.js';

type UrlResult = {
  url: string;
  region: string;
  dataType: string;
  status: number | null;
  finalUrl: string;
  redirectCount: number;
  durationMs: number;
  error?: string;
};

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

  try {
    while (redirectCount < 10) {
      const { status, location } = await fetchWithFallback(current);
      const isRedirect = status >= 300 && status < 400 && location;
      if (isRedirect) {
        current = new URL(location, current).href;
        redirectCount++;
        continue;
      }
      return { url, region, dataType, status, finalUrl: current, redirectCount, durationMs: Date.now() - start };
    }
    return { url, region, dataType, status: null, finalUrl: current, redirectCount, durationMs: Date.now() - start, error: 'Too many redirects' };
  } catch (err) {
    return { url, region, dataType, status: null, finalUrl: current, redirectCount, durationMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

function colorStatus(result: UrlResult): string {
  if (result.error) return chalk.red('ERR ');
  const s = result.status!;
  if (s >= 200 && s < 300) return chalk.green(String(s));
  if (s >= 300 && s < 400) return chalk.yellow(String(s));
  return chalk.red(String(s));
}

export function registerCheckUrls(program: Command): void {
  program
    .command('check-urls [path]')
    .description('Check HTTP reachability of all data source URLs in region configs')
    .action(async (pathArg?: string) => {
      const entries = loadConfigsOrExit(pathArg);
      const sources: { url: string; region: string; dataType: string }[] = [];
      for (const { region } of entries) {
        for (const ds of region.config.dataSources) {
          sources.push({ url: ds.url, region: region.config.regionId, dataType: ds.dataType });
        }
      }

      if (sources.length === 0) {
        console.log(chalk.yellow('No data source URLs found.'));
        return;
      }

      console.log(`Checking ${sources.length} URL(s)...\n`);

      let hasFailure = false;
      for (const { url, region, dataType } of sources) {
        const r = await checkUrl(url, region, dataType);
        const status = colorStatus(r);
        const ms = chalk.dim(`${r.durationMs}ms`);
        const src = chalk.dim(`[${r.region}/${r.dataType}]`);
        const redirect = r.redirectCount > 0 ? chalk.dim(` → ${r.finalUrl}`) : '';
        console.log(`${status}  ${ms}  ${src}  ${r.url}${redirect}`);
        if (r.error) console.log(`      ${chalk.red(r.error)}`);
        if (r.error || !r.status || r.status >= 400) hasFailure = true;
      }

      console.log('');
      if (hasFailure) {
        console.log(chalk.red('✗ Some URLs are unreachable or returned errors.'));
        process.exit(1);
      }
      console.log(chalk.green('✓ All URLs reachable.'));
    });
}

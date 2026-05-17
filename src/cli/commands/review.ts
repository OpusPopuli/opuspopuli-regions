import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfigsOrExit } from '../lib/cli-helpers.js';
import { fetchHtml } from '../lib/fetcher.js';
import { checkSelectors, hasSelectorsToCheck, type SelectorCheckResult } from '../lib/selector-checker.js';
import { checkContentGoalCoverage, type GoalCoverageResult } from '../lib/contentgoal-checker.js';
import { simplifyHtml } from '../lib/html-simplifier.js';
import { buildStructuralPrompt } from '../lib/prompts/structural-analysis.js';
import { analyzeWithOllama, checkOllamaReachable } from '../lib/ollama-analyzer.js';
import { buildDataSourceConfig } from '../lib/manifest-to-config.js';
import { getRequiredFields } from '../lib/required-fields.js';
import type { DataSourceConfig, RegionPluginFile } from '../lib/config-loader.js';

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as { version: string };
  return pkg.version;
}

type DataSourceIssues = {
  selectorIssues: SelectorCheckResult[];
  goalIssues: GoalCoverageResult[];
};

function collectIssues(ds: DataSourceConfig, html: string): DataSourceIssues {
  const selectorResults = checkSelectors(html, ds);
  const goalResults = checkContentGoalCoverage(ds);
  return {
    selectorIssues: selectorResults.filter((r) => !r.found),
    goalIssues: goalResults.filter((r) => !r.covered),
  };
}

function printSelectorResults(results: SelectorCheckResult[]): void {
  if (results.length === 0) return;
  console.log('\n  Selector check:');
  for (const r of results) {
    const icon = r.found ? chalk.green('✓') : chalk.red('✗');
    const label = `${r.origin}.${r.field}`.padEnd(34);
    const detail = r.found ? `${r.count} match(es)` : chalk.red(`0 matches — selector stale or page restructured`);
    console.log(`    ${icon} ${label} "${r.selector}"  ${detail}`);
  }
}

function printGoalResults(results: GoalCoverageResult[]): void {
  if (results.length === 0) return;
  console.log('\n  contentGoal + hints coverage:');
  for (const r of results) {
    const icon = r.covered ? chalk.green('✓') : chalk.yellow('⚠');
    console.log(`    ${icon} ${r.field.padEnd(16)}— ${r.note}`);
  }
}

async function runOllamaReview(url: string, dataType: string, html: string): Promise<void> {
  console.log('\n  AI re-analysis (suggested update):');
  try {
    const fields = getRequiredFields(dataType).map((f) => f.name);
    const analysis = await analyzeWithOllama(buildStructuralPrompt(url, dataType, fields, simplifyHtml(html)));
    const suggested = buildDataSourceConfig(url, dataType, analysis);
    const lines = JSON.stringify(suggested, null, 2).split('\n').map((l) => `  ${l}`).join('\n');
    console.log(chalk.dim(lines));
  } catch (err) {
    console.log(`  ${chalk.yellow('⚠ AI analysis failed:')} ${err instanceof Error ? err.message : err}`);
  }
}

async function reviewDataSource(
  region: RegionPluginFile,
  ds: DataSourceConfig,
  runOllama: boolean,
): Promise<number> {
  const label = `[${region.config.regionId} / ${ds.dataType}]`;
  console.log(`\n${chalk.bold(label)}`);
  console.log(`  ${ds.url}`);

  const fetched = await fetchHtml(ds.url);
  if ('error' in fetched) {
    const errMsg = chalk.red(`✗ Fetch failed: ${fetched.error}`);
    console.log(`  ${errMsg}`);
    return 1;
  }

  const { html, bytes, ms } = fetched;
  console.log(`  ${chalk.green('✓')} Fetched (${(bytes / 1024).toFixed(0)}kB, ${ms}ms)`);

  const { selectorIssues, goalIssues } = collectIssues(ds, html);

  if (hasSelectorsToCheck(ds)) {
    printSelectorResults(checkSelectors(html, ds));
  }

  printGoalResults(checkContentGoalCoverage(ds));

  const totalIssues = selectorIssues.length + goalIssues.length;
  const verdict = totalIssues === 0 ? chalk.green('✓ OK') : chalk.yellow(`⚠ NEEDS REVIEW (${totalIssues} issue(s))`);
  console.log(`\n  ${verdict}`);

  if (runOllama) await runOllamaReview(ds.url, ds.dataType, html);

  return totalIssues > 0 ? 1 : 0;
}

export function registerReview(program: Command): void {
  program
    .command('review [path]')
    .description('Review existing configs — check selectors and contentGoal coverage against live pages')
    .option('--test', 'Also run AI re-analysis via local Ollama and show suggested update')
    .action(async (pathArg?: string, opts: { test?: boolean } = {}) => {
      const doTest = opts.test === true;
      const entries = loadConfigsOrExit(pathArg);
      console.log(chalk.dim(`@opuspopuli/regions v${packageVersion()}\n`));

      if (doTest) {
        const host = process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
        if (!await checkOllamaReachable(host)) {
          console.error(chalk.red(`Ollama not reachable at ${host}. Start Ollama or omit --test.`));
          process.exit(1);
        }
        console.log(`${chalk.green('✓')} Ollama reachable\n`);
      }

      let totalSources = 0;
      let needsReview = 0;

      for (const { region } of entries) {
        for (const ds of region.config.dataSources) {
          totalSources++;
          const issues = await reviewDataSource(region, ds, doTest);
          if (issues > 0) needsReview++;
        }
      }

      console.log('');
      const summary = needsReview > 0
        ? chalk.yellow(`${needsReview} of ${totalSources} data source(s) need review.`)
        : chalk.green(`All ${totalSources} data source(s) look good.`);
      console.log(summary);
      if (needsReview > 0) process.exit(1);
    });
}

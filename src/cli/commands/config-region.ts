import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfigs, type DataSourceConfig } from '../lib/config-loader.js';
import { detectFields, type FieldDetectionResult } from '../lib/field-detector.js';
import { getRequiredFields, checkFieldDetection } from '../lib/required-fields.js';
import { simplifyHtml } from '../lib/html-simplifier.js';
import { buildStructuralPrompt } from '../lib/prompts/structural-analysis.js';
import { analyzeWithOllama, checkOllamaReachable } from '../lib/ollama-analyzer.js';
import { buildDataSourceConfig } from '../lib/manifest-to-config.js';
import { validateRegionFile } from '../lib/schema-validator.js';
import { fetchHtml } from '../lib/fetcher.js';

type ConfigRegionOpts = {
  url?: string;
  dataType?: string;
  config?: string;
  state?: string;
  county?: string;
  fips?: string;
  test?: boolean;
  init?: boolean;
  force?: boolean;
};

function validateArgs(opts: ConfigRegionOpts, doInit: boolean): void {
  if (!opts.url && !opts.config && !doInit) {
    console.error(chalk.red('Error: --url, --config, or --init is required.'));
    process.exit(1);
  }
  if (opts.url && !opts.dataType) {
    console.error(chalk.red('Error: --dataType is required with --url.'));
    process.exit(1);
  }
  if (doInit && (!opts.state || !opts.county || !opts.fips)) {
    console.error(chalk.red('Error: --init requires --state, --county, and --fips.'));
    process.exit(1);
  }
}

async function ollamaPreCheck(host: string, model: string): Promise<void> {
  if (!await checkOllamaReachable(host)) {
    console.error(chalk.red(`\nOllama is not reachable at ${host}.`));
    console.error(chalk.dim('  Start Ollama: open the Ollama app or run `ollama serve`'));
    console.error(chalk.dim('  Override URL:  OLLAMA_BASE_URL=http://... pnpm cli config-region ...'));
    process.exit(1);
  }
  console.log(`${chalk.green('✓')} Ollama reachable at ${host} (model: ${model})\n`);
}

function printDetectionSummary(detection: FieldDetectionResult, dataType: string, kb: string, ms: number): void {
  console.log(`  ${chalk.green('✓')} Fetched (${kb}kB, ${ms}ms)`);
  console.log(`\n  Page type:  ${detection.pageType}`);
  if (detection.headings.length > 0) {
    const headingList = detection.headings.map((h) => `"${h}"`).join(', ');
    console.log(`  Headings:   ${headingList}`);
  }
  console.log(`  Images:     ${detection.imageCount} found`);
  if (detection.detectedPhone ?? detection.detectedEmail) {
    console.log('\n  Contact patterns:');
    if (detection.detectedPhone) console.log(`    ${chalk.green('✓')} phone   ${detection.detectedPhone}`);
    if (detection.detectedEmail) console.log(`    ${chalk.green('✓')} email   ${detection.detectedEmail}`);
  }
  const fields = getRequiredFields(dataType);
  if (fields.length > 0) {
    console.log(`\n  Required fields for '${dataType}':`);
    for (const field of fields) {
      const { ok, note } = checkFieldDetection(field, detection);
      const icon = ok ? chalk.green('✓') : chalk.yellow('⚠');
      console.log(`    ${icon} ${field.name.padEnd(16)}— ${note}`);
    }
  }
}

async function runOllamaAnalysis(url: string, dataType: string, html: string): Promise<DataSourceConfig | null> {
  console.log('\n  Running AI analysis...');
  try {
    const fields = getRequiredFields(dataType).map((f) => f.name);
    const prompt = buildStructuralPrompt(url, dataType, fields, simplifyHtml(html));
    const analysis = await analyzeWithOllama(prompt);
    const config = buildDataSourceConfig(url, dataType, analysis);
    console.log('\n  Suggested data source block:');
    const lines = JSON.stringify(config, null, 2).split('\n').map((l) => `  ${l}`).join('\n');
    console.log(chalk.cyan(lines));
    return config;
  } catch (err) {
    console.log(`  ${chalk.yellow('⚠ AI analysis failed:')} ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function analyzeDataSource(url: string, dataType: string, runOllama: boolean): Promise<DataSourceConfig | null> {
  const fetched = await fetchHtml(url);
  if ('error' in fetched) {
    console.log(`  ${chalk.red('✗ Fetch failed:')} ${fetched.error}`);
    return null;
  }
  const { html, bytes, ms } = fetched;
  const kb = (bytes / 1024).toFixed(0);
  printDetectionSummary(detectFields(html), dataType, kb, ms);
  return runOllama ? runOllamaAnalysis(url, dataType, html) : null;
}

async function analyzeConfigEntries(
  entries: ReturnType<typeof loadConfigs>,
  doTest: boolean,
): Promise<DataSourceConfig[]> {
  const generated: DataSourceConfig[] = [];
  for (const { region } of entries) {
    for (const ds of region.config.dataSources) {
      const label = `[${region.config.regionId} / ${ds.dataType}]`;
      console.log(`\n${chalk.bold(label)}\n  ${ds.url}`);
      const result = await analyzeDataSource(ds.url, ds.dataType, doTest);
      if (result) generated.push(result);
      console.log('');
    }
  }
  return generated;
}

async function collectGeneratedConfigs(opts: ConfigRegionOpts, doTest: boolean): Promise<DataSourceConfig[]> {
  if (opts.url) {
    console.log(chalk.bold(`Analyzing: ${opts.url}`));
    const result = await analyzeDataSource(opts.url, opts.dataType!, doTest);
    return result ? [result] : [];
  }
  if (opts.config) {
    let entries: ReturnType<typeof loadConfigs>;
    try {
      entries = loadConfigs(opts.config);
    } catch (err) {
      console.error(chalk.red(`Failed to load config: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
    return analyzeConfigEntries(entries, doTest);
  }
  return [];
}

function toTitleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildRegionSkeleton(state: string, countySlug: string, fips: string, dataSources: DataSourceConfig[]): object {
  const regionId = `${state}-${countySlug}`;
  const displayName = `${toTitleCase(countySlug)} County`;
  const description = `${displayName} civic data from official county government websites`;
  return {
    name: regionId,
    displayName,
    description,
    version: '0.1.0',
    config: {
      regionId,
      regionName: displayName,
      parentRegionId: state,
      fipsCode: fips,
      description,
      timezone: 'America/Los_Angeles',
      stateCode: state.slice(0, 2).toUpperCase(),
      dataSources: dataSources.length > 0
        ? dataSources
        : [{ url: 'https://example.gov/board-of-supervisors', dataType: 'representatives', contentGoal: 'PLACEHOLDER: Replace with actual extraction goal' }],
    },
  };
}

function writeInitFile(opts: ConfigRegionOpts, generatedConfigs: DataSourceConfig[]): void {
  const countySlug = opts.county!.toLowerCase().replace(/\s+/g, '-');
  const stateLower = opts.state!.toLowerCase();
  const regionDir = join(process.cwd(), 'regions', stateLower, 'counties', countySlug);
  const regionFile = join(regionDir, `${countySlug}.json`);

  if (existsSync(regionFile) && !opts.force) {
    console.error(chalk.yellow(`\n⚠  File already exists: ${regionFile}`));
    console.error(chalk.dim('   Use --force to overwrite.'));
    process.exit(1);
  }

  const skeleton = buildRegionSkeleton(stateLower, countySlug, opts.fips!, generatedConfigs);
  const validation = validateRegionFile(skeleton);

  if (!validation.valid) {
    console.error(chalk.red('\n✗ Generated config failed schema validation:'));
    for (const e of validation.errors) console.error(`  ${chalk.red(e)}`);
    process.exit(1);
  }

  mkdirSync(regionDir, { recursive: true });
  writeFileSync(regionFile, JSON.stringify(skeleton, null, 2) + '\n', 'utf-8');
  console.log(`\n${chalk.green('✓')} Created ${regionFile}`);
  console.log(chalk.dim('  Next: edit the file, then run `pnpm test` to validate.'));
}

export function registerConfigRegion(program: Command): void {
  program
    .command('config-region')
    .description('Analyze a URL or config file and optionally create the region config file')
    .option('--url <url>', 'URL to analyze')
    .option('--dataType <type>', 'Data type (representatives, meetings, propositions, etc.)')
    .option('--config <path>', 'Path to existing region config — tests all its data sources')
    .option('--state <state>', 'State slug for --init (e.g., california)')
    .option('--county <county>', 'County slug for --init (e.g., santa-cruz)')
    .option('--fips <code>', 'FIPS code for --init (e.g., 06087)')
    .option('--test', 'Run AI analysis via local Ollama (requires Ollama running)')
    .option('--init', 'Write region config file to regions/<state>/counties/<county>/')
    .option('--force', 'Overwrite existing config file')
    .action(async (opts: ConfigRegionOpts) => {
      const doTest = opts.test === true;
      const doInit = opts.init === true;

      validateArgs(opts, doInit);

      if (doTest) {
        const host = process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
        const model = process.env['OLLAMA_MODEL'] ?? 'qwen2.5:7b';
        await ollamaPreCheck(host, model);
      }

      const generatedConfigs = await collectGeneratedConfigs(opts, doTest);
      if (doInit) writeInitFile(opts, generatedConfigs);
    });
}

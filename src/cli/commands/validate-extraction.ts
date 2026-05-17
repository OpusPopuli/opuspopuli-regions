import { Command } from 'commander';
import chalk from 'chalk';
import { type RegionPluginFile } from '../lib/config-loader.js';
import { detectFields, type FieldDetectionResult } from '../lib/field-detector.js';
import { getRequiredFields, checkFieldDetection } from '../lib/required-fields.js';
import { fetchHtml } from '../lib/fetcher.js';
import { loadConfigsOrExit } from '../lib/cli-helpers.js';

function printPageSummary(detection: FieldDetectionResult, kb: string, ms: number): void {
  console.log(`  ${chalk.green('✓')} Fetched (${kb}kB, ${ms}ms)`);
  console.log(`  Page type:  ${detection.pageType}`);
  if (detection.headings.length > 0) {
    const headingList = detection.headings.map((h) => `"${h}"`).join(', ');
    console.log(`  Headings:   ${headingList}`);
  }
  console.log(`  Images:     ${detection.imageCount} found`);
}

function printFieldChecks(dataType: string, detection: FieldDetectionResult): number {
  console.log('');
  console.log(`  Required fields for '${dataType}':`);
  const fields = getRequiredFields(dataType);
  if (fields.length === 0) {
    console.log(chalk.dim(`    (no field spec defined for dataType '${dataType}')`));
    return 0;
  }
  let warnings = 0;
  for (const field of fields) {
    const { ok, note } = checkFieldDetection(field, detection);
    const icon = ok ? chalk.green('✓') : chalk.yellow('⚠');
    console.log(`    ${icon} ${field.name.padEnd(16)}— ${note}`);
    if (!ok) warnings++;
  }
  return warnings;
}

async function processDataSource(
  region: RegionPluginFile,
  ds: RegionPluginFile['config']['dataSources'][0],
): Promise<number> {
  console.log(chalk.bold(`[${region.config.regionId} / ${ds.dataType}]`));
  console.log(`  URL: ${ds.url}`);

  const fetched = await fetchHtml(ds.url);
  if ('error' in fetched) {
    const msg = chalk.red(`✗ Fetch failed: ${fetched.error}`);
    console.log(`  ${msg}\n`);
    return 1;
  }

  const { html, bytes, ms } = fetched;
  const kb = (bytes / 1024).toFixed(0);
  const detection = detectFields(html);

  printPageSummary(detection, kb, ms);
  const warnings = printFieldChecks(ds.dataType, detection);
  console.log('');
  return warnings;
}

export function registerValidateExtraction(program: Command): void {
  program
    .command('validate-extraction [path]')
    .description('Check whether required fields for each dataType are detectable in page content')
    .action(async (pathArg?: string) => {
      const entries = loadConfigsOrExit(pathArg);
      let totalSources = 0;
      let warningCount = 0;

      for (const { region } of entries) {
        for (const ds of region.config.dataSources) {
          totalSources++;
          warningCount += await processDataSource(region, ds);
        }
      }

      const summary = warningCount > 0
        ? chalk.yellow(`${warningCount} warning(s) need attention before syncing.`)
        : chalk.green('All field checks passed.');
      console.log(`Checked ${totalSources} data source(s). ${summary}`);
      if (warningCount > 0) process.exit(1);
    });
}

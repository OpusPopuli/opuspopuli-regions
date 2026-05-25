/**
 * Batch-updates all California county representative configs to match Sonoma quality:
 *   - Adds a county-specific externalId construction rule to contentGoal
 *   - Runs Ollama analysis on working URLs to generate page-specific hints
 *   - Bumps config version to 0.2.0
 *   - Reports broken URLs for manual follow-up
 *
 * Usage: pnpm tsx scripts/fix-representatives.ts
 * Requires Ollama running at OLLAMA_BASE_URL (default http://127.0.0.1:11434)
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fetchHtml } from '../src/cli/lib/fetcher.js';
import { simplifyHtml } from '../src/cli/lib/html-simplifier.js';
import { buildStructuralPrompt } from '../src/cli/lib/prompts/structural-analysis.js';
import { analyzeWithOllama, checkOllamaReachable } from '../src/cli/lib/ollama-analyzer.js';

const REGIONS_DIR = join(process.cwd(), 'regions', 'california', 'counties');
const REQUIRED_FIELDS = ['externalId', 'name', 'district', 'party', 'photoUrl', 'detailUrl'];

type FieldMapping = { fieldName: string; selector: string; extractionMethod: string; required: boolean };
type DataSource = {
  url: string;
  dataType: string;
  contentGoal: string;
  category?: string;
  hints?: string[];
  sourceType?: string;
  staticManifest?: { containerSelector: string; itemSelector: string; fieldMappings: FieldMapping[] };
  detailFields?: Record<string, string>;
};
type RegionFile = {
  name: string;
  displayName: string;
  description: string;
  version: string;
  config: {
    regionId: string;
    regionName: string;
    parentRegionId?: string;
    fipsCode?: string;
    description: string;
    timezone: string;
    stateCode?: string;
    dataSources: DataSource[];
  };
};

type CountyResult = {
  county: string;
  status: 'updated' | 'skipped_url' | 'skipped_ollama' | 'no_change';
  note: string;
};

function addExternalIdRule(ds: DataSource, countySlug: string): void {
  const rule = `construct externalId as 'california-${countySlug}-supervisor-{district}' using the district number`;
  const goalLower = ds.contentGoal.toLowerCase();
  if (goalLower.includes('construct') || goalLower.includes('externalid as')) return;
  ds.contentGoal = ds.contentGoal.trimEnd();
  if (!ds.contentGoal.endsWith('.')) ds.contentGoal += '.';
  ds.contentGoal += ` Construct externalId as 'california-${countySlug}-supervisor-{district}' using the district number.`;

  if (!ds.hints) ds.hints = [];
  const hasRule = ds.hints.some((h) => h.toLowerCase().includes('construct'));
  if (!hasRule) {
    ds.hints.push(`externalId: ${rule}`);
  }
}

async function analyzeRepresentatives(ds: DataSource, countySlug: string): Promise<string[] | null> {
  const fetched = await fetchHtml(ds.url);
  if ('error' in fetched) return null;

  const simplified = simplifyHtml(fetched.html);
  const prompt = buildStructuralPrompt(ds.url, 'representatives', REQUIRED_FIELDS, simplified);

  try {
    const analysis = await analyzeWithOllama(prompt);
    const hints: string[] = [
      `externalId: construct as 'california-${countySlug}-supervisor-{district}' using the district number`,
      ...analysis.hints,
    ];
    return hints.slice(0, 5);
  } catch {
    return null;
  }
}

function bumpVersion(current: string, aiAnalyzed: boolean): string {
  if (aiAnalyzed) {
    if (current === '0.1.0' || current === '0.2.0') return '0.3.0';
  } else {
    if (current === '0.1.0') return '0.2.0';
  }
  const parts = current.split('.').map(Number);
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join('.');
}

async function processCounty(countyDir: string): Promise<CountyResult> {
  const countySlug = countyDir;
  const filePath = join(REGIONS_DIR, countyDir, `${countyDir}.json`);
  const region = JSON.parse(readFileSync(filePath, 'utf-8')) as RegionFile;

  const dsIndex = region.config.dataSources.findIndex(
    (ds) => ds.dataType === 'representatives' && (!ds.category || ds.category.toLowerCase().includes('supervisor')),
  );
  if (dsIndex === -1) {
    return { county: countySlug, status: 'no_change', note: 'no representatives source found' };
  }

  // Skip if already fully updated (version ≥ 0.3.0 means AI analysis succeeded in a prior run)
  const [, , patch] = region.version.split('.').map(Number);
  if (region.version !== '0.1.0' && region.version !== '0.2.0' && (patch ?? 0) >= 3) {
    return { county: countySlug, status: 'no_change', note: `already at v${region.version} — skipped` };
  }

  const ds = region.config.dataSources[dsIndex];

  // Always add externalId construction rule
  addExternalIdRule(ds, countySlug);

  // Try Ollama analysis for page-specific hints
  const newHints = await analyzeRepresentatives(ds, countySlug);
  if (newHints) {
    ds.hints = newHints;
    region.version = bumpVersion(region.version, true);
    writeFileSync(filePath, JSON.stringify(region, null, 2) + '\n', 'utf-8');
    return { county: countySlug, status: 'updated', note: `→ v${region.version}` };
  }

  // URL failed or Ollama failed — still save the externalId fix if not already there
  const fetched = await fetchHtml(ds.url);
  const isNetworkError = 'error' in fetched;
  region.version = bumpVersion(region.version, false);
  writeFileSync(filePath, JSON.stringify(region, null, 2) + '\n', 'utf-8');

  if (isNetworkError) {
    return { county: countySlug, status: 'skipped_url', note: fetched.error };
  }
  return { county: countySlug, status: 'skipped_ollama', note: 'Ollama analysis failed — externalId rule added' };
}

async function main(): Promise<void> {
  const host = process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
  const ollamaOk = await checkOllamaReachable(host);

  if (!ollamaOk) {
    console.error(`Ollama not reachable at ${host}. Start Ollama and re-run.`);
    process.exit(1);
  }
  console.log(`Ollama ready at ${host}\n`);

  const counties = readdirSync(REGIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  console.log(`Processing ${counties.length} counties...\n`);

  const results: CountyResult[] = [];
  let i = 0;
  for (const county of counties) {
    i++;
    process.stdout.write(`[${String(i).padStart(2)}/${counties.length}] ${county.padEnd(24)} `);
    const result = await processCounty(county);
    results.push(result);
    let icon: string;
    if (result.status === 'updated') icon = '✓';
    else if (result.status === 'no_change') icon = '-';
    else icon = '⚠';
    console.log(`${icon}  ${result.note}`);
  }

  const updated = results.filter((r) => r.status === 'updated');
  const brokenUrl = results.filter((r) => r.status === 'skipped_url');
  const ollamaFail = results.filter((r) => r.status === 'skipped_ollama');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Updated with AI analysis:  ${updated.length}`);
  console.log(`externalId rule only:      ${ollamaFail.length}`);
  console.log(`Broken URLs (need fix):    ${brokenUrl.length}`);

  if (brokenUrl.length > 0) {
    console.log('\nBroken URLs — need manual URL research:');
    for (const r of brokenUrl) {
      const filePath = join(REGIONS_DIR, r.county, `${r.county}.json`);
      const region = JSON.parse(readFileSync(filePath, 'utf-8')) as RegionFile;
      const ds = region.config.dataSources.find((d) => d.dataType === 'representatives');
      console.log(`  ${r.county}: ${ds?.url ?? 'unknown'} (${r.note})`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

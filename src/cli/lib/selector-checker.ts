import * as cheerio from 'cheerio';
import type { DataSourceConfig } from './config-loader.js';

export type SelectorCheckResult = {
  origin: 'staticManifest' | 'detailFields';
  field: string;
  selector: string;
  found: boolean;
  count: number;
};

function cssOnly(expression: string): string {
  return expression.split('|')[0].trim();
}

function trySelect($: ReturnType<typeof cheerio.load>, selector: string): number {
  try {
    return $(selector).length;
  } catch {
    return -1;
  }
}

function checkStaticManifest(
  $: ReturnType<typeof cheerio.load>,
  ds: DataSourceConfig,
): SelectorCheckResult[] {
  const sm = ds.staticManifest;
  if (!sm) return [];

  const results: SelectorCheckResult[] = [];

  for (const [field, selector] of [
    ['containerSelector', sm.containerSelector],
    ['itemSelector', sm.itemSelector],
  ] as [string, string][]) {
    const count = trySelect($, selector);
    results.push({ origin: 'staticManifest', field, selector, found: count > 0, count: Math.max(count, 0) });
  }

  for (const fm of sm.fieldMappings ?? []) {
    if (!fm.selector) continue;
    const count = trySelect($, fm.selector);
    results.push({ origin: 'staticManifest', field: fm.fieldName, selector: fm.selector, found: count > 0, count: Math.max(count, 0) });
  }

  return results;
}

function checkDetailFields(
  $: ReturnType<typeof cheerio.load>,
  ds: DataSourceConfig,
): SelectorCheckResult[] {
  const df = ds.detailFields;
  if (!df) return [];

  const results: SelectorCheckResult[] = [];
  for (const [field, value] of Object.entries(df)) {
    if (typeof value !== 'string') continue;
    const selector = cssOnly(value);
    if (!selector) continue;
    const count = trySelect($, selector);
    results.push({ origin: 'detailFields', field, selector, found: count > 0, count: Math.max(count, 0) });
  }
  return results;
}

export function checkSelectors(html: string, ds: DataSourceConfig): SelectorCheckResult[] {
  const $ = cheerio.load(html);
  return [...checkStaticManifest($, ds), ...checkDetailFields($, ds)];
}

export function hasSelectorsToCheck(ds: DataSourceConfig): boolean {
  return !!(ds.staticManifest ?? ds.detailFields);
}

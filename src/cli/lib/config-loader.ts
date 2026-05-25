import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateRegionFile } from './schema-validator.js';
import type {
  DataSourceConfig,
  RegionPluginFile,
} from './generated-types.js';

// Schema-derived types are the canonical contract — see `generated-types.ts`
// and issue #39. Re-export so existing callers (`config-region`, `review`,
// `validate-extraction`, etc.) import from this module unchanged.
export type { DataSourceConfig, RegionPluginFile };

// Convenience aliases that some callers still reference by their older
// hand-maintained names. These point at the schema-derived definitions
// so there's no second source of truth.
export type FieldMapping = NonNullable<
  DataSourceConfig['staticManifest']
>['fieldMappings'][number];

export type StaticManifest = NonNullable<DataSourceConfig['staticManifest']>;

function walkJson(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJson(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

/**
 * Parse a single region JSON file, validate it against the schema, and
 * return the typed plugin object. Throws on parse error or schema
 * validation failure with the failing file path and the first few schema
 * errors formatted for human reading.
 *
 * Validating on load (issue #39) replaces the older silent `as` cast,
 * which let malformed configs propagate undefined fields into the CLI
 * pipeline and surface as confusing downstream errors.
 */
function loadOne(file: string): { file: string; region: RegionPluginFile } {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
  const result = validateRegionFile(raw);
  if (!result.valid) {
    const summary = result.errors.slice(0, 5).join('\n  ');
    const more =
      result.errors.length > 5
        ? `\n  ...and ${result.errors.length - 5} more`
        : '';
    throw new Error(
      `Schema validation failed for ${file}:\n  ${summary}${more}`,
    );
  }
  return { file, region: raw as RegionPluginFile };
}

export function loadConfigs(pathOrDir: string): { file: string; region: RegionPluginFile }[] {
  const stat = statSync(pathOrDir);
  if (stat.isFile()) {
    return [loadOne(pathOrDir)];
  }
  return walkJson(pathOrDir).map((file) => loadOne(file));
}

/**
 * Emit `dist/manifest.json` cataloguing every region config's name +
 * version at build time. Consumers can introspect which config version
 * is bundled in any given `@opuspopuli/regions@X.Y.Z` without parsing
 * 60 individual JSON files.
 *
 * Runs via `pnpm build` → `postbuild` hook. CI uses the same pipeline
 * via the publish workflow. Output shape:
 *
 * ```json
 * {
 *   "packageVersion": "1.0.62",
 *   "publishedAt": "2026-05-25T10:00:00.000Z",
 *   "configs": [
 *     { "regionId": "california", "version": "1.7.0", "file": "regions/california/california.json" },
 *     { "regionId": "california-alameda", "version": "0.2.2", "file": "regions/california/counties/alameda/alameda.json" },
 *     ...
 *   ]
 * }
 * ```
 *
 * See issue #43.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface ManifestEntry {
  regionId: string;
  version: string;
  file: string;
}

export interface RegionsManifest {
  packageVersion: string;
  publishedAt: string;
  configs: ManifestEntry[];
}

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
 * Build the manifest from a regions directory and a package.json. Pure
 * function — accepts paths and returns a manifest object, so unit tests
 * can drive it against fixtures.
 */
export function buildManifest(
  regionsDir: string,
  packageJsonPath: string,
  now: Date = new Date(),
): RegionsManifest {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
    version: string;
  };
  const repoRoot = join(regionsDir, '..');
  const configs: ManifestEntry[] = walkJson(regionsDir)
    .map((path) => {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as {
        name?: string;
        config?: { regionId?: string };
        version?: string;
      };
      const regionId = raw.config?.regionId ?? raw.name;
      const version = raw.version;
      if (!regionId || !version) {
        throw new Error(
          `${path}: manifest entry requires name/config.regionId and version`,
        );
      }
      return { regionId, version, file: relative(repoRoot, path) };
    })
    // Stable ordering — sort by regionId. The walk order from fs is
    // platform-dependent (especially across macOS / Linux), so sorting
    // makes the manifest reproducible across hosts.
    .sort((a, b) => a.regionId.localeCompare(b.regionId));

  return {
    packageVersion: pkg.version,
    publishedAt: now.toISOString(),
    configs,
  };
}

function main(): void {
  const repoRoot = process.cwd();
  const manifest = buildManifest(
    join(repoRoot, 'regions'),
    join(repoRoot, 'package.json'),
  );
  const distDir = join(repoRoot, 'dist');
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
  const out = join(distDir, 'manifest.json');
  writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(
    `Wrote ${out}: ${manifest.configs.length} config(s) for @opuspopuli/regions@${manifest.packageVersion}`,
  );
}

// Run as CLI when invoked directly (not when imported by tests).
// `process.argv[1]` is the path of the executed script; if it ends with
// our filename, we're the entry point. This avoids `import.meta`, which
// ts-jest's CJS transformer rejects.
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1]?.endsWith('build-manifest.ts') === true;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error('Failed to build manifest:', err);
    process.exit(1);
  }
}

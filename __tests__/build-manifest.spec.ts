import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest } from '../scripts/build-manifest';

function makeTmpRepo(): string {
  return mkdtempSync(join(tmpdir(), 'regions-manifest-test-'));
}

function writeConfig(
  dir: string,
  filename: string,
  config: Record<string, unknown>,
): string {
  const path = join(dir, filename);
  writeFileSync(path, JSON.stringify(config), 'utf-8');
  return path;
}

const VALID_CONFIG = (regionId: string, version: string) => ({
  name: regionId,
  displayName: regionId,
  description: 'test',
  version,
  config: {
    regionId,
    regionName: regionId,
    timezone: 'America/Los_Angeles',
    dataSources: [
      {
        url: 'https://example.gov',
        dataType: 'representatives',
        contentGoal: 'test',
      },
    ],
  },
});

describe('buildManifest (#43)', () => {
  let root: string;
  let regionsDir: string;
  let pkgPath: string;

  beforeEach(() => {
    root = makeTmpRepo();
    regionsDir = join(root, 'regions');
    mkdirSync(regionsDir, { recursive: true });
    pkgPath = join(root, 'package.json');
    writeFileSync(pkgPath, JSON.stringify({ version: '1.0.99' }), 'utf-8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('includes packageVersion from package.json', () => {
    writeConfig(regionsDir, 'a.json', VALID_CONFIG('alpha', '0.1.0'));
    const m = buildManifest(regionsDir, pkgPath);
    expect(m.packageVersion).toBe('1.0.99');
  });

  it('includes a publishedAt timestamp (default to now)', () => {
    writeConfig(regionsDir, 'a.json', VALID_CONFIG('alpha', '0.1.0'));
    const m = buildManifest(regionsDir, pkgPath);
    expect(m.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601
  });

  it('accepts an explicit `now` for deterministic output', () => {
    writeConfig(regionsDir, 'a.json', VALID_CONFIG('alpha', '0.1.0'));
    const fixed = new Date('2026-01-01T00:00:00Z');
    const m = buildManifest(regionsDir, pkgPath, fixed);
    expect(m.publishedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('walks the regions directory recursively', () => {
    writeConfig(regionsDir, 'state.json', VALID_CONFIG('state', '1.0.0'));
    const subdir = join(regionsDir, 'counties', 'foo');
    mkdirSync(subdir, { recursive: true });
    writeConfig(subdir, 'foo.json', VALID_CONFIG('state-foo', '0.2.0'));

    const m = buildManifest(regionsDir, pkgPath);
    const ids = m.configs.map((c) => c.regionId);
    expect(ids).toContain('state');
    expect(ids).toContain('state-foo');
  });

  it('records the relative file path from the repo root', () => {
    writeConfig(regionsDir, 'state.json', VALID_CONFIG('state', '1.0.0'));
    const m = buildManifest(regionsDir, pkgPath);
    expect(m.configs[0].file).toBe('regions/state.json');
  });

  it('sorts configs by regionId for stable output across hosts', () => {
    writeConfig(regionsDir, 'zebra.json', VALID_CONFIG('zebra', '0.1.0'));
    writeConfig(regionsDir, 'alpha.json', VALID_CONFIG('alpha', '0.1.0'));
    writeConfig(regionsDir, 'middle.json', VALID_CONFIG('middle', '0.1.0'));

    const m = buildManifest(regionsDir, pkgPath);
    const ids = m.configs.map((c) => c.regionId);
    expect(ids).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('emits version verbatim from each config (no transformation)', () => {
    writeConfig(regionsDir, 'a.json', VALID_CONFIG('alpha', '2.3.4'));
    const m = buildManifest(regionsDir, pkgPath);
    expect(m.configs[0].version).toBe('2.3.4');
  });

  it('throws when a config is missing required name/regionId/version', () => {
    // Missing version
    writeConfig(regionsDir, 'broken.json', {
      name: 'broken',
      config: { regionId: 'broken' },
    });
    expect(() => buildManifest(regionsDir, pkgPath)).toThrow(
      /broken\.json.*name\/config\.regionId and version/,
    );
  });

  it('throws when a config is missing both name and config.regionId', () => {
    writeConfig(regionsDir, 'broken.json', { version: '0.1.0' });
    expect(() => buildManifest(regionsDir, pkgPath)).toThrow(
      /name\/config\.regionId/,
    );
  });

  it('prefers config.regionId over the top-level name when both exist', () => {
    // The two can drift in practice (the schema requires both to match,
    // but a developer might edit one). The manifest sources of truth is
    // config.regionId since that's what the consumer uses for lookup.
    writeConfig(regionsDir, 'a.json', {
      name: 'name-field',
      config: { regionId: 'config-region-id-field' },
      version: '1.0.0',
    });
    const m = buildManifest(regionsDir, pkgPath);
    expect(m.configs[0].regionId).toBe('config-region-id-field');
  });
});

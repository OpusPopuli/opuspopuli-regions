import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { walkJsonFiles } from './helpers';
import { validateRegionFile } from '../src/cli/lib/schema-validator';

const schemaPath = join(__dirname, '..', 'schema', 'region-plugin.schema.json');
const regionsDir = join(__dirname, '..', 'regions');

describe('Region config validation', () => {
  const jsonFiles = walkJsonFiles(regionsDir).map((p) => relative(regionsDir, p));

  it('has at least one region config', () => {
    expect(jsonFiles.length).toBeGreaterThan(0);
  });

  it.each(jsonFiles)('%s passes schema validation', (file) => {
    const config = JSON.parse(readFileSync(join(regionsDir, file), 'utf-8'));
    // Use the cached `validateRegionFile` so the ajv compile happens once
    // across this whole test file rather than once per `it.each` iteration.
    // Pass the absolute schema path so tests don't depend on `process.cwd()`.
    const result = validateRegionFile(config, schemaPath);
    if (!result.valid) {
      console.error(`${file}:\n  ${result.errors.join('\n  ')}`);
    }
    expect(result.valid).toBe(true);
  });

  it.each(jsonFiles)('%s has matching name and config.regionId', (file) => {
    const config = JSON.parse(readFileSync(join(regionsDir, file), 'utf-8'));
    expect(config.name).toBe(config.config.regionId);
  });

  it.each(jsonFiles)('%s has valid semver version', (file) => {
    const config = JSON.parse(readFileSync(join(regionsDir, file), 'utf-8'));
    expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(jsonFiles)(
    '%s has no duplicate data sources',
    (file) => {
      const config = JSON.parse(readFileSync(join(regionsDir, file), 'utf-8'));
      const keys = config.config.dataSources.map(
        (ds: { url: string; dataType: string; category?: string }) =>
          `${ds.url}::${ds.dataType}::${ds.category ?? ''}`,
      );
      const unique = new Set(keys);
      expect(keys.length).toBe(unique.size);
    },
  );

  describe('cross-file hierarchy assertions', () => {
    type RawConfig = {
      name: string;
      config: { regionId: string; parentRegionId?: string; fipsCode?: string };
    };

    const allConfigs: RawConfig[] = jsonFiles.map((f) =>
      JSON.parse(readFileSync(join(regionsDir, f), 'utf-8')),
    );
    const regionIdSet = new Set(allConfigs.map((c) => c.config.regionId));

    const subRegionFiles = jsonFiles.filter((f) => {
      const c: RawConfig = JSON.parse(readFileSync(join(regionsDir, f), 'utf-8'));
      return !!c.config.parentRegionId;
    });

    const countyFiles = jsonFiles.filter((f) => {
      const c: RawConfig = JSON.parse(readFileSync(join(regionsDir, f), 'utf-8'));
      return c.config.fipsCode?.length === 5 && !!c.config.parentRegionId;
    });

    it.each(subRegionFiles)(
      '%s parentRegionId references an existing region',
      (file) => {
        const c: RawConfig = JSON.parse(readFileSync(join(regionsDir, file), 'utf-8'));
        expect(regionIdSet).toContain(c.config.parentRegionId);
      },
    );

    it.each(countyFiles)(
      '%s county fipsCode starts with parent state fipsCode',
      (file) => {
        const c: RawConfig = JSON.parse(readFileSync(join(regionsDir, file), 'utf-8'));
        const parent = allConfigs.find(
          (p) => p.config.regionId === c.config.parentRegionId,
        );
        expect(parent).toBeDefined();
        expect(parent!.config.fipsCode).toBeDefined();
        expect(c.config.fipsCode).toMatch(
          new RegExp(`^${parent!.config.fipsCode}`),
        );
      },
    );
  });
});
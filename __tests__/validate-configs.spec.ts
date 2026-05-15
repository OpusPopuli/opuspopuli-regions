import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { walkJsonFiles } from './helpers';

const schemaPath = join(__dirname, '..', 'schema', 'region-plugin.schema.json');
const regionsDir = join(__dirname, '..', 'regions');

describe('Region config validation', () => {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  const validate = ajv.compile(schema);

  const jsonFiles = walkJsonFiles(regionsDir).map((p) => relative(regionsDir, p));

  it('has at least one region config', () => {
    expect(jsonFiles.length).toBeGreaterThan(0);
  });

  it.each(jsonFiles)('%s passes schema validation', (file) => {
    const config = JSON.parse(readFileSync(join(regionsDir, file), 'utf-8'));
    const valid = validate(config);
    if (!valid) {
      console.error(JSON.stringify(validate.errors, null, 2));
    }
    expect(valid).toBe(true);
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
});
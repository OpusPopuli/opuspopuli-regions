import { join } from 'node:path';
import { validateRegionFile } from '../../src/cli/lib/schema-validator';

const SCHEMA_PATH = join(__dirname, '..', '..', 'schema', 'region-plugin.schema.json');

const VALID_CONFIG = {
  name: 'california-test-county',
  displayName: 'Test County',
  description: 'Test county for unit tests',
  version: '0.1.0',
  config: {
    regionId: 'california-test-county',
    regionName: 'Test County',
    parentRegionId: 'california',
    fipsCode: '06999',
    description: 'Test county civic data',
    timezone: 'America/Los_Angeles',
    stateCode: 'CA',
    dataSources: [
      {
        url: 'https://example.gov/board',
        dataType: 'representatives',
        contentGoal: 'Extract Board of Supervisors members',
      },
    ],
  },
};

describe('validateRegionFile', () => {
  it('returns valid:true for a well-formed config', () => {
    const result = validateRegionFile(VALID_CONFIG, SCHEMA_PATH);
    expect(result.valid).toBe(true);
  });

  it('returns valid:false when name is missing', () => {
    const rest = Object.fromEntries(Object.entries(VALID_CONFIG).filter(([k]) => k !== 'name'));
    const result = validateRegionFile(rest, SCHEMA_PATH);
    expect(result.valid).toBe(false);
  });

  it('returns errors listing missing field', () => {
    const rest = Object.fromEntries(Object.entries(VALID_CONFIG).filter(([k]) => k !== 'name'));
    const result = validateRegionFile(rest, SCHEMA_PATH);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes('name') || e.includes('required'))).toBe(true);
    }
  });

  it('returns valid:false for invalid dataType enum', () => {
    const config = {
      ...VALID_CONFIG,
      config: {
        ...VALID_CONFIG.config,
        dataSources: [{ ...VALID_CONFIG.config.dataSources[0], dataType: 'invalid_type' }],
      },
    };
    const result = validateRegionFile(config, SCHEMA_PATH);
    expect(result.valid).toBe(false);
  });

  it('returns valid:false for malformed URL', () => {
    const config = {
      ...VALID_CONFIG,
      config: {
        ...VALID_CONFIG.config,
        dataSources: [{ ...VALID_CONFIG.config.dataSources[0], url: 'not-a-url' }],
      },
    };
    const result = validateRegionFile(config, SCHEMA_PATH);
    expect(result.valid).toBe(false);
  });

  it('returns valid:false when dataSources is empty', () => {
    const config = { ...VALID_CONFIG, config: { ...VALID_CONFIG.config, dataSources: [] } };
    const result = validateRegionFile(config, SCHEMA_PATH);
    expect(result.valid).toBe(false);
  });
});

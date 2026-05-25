/**
 * Unit tests for the schema-aware loader (#39).
 *
 * The loader now validates each JSON file against the canonical schema and
 * throws a descriptive error if validation fails. Previously, malformed
 * configs would propagate `undefined` fields into the CLI pipeline and
 * surface as confusing downstream errors.
 */

import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigs } from '../../src/cli/lib/config-loader';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'regions-loader-test-'));
}

const VALID = {
  name: 'california-test',
  displayName: 'Test',
  description: 'Test region',
  version: '0.1.0',
  config: {
    regionId: 'california-test',
    regionName: 'Test',
    parentRegionId: 'california',
    fipsCode: '06999',
    description: 'Test region civic data',
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

describe('loadConfigs — validate-on-load (#39)', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a single valid file successfully', () => {
    const file = join(dir, 'valid.json');
    writeFileSync(file, JSON.stringify(VALID), 'utf-8');

    const result = loadConfigs(file);
    expect(result).toHaveLength(1);
    expect(result[0].region.config.regionId).toBe('california-test');
  });

  it('throws with the file path when JSON is malformed against the schema', () => {
    const file = join(dir, 'malformed.json');
    // Required `version` field omitted.
    const malformed = { ...VALID, version: undefined };
    writeFileSync(file, JSON.stringify(malformed), 'utf-8');

    expect(() => loadConfigs(file)).toThrow(/Schema validation failed/);
    expect(() => loadConfigs(file)).toThrow(/malformed\.json/);
  });

  it('surfaces multiple schema errors in the thrown message', () => {
    const file = join(dir, 'multi-errors.json');
    const malformed = {
      ...VALID,
      version: 'not-semver',
      config: {
        ...VALID.config,
        timezone: undefined,
        dataSources: [], // minItems: 1 → violation
      },
    };
    writeFileSync(file, JSON.stringify(malformed), 'utf-8');

    let err: Error | undefined;
    try {
      loadConfigs(file);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    // At least one error per violation should surface.
    const msg = err!.message;
    expect(msg).toMatch(/version/);
    expect(msg).toMatch(/dataSources|timezone/);
  });

  it('caps the number of errors shown to keep the output readable', () => {
    const file = join(dir, 'many-errors.json');
    // Spam many violations: each dataSource missing required fields.
    const malformed = {
      ...VALID,
      config: {
        ...VALID.config,
        dataSources: Array.from({ length: 10 }, () => ({
          // url + dataType + contentGoal all missing
        })),
      },
    };
    writeFileSync(file, JSON.stringify(malformed), 'utf-8');

    try {
      loadConfigs(file);
      throw new Error('expected loadConfigs to throw');
    } catch (e) {
      const msg = (e as Error).message;
      // Truncation banner kicks in for >5 errors.
      expect(msg).toMatch(/and \d+ more/);
    }
  });

  it('walks a directory and validates every file', () => {
    const validFile = join(dir, 'valid.json');
    const subDir = join(dir, 'sub');
    mkdirSync(subDir);
    const invalidFile = join(subDir, 'invalid.json');
    writeFileSync(validFile, JSON.stringify(VALID), 'utf-8');
    writeFileSync(invalidFile, JSON.stringify({ name: 'x' }), 'utf-8');

    // Whichever file is encountered first that's invalid, the loader throws.
    expect(() => loadConfigs(dir)).toThrow(/Schema validation failed/);
  });
});

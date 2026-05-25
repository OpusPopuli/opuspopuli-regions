import { checkContentGoalCoverage } from '../../src/cli/lib/contentgoal-checker';
import type { DataSourceConfig } from '../../src/cli/lib/config-loader';

function makeDs(overrides: Partial<DataSourceConfig>): DataSourceConfig {
  return {
    url: 'https://example.gov',
    dataType: 'representatives',
    contentGoal: '',
    ...overrides,
  };
}

describe('checkContentGoalCoverage — representatives', () => {
  it('passes when all fields and externalId construction rule are present', () => {
    const ds = makeDs({
      contentGoal: 'Extract name, district, phone, email, photoUrl, detailUrl. Construct externalId as "california-test-supervisor-{district}".',
    });
    const results = checkContentGoalCoverage(ds);
    expect(results.every((r) => r.covered)).toBe(true);
  });

  it('flags externalId when no construction rule exists', () => {
    const ds = makeDs({
      contentGoal: 'Extract name, district, phone, email, photoUrl, detailUrl.',
    });
    const results = checkContentGoalCoverage(ds);
    const extId = results.find((r) => r.field === 'externalId');
    expect(extId?.covered).toBe(false);
  });

  it('covers externalId when hints mention "construct"', () => {
    const ds = makeDs({
      contentGoal: 'Extract name, district, phone, email, photoUrl, detailUrl.',
      hints: ["construct externalId as 'california-test-supervisor-{district}'"],
    });
    const results = checkContentGoalCoverage(ds);
    const extId = results.find((r) => r.field === 'externalId');
    expect(extId?.covered).toBe(true);
  });

  it('covers externalId when staticManifest has an externalId fieldMapping', () => {
    const ds = makeDs({
      contentGoal: 'Extract name, district.',
      staticManifest: {
        containerSelector: '.container',
        itemSelector: '.item',
        fieldMappings: [
          { fieldName: 'externalId', selector: 'h3 a', extractionMethod: 'text', required: true },
        ],
      },
    });
    const results = checkContentGoalCoverage(ds);
    const extId = results.find((r) => r.field === 'externalId');
    expect(extId?.covered).toBe(true);
    expect(extId?.note).toContain('staticManifest');
  });

  it('flags a field not mentioned anywhere', () => {
    const ds = makeDs({
      contentGoal: 'Extract name, district, phone.',
    });
    const results = checkContentGoalCoverage(ds);
    const email = results.find((r) => r.field === 'email');
    expect(email?.covered).toBe(false);
  });

  it('finds field mentioned in hints even if absent from contentGoal', () => {
    const ds = makeDs({
      contentGoal: 'Extract supervisors.',
      hints: ['Use EXACT field names: name, district, phone, email, photoUrl, detailUrl'],
    });
    const results = checkContentGoalCoverage(ds);
    const email = results.find((r) => r.field === 'email');
    expect(email?.covered).toBe(true);
  });
});

describe('checkContentGoalCoverage — unknown dataType', () => {
  it('returns empty array for unrecognised dataType', () => {
    // Cast through `unknown` — the schema-derived DataSourceConfig union
    // now excludes unrecognised values at compile time (issue #39), but
    // this test deliberately exercises the runtime behavior of
    // `getRequiredFields` returning `[]` for an unknown key.
    const ds = makeDs({ dataType: 'unknown_type' as unknown as never });
    expect(checkContentGoalCoverage(ds)).toHaveLength(0);
  });
});

describe('checkContentGoalCoverage — meetings', () => {
  it('checks meetings-specific fields', () => {
    const ds = makeDs({
      dataType: 'meetings',
      contentGoal: 'Extract title, scheduledAt, location, agendaUrl, minutesUrl.',
      hints: ["construct externalId as 'meeting-{date}'"],
    });
    const results = checkContentGoalCoverage(ds);
    expect(results.find((r) => r.field === 'externalId')?.covered).toBe(true);
    expect(results.find((r) => r.field === 'title')?.covered).toBe(true);
    expect(results.find((r) => r.field === 'scheduledAt')?.covered).toBe(true);
  });
});

/**
 * Schema-spec coverage for the api-source additions in opuspopuli#1162:
 * `compositeFields` and `pagination.maxPages`.
 *
 * Both blocks are `additionalProperties: false`, so a consumer that ships a
 * config using these before the schema knows them gets a validation failure
 * rather than a silently-ignored field. These tests pin that contract.
 */

import { join } from 'node:path';
import { validateRegionFile } from '../src/cli/lib/schema-validator';

const schemaPath = join(__dirname, '..', 'schema', 'region-plugin.schema.json');

function withApi(api: unknown): Record<string, unknown> {
  return {
    name: 'test-region',
    displayName: 'Test Region',
    description: 'Test region for api-composite spec',
    version: '1.0.0',
    config: {
      regionId: 'test-region',
      regionName: 'Test Region',
      description: 'Test',
      timezone: 'America/Los_Angeles',
      stateCode: 'CA',
      fipsCode: '06',
      dataSources: [
        {
          url: 'https://webapi.legistar.com/v1/example/events',
          dataType: 'meetings',
          contentGoal: 'placeholder',
          sourceType: 'api',
          api,
        },
      ],
    },
  };
}

describe('ApiSourceConfig compositeFields + maxPages (#1162)', () => {
  it('accepts the full Legistar shape', () => {
    const result = validateRegionFile(
      withApi({
        resultsPath: '$',
        queryParams: { $orderby: 'EventDate desc' },
        pagination: {
          type: 'offset',
          pageParam: '$skip',
          limitParam: '$top',
          limit: 100,
          maxPages: 20,
        },
        fieldMappings: { EventBodyName: 'body' },
        compositeFields: {
          externalId: 'california-sonoma-legistar-{EventId}',
          scheduledAt: '{EventDate:date} {EventTime}',
        },
      }),
      schemaPath,
    );
    expect(result.valid).toBe(true);
  });

  it('accepts an api block with neither new field (back-compat)', () => {
    const result = validateRegionFile(
      withApi({ resultsPath: 'results' }),
      schemaPath,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects non-string composite templates', () => {
    const result = validateRegionFile(
      withApi({ compositeFields: { scheduledAt: 42 } }),
      schemaPath,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects maxPages below 1', () => {
    const result = validateRegionFile(
      withApi({ pagination: { type: 'offset', maxPages: 0 } }),
      schemaPath,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects an unknown property on the api block', () => {
    const result = validateRegionFile(
      withApi({ compositeField: { a: 'b' } }),
      schemaPath,
    );
    expect(result.valid).toBe(false);
  });
});

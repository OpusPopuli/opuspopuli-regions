/**
 * Regression test for the `${variableName}` placeholder documentation
 * in `schema/region-plugin.schema.json` (issue #41 finding 2).
 *
 * Placeholder support is part of the public contract — consumers resolve
 * these at runtime from the active local region's stateCode. Without an
 * explicit doc string contributors can't tell from the schema alone that
 * these fields aren't literal-string-only. This test guards against a
 * future PR silently stripping the documentation.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schemaPath = join(__dirname, '..', 'schema', 'region-plugin.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as {
  description: string;
  definitions: {
    ApiSourceConfig: {
      properties: { queryParams: { description: string } };
    };
    BulkDownloadConfig: {
      properties: { filters: { description: string } };
    };
  };
};

describe('Schema placeholder documentation (#41)', () => {
  it('top-level description mentions ${variableName} placeholders', () => {
    expect(schema.description).toMatch(/\$\{variableName\}/);
  });

  it('ApiSourceConfig.queryParams documents ${stateCode}', () => {
    const desc = schema.definitions.ApiSourceConfig.properties.queryParams.description;
    expect(desc).toMatch(/\$\{stateCode\}/);
    expect(desc).toMatch(/runtime/);
  });

  it('BulkDownloadConfig.filters documents ${stateCode}', () => {
    const desc = schema.definitions.BulkDownloadConfig.properties.filters.description;
    expect(desc).toMatch(/\$\{stateCode\}/);
    expect(desc).toMatch(/runtime/);
  });

  it('placeholder docs name the supported variable explicitly', () => {
    // If new variables are added later (${countyFips}, ${regionId}, etc.),
    // they should be documented in BOTH descriptions to keep them in sync.
    // This test pins ${stateCode} as the current supported set.
    const queryParamsDesc = schema.definitions.ApiSourceConfig.properties.queryParams.description;
    const filtersDesc = schema.definitions.BulkDownloadConfig.properties.filters.description;
    expect(queryParamsDesc).toMatch(/Supported variables: \$\{stateCode\}/);
    expect(filtersDesc).toMatch(/Supported variables: \$\{stateCode\}/);
  });
});

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
    TigerLayerConfig: {
      description: string;
      properties: {
        where: { description: string };
        ocdIdSegment: { description: string };
        nameTemplate: { description: string };
      };
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

describe('TigerLayerConfig placeholder documentation (#804)', () => {
  // The consumer's BoundaryLoaderService substitutes ${fipsCode}, ${stateCode},
  // ${name}, ${district} into these fields at runtime. If a future PR silently
  // strips the documentation, region authors won't know the substitution is
  // supported. Pin the docs the same way schema-placeholders does for
  // ApiSourceConfig.queryParams.

  it('TigerLayerConfig top-level description names the supported placeholder set', () => {
    const desc = schema.definitions.TigerLayerConfig.description;
    expect(desc).toMatch(/\$\{fipsCode\}/);
    expect(desc).toMatch(/\$\{stateCode\}/);
    expect(desc).toMatch(/\$\{name\}/);
    expect(desc).toMatch(/\$\{district\}/);
  });

  it('TigerLayerConfig.where documents ${fipsCode}', () => {
    expect(schema.definitions.TigerLayerConfig.properties.where.description).toMatch(
      /\$\{fipsCode\}/,
    );
  });

  it('TigerLayerConfig.ocdIdSegment documents both ${name} and ${district}', () => {
    const desc = schema.definitions.TigerLayerConfig.properties.ocdIdSegment.description;
    expect(desc).toMatch(/\$\{name\}/);
    expect(desc).toMatch(/\$\{district\}/);
  });

  it('TigerLayerConfig.ocdIdSegment documents the OCD-ID name-normalization rule', () => {
    // The whitespace-to-underscores + lowercase rule is a hidden contract —
    // without docs, region authors writing ocdIdSegment will pass mixed-case
    // names and get OCD-IDs the consumer normalizes silently. Pin the doc.
    const desc = schema.definitions.TigerLayerConfig.properties.ocdIdSegment.description;
    expect(desc).toMatch(/normaliz/i);
    expect(desc).toMatch(/underscore|lowercase/i);
  });

  it('TigerLayerConfig.nameTemplate documents the ${name}/${district}/${stateCode} set', () => {
    const desc = schema.definitions.TigerLayerConfig.properties.nameTemplate.description;
    expect(desc).toMatch(/\$\{name\}/);
    expect(desc).toMatch(/\$\{district\}/);
    expect(desc).toMatch(/\$\{stateCode\}/);
  });
});

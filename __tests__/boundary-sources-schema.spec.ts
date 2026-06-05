/**
 * Schema-spec coverage for the boundarySources block added in opuspopuli#804.
 *
 * The consumer's BoundaryLoaderService trusts this contract — if the schema
 * permits an invalid shape, the loader will fail at runtime against a real
 * region config. These tests pin the required-field set and enum membership
 * so future schema edits can't silently loosen the contract.
 */

import { join } from 'node:path';
import { validateRegionFile } from '../src/cli/lib/schema-validator';

const schemaPath = join(__dirname, '..', 'schema', 'region-plugin.schema.json');

// Helper to build a minimal valid wrapper around a boundarySources block.
// Mirrors the top-level region file shape so we exercise the same code path
// as production configs without depending on any region's data sources.
function withBoundary(boundarySources: unknown): Record<string, unknown> {
  return {
    name: 'test-region',
    displayName: 'Test Region',
    description: 'Test region for boundary-sources spec',
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
          url: 'https://example.gov/feed',
          dataType: 'propositions',
          contentGoal: 'placeholder',
        },
      ],
      boundarySources,
    },
  };
}

describe('BoundarySourcesConfig schema (#804)', () => {
  describe('accepts valid shapes', () => {
    it('minimal — ocdIdPrefix only, no layers', () => {
      const result = validateRegionFile(
        withBoundary({ ocdIdPrefix: 'ocd-division/country:us/state:ca' }),
        schemaPath,
      );
      expect(result.valid).toBe(true);
    });

    it('full CA-shape — TIGER + Geoportal layers, all optional fields populated', () => {
      const result = validateRegionFile(
        withBoundary({
          ocdIdPrefix: 'ocd-division/country:us/state:ca',
          tigerLayers: [
            {
              layer: 'State_County/MapServer/1',
              where: "STATE='${fipsCode}'",
              outFields: 'GEOID,NAME',
              jurisdictionType: 'COUNTY',
              level: 'COUNTY',
              nameField: 'NAME',
              ocdIdSegment: '/county:${name}',
            },
            {
              layer: 'Legislative/MapServer/1',
              outFields: 'GEOID,SLDUST',
              jurisdictionType: 'STATE_SENATE_DISTRICT',
              level: 'STATE',
              nameField: 'SLDUST',
              fipsPrefix: 'sldu-',
              districtField: 'SLDUST',
              ocdIdSegment: '/sldu:${district}',
              nameTemplate: 'California State Senate District ${district}',
            },
          ],
          geoportalLayers: [
            {
              url: 'https://services1.arcgis.com/x/arcgis/rest/services/Y/FeatureServer/0',
              outFields: 'OBJECTID,AGENCY',
              jurisdictionType: 'FIRE_DISTRICT',
              level: 'DISTRICT',
              nameField: 'AGENCY',
              ocdIdSegment: '/fire_district:${name}',
            },
          ],
        }),
        schemaPath,
      );
      expect(result.valid).toBe(true);
    });

    it('regions omitting boundarySources entirely', () => {
      // boundarySources is optional — regions without public boundary data
      // (e.g. federal-only configs) should still validate.
      const config = withBoundary({ ocdIdPrefix: 'unused' });
      delete (config.config as Record<string, unknown>).boundarySources;
      const result = validateRegionFile(config, schemaPath);
      expect(result.valid).toBe(true);
    });
  });

  describe('rejects invalid shapes', () => {
    it('missing ocdIdPrefix', () => {
      const result = validateRegionFile(
        withBoundary({ tigerLayers: [] }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('TigerLayerConfig missing required `layer`', () => {
      const result = validateRegionFile(
        withBoundary({
          ocdIdPrefix: 'prefix',
          tigerLayers: [
            {
              outFields: 'NAME',
              jurisdictionType: 'COUNTY',
              level: 'COUNTY',
              nameField: 'NAME',
            },
          ],
        }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('TigerLayerConfig with an unsupported jurisdictionType', () => {
      const result = validateRegionFile(
        withBoundary({
          ocdIdPrefix: 'prefix',
          tigerLayers: [
            {
              layer: 'X/MapServer/0',
              outFields: 'NAME',
              jurisdictionType: 'BOGUS_TYPE',
              level: 'COUNTY',
              nameField: 'NAME',
            },
          ],
        }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('GeoportalLayerConfig missing required `url`', () => {
      const result = validateRegionFile(
        withBoundary({
          ocdIdPrefix: 'prefix',
          geoportalLayers: [
            {
              outFields: 'AGENCY',
              jurisdictionType: 'FIRE_DISTRICT',
              level: 'DISTRICT',
              nameField: 'AGENCY',
            },
          ],
        }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('TigerLayerConfig with unknown extra property (additionalProperties=false)', () => {
      // additionalProperties:false catches typos like `layerName` vs `layer`.
      // Without this guard a future contributor adds a misspelled field, the
      // schema silently ignores it, and the loader runs against undefined.
      const result = validateRegionFile(
        withBoundary({
          ocdIdPrefix: 'prefix',
          tigerLayers: [
            {
              layer: 'X/MapServer/0',
              outFields: 'NAME',
              jurisdictionType: 'COUNTY',
              level: 'COUNTY',
              nameField: 'NAME',
              unknownField: 'oops',
            },
          ],
        }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('empty tigerLayers array (minItems=1)', () => {
      // Empty arrays are rejected — region authors should omit the field
      // entirely rather than passing []. The intent guard catches a class of
      // PR mistakes where a refactor strips the entries but leaves the empty
      // array behind, silently disabling boundary loading.
      const result = validateRegionFile(
        withBoundary({ ocdIdPrefix: 'prefix', tigerLayers: [] }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('empty geoportalLayers array (minItems=1)', () => {
      const result = validateRegionFile(
        withBoundary({ ocdIdPrefix: 'prefix', geoportalLayers: [] }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('GeoportalLayerConfig.url with non-HTTPS scheme', () => {
      // Server-side fetches must be HTTPS — guard against file://, http://,
      // javascript:, etc. introduced via copy-paste from local testing or
      // legacy non-TLS hosts.
      const result = validateRegionFile(
        withBoundary({
          ocdIdPrefix: 'prefix',
          geoportalLayers: [
            {
              url: 'http://services.example.com/arcgis/rest/services/X/FeatureServer/0',
              outFields: 'NAME',
              jurisdictionType: 'FIRE_DISTRICT',
              level: 'DISTRICT',
              nameField: 'NAME',
            },
          ],
        }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });
  });
});

/**
 * Schema-spec coverage for the linkDiscovery block added in opuspopuli#1164.
 *
 * The scraping pipeline's link-discovery navigator trusts this contract —
 * these tests pin the required-field set, the step shape, and the select
 * enum so future schema edits can't silently loosen it.
 */

import { join } from 'node:path';
import { validateRegionFile } from '../src/cli/lib/schema-validator';

const schemaPath = join(__dirname, '..', 'schema', 'region-plugin.schema.json');

// Minimal valid wrapper around a single data source carrying linkDiscovery,
// mirroring the top-level region file shape.
function withLinkDiscovery(linkDiscovery: unknown): Record<string, unknown> {
  return {
    name: 'test-region',
    displayName: 'Test Region',
    description: 'Test region for link-discovery spec',
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
          url: 'https://example.gov/elections',
          dataType: 'propositions',
          contentGoal: 'placeholder',
          linkDiscovery,
        },
      ],
    },
  };
}

describe('LinkDiscoveryConfig schema (#1164)', () => {
  describe('accepts valid shapes', () => {
    it('minimal — one step, textPattern only', () => {
      const result = validateRegionFile(
        withLinkDiscovery({ steps: [{ textPattern: 'Measures' }] }),
        schemaPath,
      );
      expect(result.valid).toBe(true);
    });

    it('full Sonoma-shape — two steps with hrefPattern, select, maxLeafPages', () => {
      const result = validateRegionFile(
        withLinkDiscovery({
          steps: [
            {
              textPattern: '(Primary|General|Special) Election',
              hrefPattern: '/registrar-of-voters/elections/',
              select: 'all',
            },
            {
              textPattern: 'Local Measures That Have Been Filed',
              select: 'first',
            },
          ],
          maxLeafPages: 4,
        }),
        schemaPath,
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('rejects invalid shapes', () => {
    it('missing steps', () => {
      const result = validateRegionFile(
        withLinkDiscovery({ maxLeafPages: 4 }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('empty steps array', () => {
      const result = validateRegionFile(
        withLinkDiscovery({ steps: [] }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('step without textPattern', () => {
      const result = validateRegionFile(
        withLinkDiscovery({ steps: [{ hrefPattern: '/elections/' }] }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('select outside the enum', () => {
      const result = validateRegionFile(
        withLinkDiscovery({
          steps: [{ textPattern: 'Measures', select: 'every' }],
        }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('maxLeafPages below 1', () => {
      const result = validateRegionFile(
        withLinkDiscovery({
          steps: [{ textPattern: 'Measures' }],
          maxLeafPages: 0,
        }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('unknown property on the block', () => {
      const result = validateRegionFile(
        withLinkDiscovery({
          steps: [{ textPattern: 'Measures' }],
          maxDepth: 3,
        }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });

    it('unknown property on a step', () => {
      const result = validateRegionFile(
        withLinkDiscovery({
          steps: [{ textPattern: 'Measures', linkSelector: 'a.measure' }],
        }),
        schemaPath,
      );
      expect(result.valid).toBe(false);
    });
  });
});

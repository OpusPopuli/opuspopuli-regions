/**
 * Schema coverage for the `xlsx` bulk format added in opuspopuli#1107.
 *
 * Adding it meant relaxing `required: ["format", "columnMappings"]` on
 * BulkDownloadConfig, because a pivot-shaped sheet has no stable column names
 * to map. The relaxation is conditional — delimited formats must still carry
 * columnMappings, or every row parses into an object with no domain fields and
 * the load succeeds while writing nothing useful.
 *
 * These tests pin that conditional so a later edit cannot quietly drop the
 * constraint for tsv/csv while appearing to only touch xlsx.
 */

import { join } from 'node:path';
import { validateRegionFile } from '../src/cli/lib/schema-validator';

const schemaPath = join(__dirname, '..', 'schema', 'region-plugin.schema.json');

function withBulkSource(bulk: unknown, dataType = 'county_thresholds') {
  return {
    name: 'test-region',
    displayName: 'Test Region',
    description: 'Test region for bulk xlsx spec',
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
          url: 'https://elections.example.gov/sov.xlsx',
          dataType,
          contentGoal: 'placeholder',
          sourceType: 'bulk_download',
          bulk,
        },
      ],
    },
  };
}

const valid = (bulk: unknown, dataType?: string) =>
  validateRegionFile(withBulkSource(bulk, dataType), schemaPath).valid;

describe('BulkDownloadConfig — xlsx (#1107)', () => {
  it('accepts an xlsx source with no columnMappings', () => {
    expect(
      valid({
        format: 'xlsx',
        xlsx: { sumAllValueColumns: true, electionYear: 2022 },
      }),
    ).toBe(true);
  });

  it('still REQUIRES columnMappings for every delimited format', () => {
    // The whole point of the conditional. If this passes, a campaign-finance
    // source can ship with no mappings and silently ingest nothing.
    for (const format of ['tsv', 'csv', 'zip_tsv', 'zip_csv']) {
      expect(valid({ format }, 'campaign_finance')).toBe(false);
    }
  });

  it('accepts a delimited format that does carry columnMappings', () => {
    expect(
      valid(
        { format: 'csv', columnMappings: { AMOUNT: 'amount' } },
        'campaign_finance',
      ),
    ).toBe(true);
  });

  it('rejects an unknown key inside xlsx', () => {
    // additionalProperties:false — a typo like `sumAllColumns` would otherwise
    // be accepted and silently ignored, so the load would read one column and
    // understate every threshold.
    expect(valid({ format: 'xlsx', xlsx: { sumAllColumns: true } })).toBe(
      false,
    );
  });

  it('rejects an unknown bulk format', () => {
    expect(valid({ format: 'parquet' })).toBe(false);
  });

  it('accepts county_thresholds as a dataType', () => {
    expect(
      valid({ format: 'xlsx', xlsx: { valueColumn: 2 } }, 'county_thresholds'),
    ).toBe(true);
  });

  describe('csv layout for a domain-read source (#1131)', () => {
    const census = {
      field: 'population',
      fipsColumns: ['STATE', 'COUNTY'],
      nameColumn: 'CTYNAME',
      valueColumn: 'POPESTIMATE2024',
      rowFilter: { SUMLEV: '050', STATE: '06' },
      asOf: '2024-07-01',
    };

    it('accepts a csv source with a layout and no columnMappings', () => {
      // Read by the domain handler column-by-column, not ingested wholesale.
      expect(valid({ format: 'csv', csv: census })).toBe(true);
    });

    it('STILL requires columnMappings for a csv source with no layout', () => {
      // The generic bulk path needs them, and the exemption must not leak to
      // every csv source just because one kind is exempt.
      expect(valid({ format: 'csv' }, 'campaign_finance')).toBe(false);
      expect(valid({ format: 'tsv' }, 'campaign_finance')).toBe(false);
    });

    it('requires the fields that make the file readable at all', () => {
      const omit = (key: keyof typeof census) => {
        const copy: Record<string, unknown> = { ...census };
        delete copy[key];
        return copy;
      };
      const noField = omit('field');
      const noFips = omit('fipsColumns');
      const noValue = omit('valueColumn');
      expect(valid({ format: 'csv', csv: noField })).toBe(false);
      expect(valid({ format: 'csv', csv: noFips })).toBe(false);
      expect(valid({ format: 'csv', csv: noValue })).toBe(false);
    });

    it('rejects a field it does not know how to write', () => {
      expect(valid({ format: 'csv', csv: { ...census, field: 'gdp' } })).toBe(
        false,
      );
    });

    it('rejects an unknown key inside csv', () => {
      // A typo like `rowFilters` would otherwise be ignored, and every
      // state-level row would be written as a county.
      expect(valid({ format: 'csv', csv: { ...census, rowFilters: {} } })).toBe(
        false,
      );
    });
  });
});

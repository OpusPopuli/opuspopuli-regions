/**
 * Schema coverage for the fields the California Legislature's pubinfo export
 * needs (opuspopuli docs/plans/bills-phase-b.md, D9): backtick quoting, a NULL
 * token, .lob side files, a file that rotates by weekday, and the bill status
 * lifecycle map.
 *
 * The rules worth pinning are the ones that narrow: a rotating name must carry
 * {weekday} and no path, lobColumns needs a zip, and a lifecycle value comes
 * only from the three the consumer understands.
 */

import { join } from 'node:path';
import { validateRegionFile } from '../src/cli/lib/schema-validator';

const schemaPath = join(__dirname, '..', 'schema', 'region-plugin.schema.json');

const DIRECTORY_URL = 'https://downloads.leginfo.legislature.ca.gov/';

function withSource(source: Record<string, unknown>) {
  return {
    name: 'test-region',
    displayName: 'Test Region',
    description: 'Test region for the pubinfo bulk spec',
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
          url: DIRECTORY_URL,
          dataType: 'bills',
          contentGoal: 'placeholder',
          sourceType: 'bulk_download',
          ...source,
        },
      ],
    },
  };
}

const pubinfoBulk = (extra: Record<string, unknown> = {}) => ({
  format: 'zip_tsv',
  filePattern: 'BILL_TBL.dat',
  headers: ['bill_id', 'current_status'],
  quoteChar: '`',
  nullToken: 'NULL',
  columnMappings: { bill_id: 'externalId', current_status: 'currentStatus' },
  rotatingFile: {
    name: 'pubinfo_daily_{weekday}.zip',
    publishedAfter: '21:30',
  },
  ...extra,
});

const valid = (source: Record<string, unknown>) =>
  validateRegionFile(withSource(source), schemaPath).valid;

describe('BulkDownloadConfig — pubinfo (bills-phase-b D9)', () => {
  it('accepts a pubinfo table source', () => {
    expect(valid({ bulk: pubinfoBulk() })).toBe(true);
  });

  it('accepts lobColumns on a zip', () => {
    expect(valid({ bulk: pubinfoBulk({ lobColumns: ['bill_xml'] }) })).toBe(
      true,
    );
  });

  it('rejects lobColumns on a bare tsv, which has no entries to resolve', () => {
    expect(
      valid({
        url: 'https://example.gov/bills.tsv',
        bulk: pubinfoBulk({
          format: 'tsv',
          rotatingFile: undefined,
          lobColumns: ['bill_xml'],
        }),
      }),
    ).toBe(false);
  });

  it('rejects a quoteChar longer than one character', () => {
    expect(valid({ bulk: pubinfoBulk({ quoteChar: '``' }) })).toBe(false);
  });

  it('rejects a publishedAfter that is not HH:MM', () => {
    expect(
      valid({
        bulk: pubinfoBulk({
          rotatingFile: {
            name: 'pubinfo_daily_{weekday}.zip',
            publishedAfter: '9:30pm',
          },
        }),
      }),
    ).toBe(false);
  });

  it('rejects a rotating name with no {weekday}', () => {
    expect(
      valid({
        bulk: pubinfoBulk({
          rotatingFile: {
            name: 'pubinfo_daily_Thu.zip',
            publishedAfter: '21:30',
          },
        }),
      }),
    ).toBe(false);
  });

  it('rejects a rotating name that carries a path', () => {
    // The name resolves against url; a path in it could leave the directory.
    expect(
      valid({
        bulk: pubinfoBulk({
          rotatingFile: {
            name: '../other/{weekday}.zip',
            publishedAfter: '21:30',
          },
        }),
      }),
    ).toBe(false);
  });

  it('keeps a plain url strict', () => {
    expect(
      valid({
        url: 'https://downloads.leginfo.legislature.ca.gov/pubinfo_daily_{weekday}.zip',
        bulk: pubinfoBulk(),
      }),
    ).toBe(false);
  });
});

describe('DataSourceConfig — bill lifecycle (bills-phase-b D11, D1)', () => {
  it('accepts a status lifecycle map and coldAfterDays', () => {
    expect(
      valid({
        bulk: pubinfoBulk(),
        coldAfterDays: 180,
        billStatusLifecycle: {
          'In Committee Process': 'active',
          Chaptered: 'enacted',
          Vetoed: 'dead',
        },
      }),
    ).toBe(true);
  });

  it('rejects a lifecycle value the consumer does not understand', () => {
    expect(
      valid({
        bulk: pubinfoBulk(),
        billStatusLifecycle: { Chaptered: 'passed' },
      }),
    ).toBe(false);
  });

  it('rejects an empty lifecycle map', () => {
    expect(valid({ bulk: pubinfoBulk(), billStatusLifecycle: {} })).toBe(false);
  });

  it('rejects a negative coldAfterDays', () => {
    expect(valid({ bulk: pubinfoBulk(), coldAfterDays: -1 })).toBe(false);
  });
});

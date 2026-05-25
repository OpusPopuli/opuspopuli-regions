import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getRequiredFields,
  checkFieldDetection,
} from '../../src/cli/lib/required-fields';
import type { FieldDetectionResult } from '../../src/cli/lib/field-detector';

function baseDetection(
  overrides: Partial<FieldDetectionResult> = {},
): FieldDetectionResult {
  return {
    pageType: 'listing',
    headings: [],
    imageCount: 0,
    hasRelativeImages: false,
    detectedPhone: null,
    detectedEmail: null,
    detectedDates: [],
    linkCount: 0,
    ...overrides,
  };
}

describe('getRequiredFields', () => {
  it('returns the expected representatives fields', () => {
    const fields = getRequiredFields('representatives');
    const names = fields.map((f) => f.name);
    expect(names).toEqual([
      'externalId',
      'name',
      'district',
      'phone',
      'email',
      'photoUrl',
      'detailUrl',
    ]);
  });

  it('returns the expected meetings fields', () => {
    const names = getRequiredFields('meetings').map((f) => f.name);
    expect(names).toContain('externalId');
    expect(names).toContain('title');
    expect(names).toContain('scheduledAt');
    expect(names).toContain('location');
  });

  it('returns the expected bills fields', () => {
    const names = getRequiredFields('bills').map((f) => f.name);
    expect(names).toContain('billNumber');
    expect(names).toContain('title');
    expect(names).toContain('status');
    expect(names).toContain('author');
  });

  it('returns an empty array for an unrecognised dataType', () => {
    expect(getRequiredFields('not_a_real_type')).toEqual([]);
  });
});

describe('FIELDS map ↔ schema dataType enum (issue #41 cross-check)', () => {
  // Catches future drift: if a new dataType is added to the schema, this
  // test fails until `required-fields.ts` is updated to match. Otherwise
  // the new dataType would silently return [] from getRequiredFields().
  it('covers every dataType in the schema enum', () => {
    const schemaPath = join(__dirname, '..', '..', 'schema', 'region-plugin.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as {
      definitions: {
        DataSourceConfig: {
          properties: { dataType: { enum: string[] } };
        };
      };
    };
    const enumValues =
      schema.definitions.DataSourceConfig.properties.dataType.enum;

    for (const dt of enumValues) {
      const fields = getRequiredFields(dt);
      expect(fields.length).toBeGreaterThan(0);
    }
  });
});

describe('checkFieldDetection', () => {
  describe('alwaysWarn fields', () => {
    it('returns ok=false with the configured warnMessage', () => {
      const fields = getRequiredFields('representatives');
      const externalId = fields.find((f) => f.name === 'externalId')!;
      const result = checkFieldDetection(externalId, baseDetection());
      expect(result.ok).toBe(false);
      expect(result.note).toMatch(/construction rule/);
    });
  });

  describe('phone detection', () => {
    const fields = getRequiredFields('representatives');
    const phoneField = fields.find((f) => f.name === 'phone')!;

    it('returns ok with the detected phone when present', () => {
      const result = checkFieldDetection(
        phoneField,
        baseDetection({ detectedPhone: '(831) 555-1234' }),
      );
      expect(result.ok).toBe(true);
      expect(result.note).toBe('(831) 555-1234');
    });

    it('returns ok=false when no phone pattern found', () => {
      const result = checkFieldDetection(phoneField, baseDetection());
      expect(result.ok).toBe(false);
      expect(result.note).toMatch(/no phone pattern/);
    });
  });

  describe('email detection', () => {
    const emailField = getRequiredFields('representatives').find(
      (f) => f.name === 'email',
    )!;

    it('returns ok with detected email', () => {
      const result = checkFieldDetection(
        emailField,
        baseDetection({ detectedEmail: 'foo@bar.gov' }),
      );
      expect(result.ok).toBe(true);
      expect(result.note).toBe('foo@bar.gov');
    });

    it('returns ok=false when no email pattern found', () => {
      const result = checkFieldDetection(emailField, baseDetection());
      expect(result.ok).toBe(false);
    });
  });

  describe('date detection', () => {
    const dateField = getRequiredFields('meetings').find(
      (f) => f.name === 'scheduledAt',
    )!;

    it('uses the first detected date when present', () => {
      const result = checkFieldDetection(
        dateField,
        baseDetection({ detectedDates: ['March 15, 2026', 'April 1, 2026'] }),
      );
      expect(result.ok).toBe(true);
      expect(result.note).toBe('March 15, 2026');
    });

    it('returns ok=false when no dates found', () => {
      const result = checkFieldDetection(dateField, baseDetection());
      expect(result.ok).toBe(false);
    });
  });

  describe('heading detection', () => {
    const nameField = getRequiredFields('representatives').find(
      (f) => f.name === 'name',
    )!;

    it('returns ok when headings are present', () => {
      const result = checkFieldDetection(
        nameField,
        baseDetection({ headings: ['Jane Smith'] }),
      );
      expect(result.ok).toBe(true);
    });

    it('returns ok=false when no headings', () => {
      const result = checkFieldDetection(nameField, baseDetection());
      expect(result.ok).toBe(false);
    });
  });

  describe('image detection (special-cased relative-URL branch)', () => {
    const photoField = getRequiredFields('representatives').find(
      (f) => f.name === 'photoUrl',
    )!;

    it('returns ok when absolute images are present', () => {
      const result = checkFieldDetection(
        photoField,
        baseDetection({ imageCount: 3, hasRelativeImages: false }),
      );
      expect(result.ok).toBe(true);
      expect(result.note).toMatch(/3 image\(s\)/);
    });

    it('warns specifically about relative URLs when those are detected', () => {
      const result = checkFieldDetection(
        photoField,
        baseDetection({ imageCount: 3, hasRelativeImages: true }),
      );
      expect(result.ok).toBe(false);
      expect(result.note).toMatch(/relative URLs/);
      expect(result.note).toMatch(/absolutization hint/);
    });

    it('returns ok=false when no images are on the page', () => {
      const result = checkFieldDetection(
        photoField,
        baseDetection({ imageCount: 0 }),
      );
      expect(result.ok).toBe(false);
      expect(result.note).toMatch(/no images/);
    });
  });

  describe('link detection', () => {
    const detailUrlField = getRequiredFields('representatives').find(
      (f) => f.name === 'detailUrl',
    )!;

    it('returns ok with the link count when links are present', () => {
      const result = checkFieldDetection(
        detailUrlField,
        baseDetection({ linkCount: 12 }),
      );
      expect(result.ok).toBe(true);
      expect(result.note).toMatch(/12 link\(s\)/);
    });

    it('returns ok=false when no links found', () => {
      const result = checkFieldDetection(detailUrlField, baseDetection());
      expect(result.ok).toBe(false);
    });
  });
});

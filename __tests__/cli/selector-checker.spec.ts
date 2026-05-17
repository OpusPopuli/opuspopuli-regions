import { checkSelectors, hasSelectorsToCheck } from '../../src/cli/lib/selector-checker';
import type { DataSourceConfig } from '../../src/cli/lib/config-loader';

const HTML_WITH_CLASSES = `
<html><body>
  <div class="tray-profile">
    <div class="box-profile">
      <img src="/photo.jpg" alt="Jane Smith" />
      <h3><a href="/profile/1">Jane Smith</a></h3>
    </div>
    <div class="box-profile">
      <img src="/photo2.jpg" alt="Bob Jones" />
      <h3><a href="/profile/2">Bob Jones</a></h3>
    </div>
  </div>
</body></html>
`;

const DS_WITH_STATIC_MANIFEST: DataSourceConfig = {
  url: 'https://example.gov/bos',
  dataType: 'representatives',
  contentGoal: 'Extract supervisors',
  staticManifest: {
    containerSelector: '.tray-profile',
    itemSelector: '.box-profile',
    fieldMappings: [
      { fieldName: 'name', selector: 'img', extractionMethod: 'attribute', required: true },
      { fieldName: 'district', selector: 'h3 a', extractionMethod: 'text', required: true },
      { fieldName: 'externalId', selector: '.missing-class', extractionMethod: 'text', required: true },
    ],
  },
};

const DS_WITH_DETAIL_FIELDS: DataSourceConfig = {
  url: 'https://example.gov/bos',
  dataType: 'representatives',
  contentGoal: 'Extract supervisors',
  detailFields: {
    photoUrl: 'img|attr:src',
    detailUrl: 'h3 a|attr:href',
    name: '.nonexistent|text',
  },
};

const DS_PLAIN: DataSourceConfig = {
  url: 'https://example.gov/bos',
  dataType: 'representatives',
  contentGoal: 'Extract supervisors',
  hints: ['Look for supervisor cards'],
};

describe('hasSelectorsToCheck', () => {
  it('returns true when staticManifest is present', () => {
    expect(hasSelectorsToCheck(DS_WITH_STATIC_MANIFEST)).toBe(true);
  });

  it('returns true when detailFields is present', () => {
    expect(hasSelectorsToCheck(DS_WITH_DETAIL_FIELDS)).toBe(true);
  });

  it('returns false for plain config with only hints', () => {
    expect(hasSelectorsToCheck(DS_PLAIN)).toBe(false);
  });
});

describe('checkSelectors — staticManifest', () => {
  it('finds present container and item selectors', () => {
    const results = checkSelectors(HTML_WITH_CLASSES, DS_WITH_STATIC_MANIFEST);
    const container = results.find((r) => r.field === 'containerSelector');
    const item = results.find((r) => r.field === 'itemSelector');
    expect(container?.found).toBe(true);
    expect(item?.found).toBe(true);
    expect(item?.count).toBe(2);
  });

  it('flags a missing selector as not found', () => {
    const results = checkSelectors(HTML_WITH_CLASSES, DS_WITH_STATIC_MANIFEST);
    const missing = results.find((r) => r.field === 'externalId');
    expect(missing?.found).toBe(false);
    expect(missing?.count).toBe(0);
  });

  it('marks origin as staticManifest', () => {
    const results = checkSelectors(HTML_WITH_CLASSES, DS_WITH_STATIC_MANIFEST);
    expect(results.every((r) => r.origin === 'staticManifest')).toBe(true);
  });
});

describe('checkSelectors — detailFields', () => {
  it('strips |attr: pipe suffix before checking', () => {
    const results = checkSelectors(HTML_WITH_CLASSES, DS_WITH_DETAIL_FIELDS);
    const photo = results.find((r) => r.field === 'photoUrl');
    expect(photo?.selector).toBe('img');
    expect(photo?.found).toBe(true);
  });

  it('flags missing detail field selector', () => {
    const results = checkSelectors(HTML_WITH_CLASSES, DS_WITH_DETAIL_FIELDS);
    const name = results.find((r) => r.field === 'name');
    expect(name?.found).toBe(false);
  });

  it('marks origin as detailFields', () => {
    const results = checkSelectors(HTML_WITH_CLASSES, DS_WITH_DETAIL_FIELDS);
    expect(results.every((r) => r.origin === 'detailFields')).toBe(true);
  });
});

describe('checkSelectors — plain config', () => {
  it('returns empty array when no selectors to check', () => {
    const results = checkSelectors(HTML_WITH_CLASSES, DS_PLAIN);
    expect(results).toHaveLength(0);
  });
});

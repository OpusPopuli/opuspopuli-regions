import { buildDataSourceConfig } from '../../src/cli/lib/manifest-to-config';
import type { OllamaAnalysis } from '../../src/cli/lib/ollama-analyzer';

const FULL_ANALYSIS: OllamaAnalysis = {
  pageType: 'detail',
  contentGoal: 'Extract supervisor name, district, phone, email, and photo URL',
  hints: [
    'Supervisor name is in h1.supervisor-name',
    'District number is in .district-badge',
    'Contact info is in .contact-block',
  ],
  detectedFields: {
    name: { cssSelector: 'h1.supervisor-name', evidence: 'Jane Smith', confidence: 'high' },
    district: { cssSelector: '.district-badge', evidence: 'District 1', confidence: 'high' },
    phone: { cssSelector: '.contact-block .phone', evidence: '(707) 565-2241', confidence: 'medium' },
    email: { cssSelector: '.contact-block .email', evidence: 'jane@county.gov', confidence: 'medium' },
    externalId: { cssSelector: '', evidence: 'requires explicit construction rule in contentGoal', confidence: 'low' },
    photoUrl: { cssSelector: 'img.portrait', evidence: 'add absolutization hint', confidence: 'medium' },
  },
};

describe('buildDataSourceConfig', () => {
  it('sets url, dataType, contentGoal from analysis', () => {
    const config = buildDataSourceConfig('https://example.gov/bos', 'representatives', FULL_ANALYSIS);
    expect(config.url).toBe('https://example.gov/bos');
    expect(config.dataType).toBe('representatives');
    expect(config.contentGoal).toBe(FULL_ANALYSIS.contentGoal);
  });

  it('includes hints when analysis has them', () => {
    const config = buildDataSourceConfig('https://example.gov/bos', 'representatives', FULL_ANALYSIS);
    expect(config.hints).toEqual(FULL_ANALYSIS.hints);
  });

  it('excludes externalId from detailFields regardless of presence', () => {
    const config = buildDataSourceConfig('https://example.gov/bos', 'representatives', FULL_ANALYSIS);
    expect(config.detailFields).not.toHaveProperty('externalId');
  });

  it('includes high/medium confidence fields in detailFields', () => {
    const config = buildDataSourceConfig('https://example.gov/bos', 'representatives', FULL_ANALYSIS);
    expect(config.detailFields).toHaveProperty('name', 'h1.supervisor-name');
    expect(config.detailFields).toHaveProperty('phone');
  });

  it('excludes low confidence fields from detailFields', () => {
    const config = buildDataSourceConfig('https://example.gov/bos', 'representatives', FULL_ANALYSIS);
    const fields = config.detailFields ? Object.keys(config.detailFields) : [];
    const lowConfidenceFields = Object.entries(FULL_ANALYSIS.detectedFields)
      .filter(([, v]) => v.confidence === 'low')
      .map(([k]) => k);
    for (const f of lowConfidenceFields) {
      expect(fields).not.toContain(f);
    }
  });

  it('uses fallback contentGoal when analysis returns empty string', () => {
    const config = buildDataSourceConfig('https://example.gov', 'meetings', {
      ...FULL_ANALYSIS,
      contentGoal: '',
    });
    expect(config.contentGoal).toContain('meetings');
  });

  it('omits hints when analysis has none', () => {
    const config = buildDataSourceConfig('https://example.gov', 'meetings', {
      ...FULL_ANALYSIS,
      hints: [],
    });
    expect(config.hints).toBeUndefined();
  });
});

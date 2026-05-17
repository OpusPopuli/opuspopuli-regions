import { detectFields } from '../../src/cli/lib/field-detector';

const REPRESENTATIVE_HTML = `
<html><body>
  <h1>District 1 Supervisor</h1>
  <h2>Jane Smith</h2>
  <p>Phone: (707) 565-2241</p>
  <p>Email: <a href="mailto:jane.smith@county.gov">jane.smith@county.gov</a></p>
  <img src="/images/jane-smith.jpg" alt="Jane Smith" />
  <a href="/supervisors/district-1">Profile Page</a>
</body></html>
`;

const LISTING_HTML = `
<html><body>
  <h1>Board of Supervisors</h1>
  <ul>
    <li class="supervisor-card"><h3>Jane Smith</h3><p>District 1</p></li>
    <li class="supervisor-card"><h3>Bob Jones</h3><p>District 2</p></li>
    <li class="supervisor-card"><h3>Carol White</h3><p>District 3</p></li>
    <li class="supervisor-card"><h3>Dave Black</h3><p>District 4</p></li>
    <li class="supervisor-card"><h3>Eve Green</h3><p>District 5</p></li>
    <li class="supervisor-card"><h3>Frank Blue</h3><p>District 6</p></li>
    <li class="supervisor-card"><h3>Grace Red</h3><p>District 7</p></li>
    <li class="supervisor-card"><h3>Henry Gray</h3><p>District 8</p></li>
    <li class="supervisor-card"><h3>Iris Brown</h3><p>District 9</p></li>
  </ul>
</body></html>
`;

const NO_CONTACT_HTML = `
<html><body>
  <h1>Meeting Agendas</h1>
  <p>Regular board meetings are held the first Tuesday of each month.</p>
  <a href="/agendas/2026-01-07.pdf">January 7, 2026 Agenda</a>
  <a href="/agendas/2025-12-03.pdf">December 3, 2025 Agenda</a>
</body></html>
`;

describe('detectFields', () => {
  it('detects phone and email from detail page', () => {
    const result = detectFields(REPRESENTATIVE_HTML);
    expect(result.detectedPhone).toBe('(707) 565-2241');
    expect(result.detectedEmail).toBe('jane.smith@county.gov');
  });

  it('detects headings', () => {
    const result = detectFields(REPRESENTATIVE_HTML);
    expect(result.headings).toContain('District 1 Supervisor');
    expect(result.headings).toContain('Jane Smith');
  });

  it('detects relative image URLs', () => {
    const result = detectFields(REPRESENTATIVE_HTML);
    expect(result.imageCount).toBe(1);
    expect(result.hasRelativeImages).toBe(true);
  });

  it('detects links', () => {
    const result = detectFields(REPRESENTATIVE_HTML);
    expect(result.linkCount).toBeGreaterThan(0);
  });

  it('classifies listing page when many list items present', () => {
    const result = detectFields(LISTING_HTML);
    expect(result.pageType).toBe('listing');
  });

  it('classifies detail page when headings present and few list items', () => {
    const result = detectFields(REPRESENTATIVE_HTML);
    expect(result.pageType).toBe('detail');
  });

  it('returns null phone/email when none present', () => {
    const result = detectFields(NO_CONTACT_HTML);
    expect(result.detectedPhone).toBeNull();
    expect(result.detectedEmail).toBeNull();
  });

  it('detects date patterns', () => {
    const result = detectFields(NO_CONTACT_HTML);
    expect(result.detectedDates.length).toBeGreaterThan(0);
  });
});

import * as cheerio from 'cheerio';

export type FieldDetectionResult = {
  pageType: 'detail' | 'listing' | 'unknown';
  headings: string[];
  imageCount: number;
  hasRelativeImages: boolean;
  detectedPhone: string | null;
  detectedEmail: string | null;
  detectedDates: string[];
  linkCount: number;
};

const PHONE_RE = /\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const EMAIL_RE = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})+/;
const LONG_DATE_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi;
const SHORT_DATE_RE = /\d{1,2}\/\d{1,2}\/\d{2,4}/gi;

function inferPageType(listItems: number, cardItems: number, headings: string[]): 'detail' | 'listing' | 'unknown' {
  if (listItems > 8 || cardItems > 3) return 'listing';
  if (headings.length > 0) return 'detail';
  return 'unknown';
}

export function detectFields(html: string): FieldDetectionResult {
  const $ = cheerio.load(html);

  const headings: string[] = [];
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim();
    if (text) headings.push(text);
  });

  const images = $('img');
  const imageCount = images.length;
  let hasRelativeImages = false;
  images.each((_, el) => {
    const src = $(el).attr('src') ?? $(el).attr('data-src') ?? '';
    if (src && !src.startsWith('http') && !src.startsWith('//') && !src.startsWith('data:')) {
      hasRelativeImages = true;
    }
  });

  const bodyText = $('body').text();
  const phoneMatch = bodyText.match(PHONE_RE);
  const emailMatch = bodyText.match(EMAIL_RE);
  const longDates = bodyText.match(LONG_DATE_RE) ?? [];
  const shortDates = bodyText.match(SHORT_DATE_RE) ?? [];
  const detectedDates = [...new Set([...longDates, ...shortDates])].slice(0, 3);

  const linkCount = $('a[href]').length;
  const listItems = $('li, tr').length;
  const cardItems = $('[class*="card"], [class*="member"], [class*="item"], [class*="row"], [class*="supervisor"]').length;

  return {
    pageType: inferPageType(listItems, cardItems, headings),
    headings: headings.slice(0, 5),
    imageCount,
    hasRelativeImages,
    detectedPhone: phoneMatch ? phoneMatch[0] : null,
    detectedEmail: emailMatch ? emailMatch[0] : null,
    detectedDates,
    linkCount,
  };
}

import * as cheerio from 'cheerio';

const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'svg', 'iframe',
  'link[rel="stylesheet"]', 'meta', 'head',
];
const MAX_CHARS = 12_000;

export function simplifyHtml(html: string, maxChars = MAX_CHARS): string {
  const $ = cheerio.load(html);
  for (const sel of STRIP_SELECTORS) $(sel).remove();
  $('[class]').each((_, el) => {
    const trimmed = $(el).attr('class')?.split(/\s+/).slice(0, 3).join(' ');
    if (trimmed) $(el).attr('class', trimmed);
  });
  const out = $('body').html() ?? $.html();
  return out.length > maxChars ? out.slice(0, maxChars) + '\n<!-- [truncated] -->' : out;
}

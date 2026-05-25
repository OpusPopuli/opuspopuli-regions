import { simplifyHtml } from '../../src/cli/lib/html-simplifier';

describe('simplifyHtml', () => {
  describe('element stripping', () => {
    it('removes script tags', () => {
      const html = '<html><body><p>keep</p><script>alert(1)</script></body></html>';
      const out = simplifyHtml(html);
      expect(out).toContain('<p>keep</p>');
      expect(out).not.toContain('script');
      expect(out).not.toContain('alert');
    });

    it('removes style and noscript tags', () => {
      const html = `
        <html>
          <body>
            <style>body { color: red; }</style>
            <noscript>JS disabled</noscript>
            <p>keep</p>
          </body>
        </html>
      `;
      const out = simplifyHtml(html);
      expect(out).toContain('<p>keep</p>');
      expect(out).not.toContain('color: red');
      expect(out).not.toContain('JS disabled');
    });

    it('removes svg and iframe tags', () => {
      const html = `
        <html><body>
          <svg><circle cx="50" cy="50" r="40"/></svg>
          <iframe src="https://ads.example.com"></iframe>
          <p>keep</p>
        </body></html>
      `;
      const out = simplifyHtml(html);
      expect(out).toContain('<p>keep</p>');
      expect(out).not.toContain('svg');
      expect(out).not.toContain('iframe');
    });

    it('removes link[rel="stylesheet"] without removing other link tags', () => {
      const html = `
        <html>
          <body>
            <link rel="stylesheet" href="/styles.css">
            <p>keep</p>
          </body>
        </html>
      `;
      const out = simplifyHtml(html);
      expect(out).toContain('<p>keep</p>');
      expect(out).not.toContain('stylesheet');
    });
  });

  describe('class-attribute trimming', () => {
    it('keeps the first 3 classes and drops the rest', () => {
      const html =
        '<html><body><div class="a b c d e f g">content</div></body></html>';
      const out = simplifyHtml(html);
      expect(out).toMatch(/class="a b c"/);
      expect(out).not.toContain('"a b c d');
      expect(out).not.toContain(' d e f g');
    });

    it('leaves elements with 3 or fewer classes unchanged', () => {
      const html =
        '<html><body><div class="alpha beta">x</div></body></html>';
      const out = simplifyHtml(html);
      expect(out).toMatch(/class="alpha beta"/);
    });

    it('does not touch elements without a class attribute', () => {
      const html = '<html><body><p>no class here</p></body></html>';
      const out = simplifyHtml(html);
      expect(out).toContain('<p>no class here</p>');
      // Should not have invented a class attribute.
      expect(out).not.toMatch(/<p class=/);
    });
  });

  describe('character-cap truncation', () => {
    it('returns full content when under the default limit', () => {
      const html = '<html><body><p>tiny</p></body></html>';
      const out = simplifyHtml(html);
      expect(out).not.toContain('truncated');
    });

    it('truncates and appends a banner when content exceeds the cap', () => {
      const body = '<p>x</p>'.repeat(2000); // ~16 KB of body
      const html = `<html><body>${body}</body></html>`;
      const out = simplifyHtml(html);

      expect(out.length).toBeLessThan(13_000); // 12k cap + ~30 char banner
      expect(out).toContain('<!-- [truncated] -->');
    });

    it('respects a custom maxChars cap', () => {
      const body = '<p>aaaaaaaa</p>'.repeat(100);
      const html = `<html><body>${body}</body></html>`;
      const out = simplifyHtml(html, 200);

      expect(out.length).toBeLessThan(250);
      expect(out).toContain('<!-- [truncated] -->');
    });
  });

  describe('body extraction', () => {
    it('returns just the body content, not the <head>', () => {
      const html = `
        <html>
          <head><meta charset="utf-8"><title>page</title></head>
          <body><p>body only</p></body>
        </html>
      `;
      const out = simplifyHtml(html);
      expect(out).toContain('<p>body only</p>');
      // head + meta + title are stripped by the selector list.
      expect(out).not.toContain('<title');
      expect(out).not.toContain('<meta');
    });

    it('falls back to the full document when no <body> is present', () => {
      const html = '<div>fragment without body</div>';
      const out = simplifyHtml(html);
      expect(out).toContain('fragment without body');
    });
  });
});

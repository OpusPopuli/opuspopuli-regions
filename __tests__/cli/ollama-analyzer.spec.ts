import { extractJson } from '../../src/cli/lib/ollama-analyzer';

describe('extractJson', () => {
  describe('fenced JSON', () => {
    it('extracts JSON wrapped in plain triple-backticks', () => {
      const input = '```\n{"a":1,"b":2}\n```';
      expect(extractJson(input)).toBe('{"a":1,"b":2}');
    });

    it('extracts JSON wrapped in fenced ```json blocks', () => {
      const input = '```json\n{"a":1}\n```';
      expect(extractJson(input)).toBe('{"a":1}');
    });

    it('handles multiline JSON inside a fenced block', () => {
      const input = '```json\n{\n  "a": 1,\n  "b": [2, 3]\n}\n```';
      expect(extractJson(input)).toBe('{\n  "a": 1,\n  "b": [2, 3]\n}');
    });

    it('strips leading/trailing whitespace from the fenced body', () => {
      const input = '```json\n   {"a":1}   \n```';
      expect(extractJson(input)).toBe('{"a":1}');
    });

    it('ignores prose before the fence', () => {
      const input =
        "Here's the JSON you asked for:\n\n```json\n{\"a\":1}\n```";
      expect(extractJson(input)).toBe('{"a":1}');
    });

    it('handles language tag on the opening fence', () => {
      // The implementation finds the first newline after the opening
      // fence, so `\`\`\`typescript` and `\`\`\`bash` etc. all work.
      const input = '```bash\n{"raw":true}\n```';
      expect(extractJson(input)).toBe('{"raw":true}');
    });
  });

  describe('bare JSON (no fence)', () => {
    it('extracts a top-level object', () => {
      const input = '{"a":1,"b":2}';
      expect(extractJson(input)).toBe('{"a":1,"b":2}');
    });

    it('trims surrounding whitespace from bare JSON', () => {
      const input = '   {"a":1}   ';
      // Bare JSON falls into the {...} slice path → unchanged inside boundaries.
      expect(extractJson(input)).toBe('{"a":1}');
    });
  });

  describe('JSON embedded in prose', () => {
    it('slices between the first { and the last }', () => {
      const input = 'Sure! The result is {"a":1} — hope that helps!';
      expect(extractJson(input)).toBe('{"a":1}');
    });

    it('handles nested objects when no fence is present', () => {
      const input = 'Result: {"outer":{"inner":42}} done.';
      expect(extractJson(input)).toBe('{"outer":{"inner":42}}');
    });

    it('falls through to trimmed content when there are no braces', () => {
      const input = '   no json here   ';
      expect(extractJson(input)).toBe('no json here');
    });

    it('falls through to trimmed content when braces are reversed', () => {
      // `}` before `{` → bogus, treat as no JSON.
      const input = '} this is broken {';
      expect(extractJson(input)).toBe('} this is broken {');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(extractJson('')).toBe('');
    });

    it('handles unclosed fence gracefully (falls through to {...} slice)', () => {
      // Opening fence but no closing — falls to brace-slice path and
      // recovers the inner JSON anyway.
      const input = '```json\n{"a":1}';
      expect(extractJson(input)).toBe('{"a":1}');
    });

    it('handles content that is just a fenced empty block', () => {
      const input = '```\n\n```';
      expect(extractJson(input)).toBe('');
    });

    it('JSON.parse can consume the output of well-formed inputs', () => {
      // The whole point of extractJson is to feed JSON.parse, so the
      // contract is "produces something parseable when input contains
      // valid JSON in any of the three shapes."
      const fenced = '```json\n{"a":1}\n```';
      const bare = '{"a":2}';
      const embedded = 'prose {"a":3} more prose';
      expect(JSON.parse(extractJson(fenced))).toEqual({ a: 1 });
      expect(JSON.parse(extractJson(bare))).toEqual({ a: 2 });
      expect(JSON.parse(extractJson(embedded))).toEqual({ a: 3 });
    });
  });
});

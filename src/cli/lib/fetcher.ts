export type FetchResult =
  | { html: string; bytes: number; ms: number }
  | { error: string };

export async function fetchHtml(url: string): Promise<FetchResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OpusPopuli-RegionCLI/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const html = await res.text();
    return { html, bytes: new TextEncoder().encode(html).length, ms: Date.now() - start };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

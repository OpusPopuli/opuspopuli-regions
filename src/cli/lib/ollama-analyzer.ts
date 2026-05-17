import { Ollama } from 'ollama';

const DEFAULT_HOST = process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env['OLLAMA_MODEL'] ?? 'qwen3.5:9b';

export type OllamaAnalysis = {
  pageType: 'detail' | 'listing' | 'unknown';
  contentGoal: string;
  hints: string[];
  detectedFields: Record<string, {
    cssSelector: string;
    evidence: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
};

function extractJson(content: string): string {
  const fenceStart = content.indexOf('```');
  if (fenceStart !== -1) {
    const afterFence = content.slice(fenceStart + 3);
    const bodyStart = afterFence.indexOf('\n');
    const body = afterFence.slice(bodyStart + 1);
    const fenceEnd = body.indexOf('```');
    if (fenceEnd !== -1) return body.slice(0, fenceEnd).trim();
  }
  const objStart = content.indexOf('{');
  const objEnd = content.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) return content.slice(objStart, objEnd + 1);
  return content.trim();
}

function makeClient(host = DEFAULT_HOST): Ollama {
  return new Ollama({ host });
}

export async function checkOllamaReachable(host = DEFAULT_HOST): Promise<boolean> {
  try {
    await makeClient(host).list();
    return true;
  } catch {
    return false;
  }
}

export async function analyzeWithOllama(
  prompt: string,
  host = DEFAULT_HOST,
  model = DEFAULT_MODEL,
): Promise<OllamaAnalysis> {
  const ollama = makeClient(host);
  // think: false disables chain-of-thought for qwen3.x thinking models via the
  // Ollama API's top-level parameter. Without this, a 9B thinking model can spend
  // 5+ minutes generating reasoning tokens before producing the JSON response.
  const response = await ollama.chat({
    model,
    messages: [{ role: 'user', content: prompt }],
    format: 'json',
    stream: false,
    think: false,
    options: { temperature: 0.1 },
  } as Parameters<typeof ollama.chat>[0]);

  const raw = JSON.parse(extractJson(response.message.content)) as Partial<OllamaAnalysis>;
  return {
    pageType: (['detail', 'listing'].includes(raw.pageType ?? '') ? raw.pageType : 'unknown') as OllamaAnalysis['pageType'],
    contentGoal: raw.contentGoal ?? '',
    hints: Array.isArray(raw.hints) ? raw.hints : [],
    detectedFields: raw.detectedFields ?? {},
  };
}

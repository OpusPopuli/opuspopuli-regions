import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const regionsDir = join(__dirname, '..', 'regions');
const TIMEOUT = 15_000;

interface DataSource {
  url: string;
  dataType: string;
  sourceType?: string;
}

describe('Data source URL connectivity', () => {
  const jsonFiles = readdirSync(regionsDir).filter((f) => f.endsWith('.json'));

  for (const file of jsonFiles) {
    const config = JSON.parse(readFileSync(join(regionsDir, file), 'utf-8'));
    const sources: DataSource[] = config.config.dataSources.filter(
      (ds: DataSource) => ds.sourceType !== 'bulk_download',
    );
    const urls = [...new Set(sources.map((ds) => ds.url))];

    if (urls.length === 0) continue;

    describe(file, () => {
      it.each(urls)(
        'HEAD %s responds',
        async (url) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT);
          try {
            const res = await fetch(url, {
              method: 'HEAD',
              signal: controller.signal,
            });
            expect(res.status).toBeLessThan(500);
          } finally {
            clearTimeout(timer);
          }
        },
        TIMEOUT + 5000,
      );
    });
  }
});
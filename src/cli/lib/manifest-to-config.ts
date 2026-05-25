import type { DataSourceConfig } from './config-loader.js';
import type { OllamaAnalysis } from './ollama-analyzer.js';

export function buildDataSourceConfig(
  url: string,
  dataType: string,
  analysis: OllamaAnalysis,
): DataSourceConfig {
  const config: DataSourceConfig = {
    url,
    // CLI-boundary input is a free string (`--dataType <type>`). The
    // schema-derived union narrows it at compile time; at runtime, an
    // invalid value lands in the file and `validateRegionFile` catches it
    // before write (see `config-region.ts:writeInitFile`).
    dataType: dataType as DataSourceConfig['dataType'],
    contentGoal: analysis.contentGoal || `Extract ${dataType} data from this page`,
  };

  if (analysis.hints.length > 0) {
    config.hints = analysis.hints;
  }

  const detailFieldEntries = Object.entries(analysis.detectedFields)
    .filter(([field, info]) =>
      field !== 'externalId' &&
      (info.confidence === 'high' || info.confidence === 'medium') &&
      info.cssSelector,
    )
    .map(([field, info]) => [field, info.cssSelector] as [string, string]);

  if (detailFieldEntries.length > 0) {
    config.detailFields = Object.fromEntries(detailFieldEntries);
  }

  return config;
}

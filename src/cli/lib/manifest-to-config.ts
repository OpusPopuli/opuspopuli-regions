import type { DataSourceConfig } from './config-loader.js';
import type { OllamaAnalysis } from './ollama-analyzer.js';

export function buildDataSourceConfig(
  url: string,
  dataType: string,
  analysis: OllamaAnalysis,
): DataSourceConfig {
  const config: DataSourceConfig = {
    url,
    dataType,
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

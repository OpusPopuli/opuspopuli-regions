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
    // schema-derived union narrows it at compile time; at runtime:
    //   - `config-region --init` writes a file → `validateRegionFile`
    //     catches invalid values before write (see writeInitFile).
    //   - Read-only commands (`review`, `check-urls`, `validate-extraction`)
    //     surface an invalid value as a no-op field-detection result
    //     (`getRequiredFields` returns []).
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

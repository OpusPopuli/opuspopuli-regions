import { getRequiredFields } from './required-fields.js';
import type { DataSourceConfig, FieldMapping } from './config-loader.js';

export type GoalCoverageResult = {
  field: string;
  covered: boolean;
  note: string;
};

function hasExternalIdConstructionRule(text: string): boolean {
  return (
    text.includes('construct') ||
    /externalid\s*[=:as]/.test(text) ||
    /externalid.*['`{]/.test(text)
  );
}

function hasStaticManifestExternalId(ds: DataSourceConfig): boolean {
  return (ds.staticManifest?.fieldMappings ?? []).some((fm: FieldMapping) => fm.fieldName === 'externalId');
}

function checkExternalId(fullText: string, ds: DataSourceConfig): GoalCoverageResult {
  const hasRule = hasExternalIdConstructionRule(fullText) || hasStaticManifestExternalId(ds);
  let note: string;
  if (!hasRule) note = 'construction rule missing — AI cannot infer synthetic IDs';
  else if (hasStaticManifestExternalId(ds)) note = 'handled by staticManifest';
  else note = 'construction rule found';
  return { field: 'externalId', covered: hasRule, note };
}

export function checkContentGoalCoverage(
  ds: DataSourceConfig,
): GoalCoverageResult[] {
  const fields = getRequiredFields(ds.dataType);
  if (fields.length === 0) return [];

  const fullText = [ds.contentGoal, ...(ds.hints ?? [])].join(' ').toLowerCase();

  return fields.map((field) => {
    if (field.name === 'externalId') return checkExternalId(fullText, ds);

    const covered = fullText.includes(field.name.toLowerCase());
    return {
      field: field.name,
      covered,
      note: covered ? 'mentioned' : 'not found in contentGoal or hints',
    };
  });
}

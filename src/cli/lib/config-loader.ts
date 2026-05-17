import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type FieldMapping = {
  fieldName: string;
  selector: string;
  extractionMethod: string;
  required: boolean;
  attribute?: string;
};

export type StaticManifest = {
  containerSelector: string;
  itemSelector: string;
  fieldMappings: FieldMapping[];
};

export type DataSourceConfig = {
  url: string;
  dataType: string;
  contentGoal: string;
  category?: string;
  hints?: string[];
  sourceType?: string;
  detailFields?: Record<string, string | { selector: string; children: Record<string, string>; multiple?: boolean }>;
  staticManifest?: StaticManifest;
};

export type RegionPluginFile = {
  name: string;
  displayName: string;
  description: string;
  version: string;
  config: {
    regionId: string;
    regionName: string;
    description: string;
    timezone: string;
    stateCode?: string;
    parentRegionId?: string;
    fipsCode?: string;
    dataSources: DataSourceConfig[];
  };
};

function walkJson(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJson(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

export function loadConfigs(pathOrDir: string): { file: string; region: RegionPluginFile }[] {
  const stat = statSync(pathOrDir);
  if (stat.isFile()) {
    return [{ file: pathOrDir, region: JSON.parse(readFileSync(pathOrDir, 'utf-8')) as RegionPluginFile }];
  }
  return walkJson(pathOrDir).map((file) => ({
    file,
    region: JSON.parse(readFileSync(file, 'utf-8')) as RegionPluginFile,
  }));
}

import chalk from 'chalk';
import { join } from 'node:path';
import { loadConfigs, type RegionPluginFile } from './config-loader.js';

export function loadConfigsOrExit(pathArg?: string): { file: string; region: RegionPluginFile }[] {
  const targetPath = pathArg ?? join(process.cwd(), 'regions');
  try {
    return loadConfigs(targetPath);
  } catch (err) {
    console.error(chalk.red(`Failed to load configs from ${targetPath}: ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  }
}

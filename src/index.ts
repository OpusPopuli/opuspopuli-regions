import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Returns the absolute path to the regions/ directory containing JSON config files.
 * This is the primary integration point for discoverRegionConfigs().
 */
export function getRegionsDir(): string {
  return resolve(__dirname, '..', 'regions');
}
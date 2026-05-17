#!/usr/bin/env node
import { program } from 'commander';
import { registerCheckUrls } from './commands/check-urls.js';
import { registerValidateExtraction } from './commands/validate-extraction.js';
import { registerConfigRegion } from './commands/config-region.js';
import { registerReview } from './commands/review.js';

program
  .name('region-cli')
  .description('Opus Populi region config authoring tools')
  .version('1.0.0');

registerCheckUrls(program);
registerValidateExtraction(program);
registerConfigRegion(program);
registerReview(program);

program.parse();

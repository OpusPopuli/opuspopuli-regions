import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };

// ajv and ajv-formats use CJS `export =` which TypeScript NodeNext ESM strict mode
// won't let you `new` or call without an explicit cast. These local aliases reflect
// the actual runtime shape without depending on ajv's type declarations at the call site.
type AjvError = { instancePath: string; message?: string };
type ValidateFn = { (data: unknown): boolean; errors: AjvError[] | null };
type AjvLike = { compile: (schema: object) => ValidateFn };
const AjvClass = Ajv as unknown as new (opts: object) => AjvLike;
const applyFormats = addFormats as unknown as (ajv: AjvLike) => void;

// Compile once per schema path. Module-level cache keyed by path so the
// expensive ajv compile happens once regardless of how often validation
// is called across a CLI run.
const validatorCache = new Map<string, ValidateFn>();

// Resolve the default schema path lazily at call time, not module load.
// `process.cwd()` captured at import time would point at the wrong place
// if anything `chdir`s between module load and the first call. The CLI
// is documented to run from the repo root, but lazy resolution costs
// nothing and removes a class of flake. Avoiding `import.meta.url` here
// keeps ts-jest's CJS transformer happy without forcing ESM-only test
// config.
function defaultSchemaPath(): string {
  return join(process.cwd(), 'schema', 'region-plugin.schema.json');
}

function getValidator(schemaPath: string): ValidateFn {
  const cached = validatorCache.get(schemaPath);
  if (cached) return cached;
  const ajv = new AjvClass({ allErrors: true });
  applyFormats(ajv);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as object;
  const validate = ajv.compile(schema);
  validatorCache.set(schemaPath, validate);
  return validate;
}

export function validateRegionFile(data: unknown, schemaPath?: string): ValidationResult {
  const validate = getValidator(schemaPath ?? defaultSchemaPath());
  const valid = validate(data);
  if (valid) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`),
  };
}

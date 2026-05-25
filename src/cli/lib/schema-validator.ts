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

// Resolve relative to cwd. The CLI is documented to run from the repo
// root (`pnpm cli ...` from any consumer using this package would pull
// from `node_modules/@opuspopuli/regions/schema/...`, which is again the
// `process.cwd()`-relative form when invoked at the workspace root).
// Tests pass an explicit path. Avoiding `import.meta.url` here keeps
// ts-jest's CJS transformer happy without forcing ESM-only test config.
const DEFAULT_SCHEMA_PATH = join(
  process.cwd(),
  'schema',
  'region-plugin.schema.json',
);

// Compile once per schema path. Module-level cache keyed by path so the
// expensive ajv compile happens once regardless of how often validation
// is called across a CLI run.
const validatorCache = new Map<string, ValidateFn>();

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
  const validate = getValidator(schemaPath ?? DEFAULT_SCHEMA_PATH);
  const valid = validate(data);
  if (valid) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`),
  };
}

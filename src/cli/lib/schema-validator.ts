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

export function validateRegionFile(data: unknown, schemaPath?: string): ValidationResult {
  const resolvedPath = schemaPath ?? join(process.cwd(), 'schema', 'region-plugin.schema.json');
  const ajv = new AjvClass({ allErrors: true });
  applyFormats(ajv);
  const schema = JSON.parse(readFileSync(resolvedPath, 'utf-8')) as object;
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (valid) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`),
  };
}
